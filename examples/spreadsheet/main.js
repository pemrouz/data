/* A reactive spreadsheet built on `data`.
 *
 * The library's job here: hold the per-cell *display values* in one $() proxy
 * and bind each cell to the DOM with `render`. When a formula recomputes, only
 * the cells whose value actually changed are written back into the proxy, so
 * `render` repaints exactly those cells — never the grid. Type into one cell and
 * watch only its dependents flash.
 *
 * The formula layer (parser + dependency graph + topological recompute + cycle
 * detection) is hand-rolled on top — the lib is a reactive collection engine,
 * not a formula engine, so the cell→cell DAG lives outside it. What it gives us
 * is the surgical bind from computed value to pixel.
 *
 * Hand-written `.js`, no `.ts` sibling (see CLAUDE.md). Served from dist via the
 * page's importmap. */

if (location.search.includes('devtools')) await import('data/devtools')
import { $, value, render, HTML } from 'data/full'

const { div, span, input } = HTML

const COLS = [...'ABCDEFGH']
const NROWS = 16
const inGrid = (c, r) => COLS.includes(c) && r >= 1 && r <= NROWS

const allIds = []
for (let r = 1; r <= NROWS; r++) for (const c of COLS) allIds.push(c + r)

/* ---------------- formula engine ---------------- */
// Per-cell state. `nums[id]`: undefined = empty, NaN = text/error, else number.
// `errored` carries the cells currently showing #ERR/#CYCLE/#REF/#DIV/0 so an
// error propagates through anything that references them.
const raw = {}, nums = {}, compiled = {}, errored = new Set()
const deps = {}, rdeps = {} // deps[id] = cells it reads; rdeps[id] = cells reading it

const refRe = /^([A-Z])(\d{1,2})$/
function splitId (id) { const m = refRe.exec(id); return m ? { c: m[1], r: +m[2] } : null }
function validateRef (id) { const s = splitId(id); if (!s || !inGrid(s.c, s.r)) throw new Error('REF') }
function expandRange (a, b) {
  const A = splitId(a), B = splitId(b)
  if (!A || !B) throw new Error('REF')
  const c0 = Math.min(COLS.indexOf(A.c), COLS.indexOf(B.c)), c1 = Math.max(COLS.indexOf(A.c), COLS.indexOf(B.c))
  const r0 = Math.min(A.r, B.r), r1 = Math.max(A.r, B.r)
  if (c0 < 0 || c1 >= COLS.length || r0 < 1 || r1 > NROWS) throw new Error('REF')
  const out = []
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(COLS[c] + r)
  return out
}

const isDigit = c => c >= '0' && c <= '9'
const isLetter = c => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')

// Split a formula into tokens: numbers, cell refs (B12), function names (SUM),
// operators, and punctuation. A run of letters is a function name unless digits
// follow, in which case it's a cell reference.
function tokenize (formula) {
  const tokens = []
  let i = 0

  const scan = test => { let j = i; while (j < formula.length && test(formula[j])) j++; const text = formula.slice(i, j); i = j; return text }

  while (i < formula.length) {
    const c = formula[i]
    if (c === ' ') i++
    else if (isDigit(c) || c === '.') tokens.push({ type: 'num', value: parseFloat(scan(ch => isDigit(ch) || ch === '.')) })
    else if (isLetter(c)) {
      const word = scan(isLetter).toUpperCase()
      if (isDigit(formula[i])) tokens.push({ type: 'ref', value: word + scan(isDigit) })
      else tokens.push({ type: 'fn', value: word })
    }
    else if ('+-*/'.includes(c)) tokens.push({ type: 'op', value: formula[i++] })
    else if (c === '(') { tokens.push({ type: 'lp' }); i++ }
    else if (c === ')') { tokens.push({ type: 'rp' }); i++ }
    else if (c === ',') { tokens.push({ type: 'comma' }); i++ }
    else if (c === ':') { tokens.push({ type: 'colon' }); i++ }
    else throw new Error('ERR')
  }
  return tokens
}

