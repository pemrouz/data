/* §05 The contract.
   b (THE PICK) · law · proof table — REAL. Two things run in this tab against the
     page's engine: (1) the actual conformance suite (conformance/schedule.test.ts,
     type-stripped and served from ./lib, node:test/node:assert shimmed) — every
     clause row's ✓/✗ is the real result of its tests, "N tests" is the build-tier
     count from gen/proofs.json, "M ms" is performance.now() around the real run;
     (2) one small literal program per clause, read from its <pre> and executed
     through an AsyncFunction with the engine's own names in scope — print() writes
     the attested `// →` lines, nothing is canned. The button re-runs both.
   a (not picked, untouched) · the canned suite log from the UI round. */
import { api, contract, attest } from '../engine.js'
import { scope, runInScope } from '../lib/kernel/scope.js'

const SEC = document.getElementById('contract')
if (SEC) init(SEC)

function init(sec) {
  /* ---------- the syntax highlighter (ref/assets/landing.js), scoped to this section ---------- */
  const TOKEN = /(\/\/[^\n]*)|(`(?:\\.|[^`])*`|'(?:\\.|[^'])*'|"(?:\\.|[^"])*")|\b(\d+\.?\d*)\b|\b(import|from|const|let|var|function|return|new|if|else|for|of|in|true|false|null|undefined|delete|class|extends|export|default|async|await|typeof|instanceof|Infinity|NaN)\b|([(){}[\];,])/g
  const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const highlight = (src) => {
    let out = '', last = 0, m
    TOKEN.lastIndex = 0
    while ((m = TOKEN.exec(src))) {
      out += esc(src.slice(last, m.index))
      const cls = m[1] ? 'tok-com' : m[2] ? 'tok-str' : m[3] ? 'tok-num' : m[4] ? 'tok-key' : 'tok-pun'
      out += `<span class="${cls}">${esc(m[0])}</span>`
      last = m.index + m[0].length
    }
    return out + esc(src.slice(last))
  }
  for (const el of sec.querySelectorAll('[data-variant="a"] pre.code')) el.innerHTML = highlight(el.textContent)

  /* ---------- the suite, as node --test reports it (file order; names verbatim) ---------- */
  const TESTS = [
    [0, 'SCHEDULE_VERSION is exported at runtime and matches this suite', 0.3],
    [1, 'clause 1: bare write = synchronous batch of one; Object.is-equal write emits nothing', 1.1],
    [2, 'clause 2: mid-batch reads see all writes so far; no effect fires until batch close', 0.9],
    [3, 'clause 3: height-ordered propagation, exactly once, parents settled before a child sink fires', 1.4],
    [4, 'clause 4: a throwing effect never starves siblings; failures collect into one AggregateError', 1.7],
    [5, 'clause 5: effect-issued writes drain FIFO as separate next commits', 0.8],
    [5, 'clause 5: an unbounded write cascade throws at the cycle cap, not an infinite loop', 2.6],
    [6, 'clause 6: same-origin sinks are suppressed (source AND derived); re-entrant writes carry issue-time origin', 1.5],
    [7, 'clause 7: init(snapshot) then apply per commit — no gap, no overlap', 0.7],
    [7, 'clause 7: sink()/connect() attached INSIDE batch() — init is the settled commit, apply starts at the NEXT commit', 1.2],
    [8, 'clause 8: A→B→A and add+remove annihilate; multi-write batches consolidate to one delta per key', 1.0],
    [10, 'clause 10a: remove(key, path) deletes the field; the delta is a deleted-marked update', 0.9],
    [10, 'clause 10b: every absent-target remove is a silent no-op, never a throw or a write', 0.6],
    [10, 'clause 10c: vivify-under-null/scalar on live rows; deep write to a non-live key throws', 1.1],
    [8, 'clause 8: same-batch field-write/field-delete merges — annihilate, keep-delete, drop-marker, restore', 1.6],
    [10, 'clause 10d: a poison record never aborts its siblings; rejects collect into one AggregateError', 1.3],
    [9, 'clause 9: coalescing changes commit COUNT, never semantics — default stays sync per chunk', 21.6],
    [11, 'clause 11: NUL/unicode keys are total; undefined/NaN are first-class; by-ref values are shared-immutable', 0.8],
  ]
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  const STEP = reduced ? 0 : 60

  /* ---------- visibility: a variant root is "on" when shown AND on-screen ---------- */
  function visibility(root, onChange) {
    let shown = !root.hidden, seen = false
    const emit = () => onChange(shown && seen)
    root.addEventListener('variantshow', () => { shown = true; emit() })
    root.addEventListener('varianthide', () => { shown = false; emit() })
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(es => { seen = es.some(e => e.isIntersecting); emit() }, { rootMargin: '80px' }).observe(root)
    } else { seen = true; emit() }
  }

  /* ---------- a · run the suite in this tab ---------- */
  const a = sec.querySelector('[data-variant="a"]')
  if (a) {
    const btn = a.querySelector('#suite-run-a')
    const status = a.querySelector('#suite-status-a')
    const log = a.querySelector('#suite-log-a')
    const lines = a.querySelector('#suite-lines-a')
    const sum = a.querySelector('#suite-sum-a')
    const clauses = [...a.querySelectorAll('.clause')]
    const byClause = n => clauses.filter(li => +li.dataset.clause === n)
    let i = 0, running = false, timer = 0, visible = false

    const line = ([, name, ms]) => {
      const li = document.createElement('li'); li.className = 'suite-line'
      const colon = name.indexOf(':')
      const head = colon > 0 ? name.slice(0, colon + 1) : ''
      const rest = colon > 0 ? name.slice(colon + 1) : name
      li.innerHTML = `<span class="suite-ok">✓</span><span class="suite-name">${head ? `<b>${esc(head)}</b>` : ''}${esc(rest)}</span><span class="suite-ms">${ms.toFixed(1)} ms</span>`
      return li
    }
    const hit = n => {
      for (const li of byClause(n)) {
        li.classList.remove('pending')
        li.classList.remove('hit'); void li.offsetWidth; li.classList.add('hit')
        setTimeout(() => li.classList.remove('hit'), 650)
      }
    }
    const finish = () => {
      running = false; timer = 0
      sum.innerHTML = `<b>18 passed</b><span class="sep">·</span>0 failed<span class="sep">·</span><span class="ver">SCHEDULE_VERSION 4</span><span class="sep">·</span>41 ms`
      status.innerHTML = `<b>18 / 18</b> · 41 ms`
      btn.disabled = false; btn.textContent = 'run again ▸'
    }
    const step = () => {
      timer = 0
      if (!running) return
      if (!visible) return                     // paused: resumes on show / on-screen
      if (i >= TESTS.length) { finish(); return }
      const t = TESTS[i++]
      lines.append(line(t))
      if (t[0]) hit(t[0])
      timer = setTimeout(step, STEP)
    }
    const run = () => {
      if (running) return
      running = true; i = 0
      btn.disabled = true; btn.textContent = 'running…'
      status.textContent = ''
      lines.innerHTML = ''; sum.innerHTML = ''
      log.hidden = false
      for (const li of clauses) li.classList.add('pending')
      step()
    }
    btn.addEventListener('click', run)
    visibility(a, on => {
      visible = on
      if (on && running && !timer) timer = setTimeout(step, STEP)
      if (!on && timer) { clearTimeout(timer); timer = 0 }
    })
  }

  /* ---------- b · the real thing ---------- */
  const b = sec.querySelector('[data-variant="b"]')
  if (b) real(b, highlight)
}

function real(root, highlight) {
  const { $, batch, value, node, runtime, ingest, fromAsync, handleFor } = api
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const MARK = /^\/\/ →\s*$/
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

  /* the lead-para's version: the engine's own constant (contract/index.ts) */
  attest(root.querySelector('#c-ver-b'), contract.SCHEDULE_VERSION, 'runtime')

  const rows = [...root.querySelectorAll('.law-row')].map(el => ({
    clause: +el.dataset.clause, el,
    pre: el.querySelector('pre.law-proof'), ok: el.querySelector('.law-ok'), n: el.querySelector('.law-n'),
    src: el.querySelector('pre.law-proof').textContent, slots: [],
  }))
  const byClause = new Map(rows.map(r => [r.clause, r]))
  const headOk = root.querySelector('#law-head-ok-b')
  const sum = root.querySelector('#law-sum-b')
  const btn = root.querySelector('#law-run-b')

  /* ---- the proof column: render each <pre> line by line; `// →` lines become output slots ---- */
  for (const r of rows) {
    const frag = document.createDocumentFragment()
    for (const line of r.src.split('\n')) {
      const span = document.createElement('span')
      if (MARK.test(line)) { span.className = 'law-out'; span.textContent = '// →'; r.slots.push(span) }
      else { span.className = 'law-src'; span.innerHTML = highlight(line) }
      frag.append(span)
    }
    r.pre.replaceChildren(frag)
  }

  /* helpers the snippets see: print → the next `// →` slot; show → one row delta as `op key .path prev → next` */
  const leaf = (v, p) => p.reduce((x, k) => (x == null ? undefined : x[k]), v)
  const show = d => d.op === 'add' ? `add ${d.key} ${JSON.stringify(d.row)}`
    : d.op === 'remove' ? `remove ${d.key} (prev ${JSON.stringify(d.prev)})`
    : `update ${d.key} ${d.path.length ? '.' + d.path.join('.') : '[]'} ${JSON.stringify(leaf(d.prev, d.path))} → ${JSON.stringify(leaf(d.row, d.path))}`

  async function runSnippet(r) {
    let i = 0, done = false
    // every slot starts THIS run empty: a line from a previous run must never survive as if this run printed it
    for (const s of r.slots) { s.classList.remove('bad'); s.removeAttribute('data-attested'); s.textContent = '// →' }
    const slot = () => {
      if (i < r.slots.length) return r.slots[i++]
      const extra = document.createElement('span'); extra.className = 'law-out'; r.pre.append(extra); r.slots.push(extra); i++
      return extra
    }
    const print = (text) => { if (!done) attest(slot(), '// → ' + text, 'runtime') }
    const s = scope(null)                       // owns every node/sink the snippet mints; torn down after
    try {
      await runInScope(s, () => new AsyncFunction('$', 'batch', 'value', 'node', 'runtime', 'ingest', 'fromAsync', 'handleFor', 'print', 'show', r.src)(
        $, batch, value, node, runtime, ingest, fromAsync, handleFor, print, show))
    } catch (e) {
      const el = slot(); attest(el, `// ✗ ${e && e.name ? e.name + ': ' : ''}${e && e.message ? e.message : String(e)}`, 'runtime'); el.classList.add('bad')
    } finally {
      done = true
      try { s.dispose() } catch { /* a cleanup throw must not take the page down */ }
    }
  }

  /* ---- the suite: the REAL conformance/schedule.test.ts, node:test/node:assert shimmed ---- */
  const suite = Promise.all([
    import('data/schedule-suite').then(() => import('data/shim-test')).then(m => m.tests),
    fetch(new URL('../gen/proofs.json', import.meta.url)).then(r => r.json()).catch(() => null),
  ]).then(([tests, proofs]) => {
    // test → clause: gen/proofs.json first; else the test's own name ("clause 10c: …" → 10, the version assert → 'version')
    const fromName = name => /SCHEDULE_VERSION/.test(name) ? 'version' : (m => m ? +m[1] : undefined)(/^clause (\d+)/.exec(name))
    const clauseOf = new Map(tests.map(t => [t.name, fromName(t.name)]))
    if (proofs) for (const p of proofs) clauseOf.set(p.name, p.clause)
    // "N tests" per clause — the build-tier count from gen/proofs.json; without it, counted from the registered tests (runtime)
    for (const r of rows) {
      const n = proofs ? proofs.filter(p => p.clause === r.clause).length : tests.filter(t => clauseOf.get(t.name) === r.clause).length
      if (n) { r.n.replaceChildren(); const nb = document.createElement('b'); attest(nb, n, proofs ? 'build' : 'runtime'); r.n.append(nb, document.createTextNode(n === 1 ? ' test' : ' tests')) }
    }
    return { tests, clauseOf }
  })

  const yieldFrame = () => new Promise(r => setTimeout(r, 0))
  async function runSuite() {
    const { tests, clauseOf } = await suite
    for (const r of rows) { r.el.classList.remove('pass', 'fail'); r.el.classList.add('pending'); r.ok.textContent = '·' }
    headOk.className = 'law-head-ok pending'; headOk.textContent = '·'
    const per = new Map()                       // clause → { ms, fail, names }
    let pass = 0, fail = 0, total = 0
    const failed = []
    for (const t of tests) {
      const t0 = performance.now()
      let ok = true, msg = ''
      try { await t.fn() } catch (e) { ok = false; msg = e && e.message ? e.message : String(e) }
      const ms = performance.now() - t0
      total += ms
      if (ok) pass++; else { fail++; failed.push(`${t.name}: ${msg}`) }
      const c = clauseOf.get(t.name)
      if (c === 'version') {
        headOk.className = 'law-head-ok ' + (ok ? 'pass' : 'fail'); headOk.textContent = ok ? '✓' : '✗'
        headOk.title = `${t.name} — ${ok ? 'passed' : 'FAILED: ' + msg} · ${ms.toFixed(2)} ms`
      } else {
        const r = byClause.get(c)
        if (r) {
          const acc = per.get(c) ?? { ms: 0, fail: 0, names: [] }
          acc.ms += ms; if (!ok) acc.fail++; acc.names.push(`${ok ? '✓' : '✗'} ${t.name}${ok ? '' : ' — ' + msg} · ${ms.toFixed(2)} ms`)
          per.set(c, acc)
          r.el.classList.remove('pending'); r.el.classList.toggle('fail', acc.fail > 0); r.el.classList.toggle('pass', acc.fail === 0)
          r.ok.textContent = acc.fail ? '✗' : '✓'
          r.ok.title = acc.names.join('\n')
          // "N tests · M ms": keep the build-tier count, append the measured ms
          let msEl = r.n.querySelector('b[data-attested="measured"]')
          if (!msEl) { r.n.append(document.createTextNode(' · ')); msEl = document.createElement('b'); r.n.append(msEl, document.createTextNode(' ms')) }
          attest(msEl, acc.ms.toFixed(acc.ms < 10 ? 2 : 1), 'measured')
        }
      }
      if (!reduced) await yieldFrame()          // let each result paint as it lands
    }
    // the build-tier "N tests" must equal the tests that actually ran for that clause; on drift the run's count wins (runtime)
    for (const r of rows) {
      const ran = per.get(r.clause)?.names.length ?? 0
      const nb = r.n.querySelector('b:first-child')
      if (nb && +nb.textContent !== ran) { attest(nb, ran, 'runtime'); nb.nextSibling.textContent = ran === 1 ? ' test' : ' tests' }
    }
    // the foot: every figure from THIS run
    sum.replaceChildren()
    const add = (v, tier, label, cls) => { const el = document.createElement('b'); attest(el, v, tier); if (cls) el.classList.add(cls); sum.append(el, document.createTextNode(label)) }
    add(tests.length, 'runtime', ' tests · '); add(pass, 'runtime', ' passed · '); add(fail, 'runtime', ' failed · ', fail ? 'fail' : ''); add(total.toFixed(1), 'measured', ' ms, this machine')
    window.__proofs = { pass, fail, total: tests.length, failed }
    return { pass, fail, total: tests.length }
  }

  /* ---- one run = the eleven proofs (on the page's runtime), then the suite ---- */
  let running = null, runs = 0
  async function runAll() {
    if (running) return running
    btn.disabled = true; btn.textContent = 'running…'
    running = (async () => {
      for (const r of rows) await runSnippet(r)
      try { await runSuite() } catch (e) { sum.textContent = `the suite could not run: ${e && e.message ? e.message : e}` }
    })().finally(() => { running = null; runs++; btn.disabled = false; btn.textContent = 'run again ▸'; window.__contractRuns = runs })
    return running
  }
  btn.addEventListener('click', () => { runAll() })
  // on load: after the first frame has painted (the lede comes first), once — the whole run is ~100 ms of mostly timer waits
  let kicked = false
  const kick = () => { if (!kicked) { kicked = true; runAll() } }
  requestAnimationFrame(() => setTimeout(kick, 0))
  setTimeout(kick, 400)
  window.__contract = { run: runAll }
}