// Recursive-descent parser → an evaluator closure `fn(resolve)`, where
// `resolve(id)` returns a cell's numeric value (and throws to propagate errors).
// Cell references are collected into `refs` as we go, so the dependency graph is
// exact. Grammar: expr → term (('+'|'-') term)*; term → factor (('*'|'/') …)*.
function parse (tokens, refs) {
  let pos = 0
  const peek = () => tokens[pos]
  const next = () => tokens[pos++]
  const expect = type => { if (!peek() || peek().type !== type) throw new Error('ERR'); return next() }

  function expr () {
    let left = term()
    while (peek()?.type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = next().value, right = term(), a = left
      left = op === '+' ? r => a(r) + right(r) : r => a(r) - right(r)
    }
    return left
  }

  function term () {
    let left = factor()
    while (peek()?.type === 'op' && (peek().value === '*' || peek().value === '/')) {
      const op = next().value, right = factor(), a = left
      left = op === '*' ? r => a(r) * right(r) : r => a(r) / right(r)
    }
    return left
  }

  function factor () {
    const token = peek()
    if (!token) throw new Error('ERR')
    if (token.type === 'op' && token.value === '-') { next(); const operand = factor(); return r => -operand(r) }
    if (token.type === 'op' && token.value === '+') { next(); return factor() }
    if (token.type === 'num') { next(); return () => token.value }
    if (token.type === 'lp') { next(); const inner = expr(); expect('rp'); return inner }
    if (token.type === 'ref') { next(); validateRef(token.value); refs.add(token.value); return r => r(token.value) }
    if (token.type === 'fn') {
      next(); expect('lp')
      const args = []
      if (peek()?.type !== 'rp') { args.push(argument()); while (peek()?.type === 'comma') { next(); args.push(argument()) } }
      expect('rp')
      return makeFn(token.value, args)
    }
    throw new Error('ERR')
  }

  // An argument is either a range (B2:B5 → a list of cell ids) or an expression.
  function argument () {
    if (peek()?.type === 'ref' && tokens[pos + 1]?.type === 'colon') {
      const from = next().value; next(); const to = expect('ref').value
      const ids = expandRange(from, to)
      ids.forEach(id => refs.add(id))
      return { range: ids }
    }
    return { expr: expr() }
  }

  const evaluate = expr()
  if (pos !== tokens.length) throw new Error('ERR')
  return evaluate
}

function rangeValues (ids) {
  const out = []
  for (const id of ids) { if (errored.has(id)) throw new Error('ERR'); const v = nums[id]; if (v === undefined || Number.isNaN(v)) continue; out.push(v) }
  return out
}
// A function call evaluates its arguments to a flat list of numbers (ranges
// expand, skipping empty/text cells; expressions evaluate to one value each),
// then reduces them.
function makeFn (name, args) {
  return resolve => {
    const values = []
    for (const arg of args) {
      if (arg.range) values.push(...rangeValues(arg.range))
      else values.push(arg.expr(resolve))
    }
    const sum = () => values.reduce((a, b) => a + b, 0)
    switch (name) {
      case 'SUM': return sum()
      case 'AVG': case 'AVERAGE': return values.length ? sum() / values.length : 0
      case 'MIN': return values.length ? Math.min(...values) : 0
      case 'MAX': return values.length ? Math.max(...values) : 0
      case 'COUNT': return values.length
      case 'PRODUCT': return values.reduce((a, b) => a * b, 1)
      case 'ABS': return Math.abs(values[0] ?? 0)
      case 'ROUND': { const k = 10 ** (values[1] ?? 0); return Math.round((values[0] ?? 0) * k) / k }
      default: throw new Error('ERR')
    }
  }
}

function compile (s) {
  if (s === '') return { kind: 'empty', refs: new Set() }
  if (s[0] === '=') { const refs = new Set(); const fn = parse(tokenize(s.slice(1)), refs); return { kind: 'formula', fn, refs } }
  if (s.trim() !== '' && !isNaN(Number(s))) return { kind: 'num', val: Number(s), refs: new Set() }
  return { kind: 'text', val: s, refs: new Set() }
}

function resolveStrict (id) {
  if (errored.has(id)) throw new Error('ERR')
  const v = nums[id]
  if (v === undefined) return 0
  if (Number.isNaN(v)) throw new Error('ERR')
  return v
}

function fmt (n) {
  if (!isFinite(n)) return n > 0 || n < 0 ? '#DIV/0!' : '#ERR!'
  if (Number.isInteger(n)) return String(n)
  return String(Math.round(n * 1e6) / 1e6)
}

function evalCell (id) {
  errored.delete(id)
  const c = compiled[id]
  if (!c || c.kind === 'empty') { nums[id] = undefined; setDisplay(id, ''); return }
  if (c.kind === 'num') { nums[id] = c.val; setDisplay(id, fmt(c.val)); return }
  if (c.kind === 'text') { nums[id] = NaN; setDisplay(id, c.val); return }
  if (c.kind === 'error') { nums[id] = NaN; errored.add(id); setDisplay(id, c.msg === 'REF' ? '#REF!' : '#ERR!'); return }
  try {
    const v = c.fn(resolveStrict)
    if (!isFinite(v)) { nums[id] = NaN; errored.add(id); setDisplay(id, v === Infinity || v === -Infinity ? '#DIV/0!' : '#ERR!'); return }
    nums[id] = v; setDisplay(id, fmt(v))
  } catch (e) { nums[id] = NaN; errored.add(id); setDisplay(id, e.message === 'REF' ? '#REF!' : '#ERR!') }
}

function updateDeps (id, newRefs) {
  for (const ref of (deps[id] || [])) rdeps[ref]?.delete(id)
  deps[id] = newRefs
  for (const ref of newRefs) (rdeps[ref] ??= new Set()).add(id)
}

// Recompute `start` and everything downstream of it, in dependency order. Any
// node that can't be ordered (a leftover after Kahn's algorithm) sits in a
// cycle → #CYCLE!. This is the incremental bit: untouched cells are never
// re-evaluated, and only changed display values reach the DOM.
function recomputeFrom (start) {
  const affected = new Set(); const stack = [start]
  while (stack.length) { const x = stack.pop(); if (affected.has(x)) continue; affected.add(x); for (const d of (rdeps[x] || [])) stack.push(d) }
  const indeg = new Map(); for (const x of affected) indeg.set(x, 0)
  for (const x of affected) for (const d of (deps[x] || [])) if (affected.has(d)) indeg.set(x, indeg.get(x) + 1)
  const queue = []; for (const x of affected) if (indeg.get(x) === 0) queue.push(x)
  const seen = new Set()
  while (queue.length) {
    const x = queue.shift(); seen.add(x); evalCell(x)
    for (const d of (rdeps[x] || [])) if (affected.has(d)) { indeg.set(d, indeg.get(d) - 1); if (indeg.get(d) === 0) queue.push(d) }
  }
  for (const x of affected) if (!seen.has(x)) { errored.add(x); nums[x] = NaN; setDisplay(x, '#CYCLE!') }
}

let booting = true
function setCell (id, rawStr) {
  rawStr = rawStr == null ? '' : String(rawStr)
  raw[id] = rawStr
  let c; try { c = compile(rawStr) } catch (e) { c = { kind: 'error', msg: e.message, refs: new Set() } }
  compiled[id] = c
  updateDeps(id, c.refs || new Set())
  recomputeFrom(id)
  if (!booting) persist()
}

/* ---------------- reactive view ---------------- */
// `display` is the one proxy the library drives the DOM from. setDisplay only
// writes when the string actually changed, so unchanged cells produce no DOM
// work even when they're inside the recomputed set.
const display = $(Object.fromEntries(allIds.map(id => [id, ''])))
const sel = $('A1')
function setDisplay (id, str) { if (display[id][value] !== str) display[id] = str }

const isErr = v => typeof v === 'string' && v[0] === '#'
const isNum = v => v !== '' && !isErr(v) && !isNaN(Number(v))

function cellNode (id) {
  return div.sscell
    .attr('data-cell', id)
    .class('sel', sel.to(s => s === id))
    .class('err', display[id].to(isErr))
    .class('num', display[id].to(isNum))
    .on('mousedown', () => selectCell(id))
    .on('dblclick', () => startEdit(id))
    .text(display[id])
}

const headRow = div.ssrow.head(div.corner(''), ...COLS.map(c => div.colh(c)))
const bodyRows = []
for (let r = 1; r <= NROWS; r++) bodyRows.push(div.ssrow(div.rowh('' + r), ...COLS.map(c => cellNode(c + r))))
const editor = input.sseditor.attr('spellcheck', 'false')

render(document.body, div.ssapp(
  div.toolbar(
    span.brand('▦  sheet'),
    div.fbar(span.fcell.text(sel), input.fbarinput.attr('spellcheck', 'false')['placeholder=value or =formula']),
    span.hint('click a cell · type to edit · =SUM(A1:A4) · Tab/Enter to move')
  ),
  div.ssgrid.attr('tabindex', '0').nodes(headRow, ...bodyRows, editor)
))

/* ---------------- interaction ---------------- */
const gridEl = document.querySelector('.ssgrid')
const editorEl = document.querySelector('.sseditor')
const fbarEl = document.querySelector('.fbarinput')
const cellEl = id => gridEl.querySelector(`[data-cell="${id}"]`)

let editingId = null

function selectCell (id) {
  if (editingId != null) commitEdit()
  sel[value] = id
  fbarEl.value = raw[id] || ''
  cellEl(id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  if (document.activeElement !== fbarEl) gridEl.focus()
}

function moveSel (dir) {
  const s = splitId(sel[value]); let c = COLS.indexOf(s.c), r = s.r
  if (dir === 'U') r--; else if (dir === 'D') r++; else if (dir === 'L') c--; else if (dir === 'R') c++
  c = Math.max(0, Math.min(COLS.length - 1, c)); r = Math.max(1, Math.min(NROWS, r))
  selectCell(COLS[c] + r)
}

function startEdit (id, seedChar) {
  selectCell(id)
  editingId = id
  const el = cellEl(id), gr = gridEl.getBoundingClientRect(), cr = el.getBoundingClientRect()
  editorEl.style.left = (cr.left - gr.left + gridEl.scrollLeft) + 'px'
  editorEl.style.top = (cr.top - gr.top + gridEl.scrollTop) + 'px'
  editorEl.style.width = cr.width + 'px'; editorEl.style.height = cr.height + 'px'
  editorEl.classList.add('show')
  editorEl.value = seedChar != null ? seedChar : (raw[id] || '')
  editorEl.focus()
  if (seedChar == null) editorEl.select()
}

function commitEdit (move) {
  if (editingId == null) return
  const id = editingId; editingId = null
  setCell(id, editorEl.value)
  fbarEl.value = raw[id] || ''
  editorEl.classList.remove('show')
  if (move) moveSel(move); else gridEl.focus()
}
function cancelEdit () { editingId = null; editorEl.classList.remove('show'); gridEl.focus() }

gridEl.addEventListener('keydown', e => {
  if (editingId != null) return
  const k = e.key
  if (k === 'ArrowUp') { moveSel('U'); e.preventDefault() }
  else if (k === 'ArrowDown' || k === 'Enter') { moveSel('D'); e.preventDefault() }
  else if (k === 'ArrowLeft') { moveSel('L'); e.preventDefault() }
  else if (k === 'ArrowRight') { moveSel('R'); e.preventDefault() }
  else if (k === 'Tab') { moveSel(e.shiftKey ? 'L' : 'R'); e.preventDefault() }
  else if (k === 'Delete' || k === 'Backspace') { setCell(sel[value], ''); fbarEl.value = ''; e.preventDefault() }
  else if (k === 'F2') { startEdit(sel[value]); e.preventDefault() }
  else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { startEdit(sel[value], k); e.preventDefault() }
})

editorEl.addEventListener('keydown', e => {
  e.stopPropagation()
  if (e.key === 'Enter') { commitEdit('D'); e.preventDefault() }
  else if (e.key === 'Escape') { cancelEdit(); e.preventDefault() }
  else if (e.key === 'Tab') { commitEdit(e.shiftKey ? 'L' : 'R'); e.preventDefault() }
})
editorEl.addEventListener('blur', () => { if (editingId != null) commitEdit() })

fbarEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') { setCell(sel[value], fbarEl.value); moveSel('D'); e.preventDefault() }
  else if (e.key === 'Escape') { fbarEl.value = raw[sel[value]] || ''; gridEl.focus() }
})

/* ---------------- persistence + seed ---------------- */
const KEY = 'data-sheet'
function persist () {
  const clean = {}
  for (const id of allIds) if (raw[id]) clean[id] = raw[id]
  localStorage.setItem(KEY, JSON.stringify(clean))
}

const SEED = {
  A1: 'Region', B1: 'Jan', C1: 'Feb', D1: 'Mar', E1: 'Total',
  A2: 'North', B2: '120', C2: '135', D2: '150', E2: '=SUM(B2:D2)',
  A3: 'South', B3: '98', C3: '104', D3: '120', E3: '=SUM(B3:D3)',
  A4: 'East', B4: '140', C4: '150', D4: '162', E4: '=SUM(B4:D4)',
  A5: 'West', B5: '110', C5: '118', D5: '130', E5: '=SUM(B5:D5)',
  A6: 'Total', B6: '=SUM(B2:B5)', C6: '=SUM(C2:C5)', D6: '=SUM(D2:D5)', E6: '=SUM(E2:E5)',
  A8: 'Avg / mo', B8: '=ROUND(AVG(B2:B5),1)', C8: '=ROUND(AVG(C2:C5),1)', D8: '=ROUND(AVG(D2:D5),1)',
  A9: 'Peak col', B9: '=MAX(B6:D6)',
  A10: 'Growth %', B10: '=ROUND((D6-B6)/B6*100,1)'
}

let saved = null
try { saved = JSON.parse(localStorage.getItem(KEY) || 'null') } catch {}
const initial = saved && Object.keys(saved).length ? saved : SEED
for (const id of allIds) if (initial[id] != null) setCell(id, initial[id])
booting = false
selectCell('A1')

// expose for the smoke test / console poking
Object.assign(window, { sheet: { setCell, display, raw, nums, sel }, value })
