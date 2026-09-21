/* sections/wire.js — §06 Across the wire (id="wire"). REAL.
   Two engines in this tab. `here` is a $() source on the page's default runtime;
   `there` is a source on a SECOND `new Runtime()` (handleFor(new InMemoryBacking(rtB, {}).source))
   that is seeded by nothing but the wire's opening snapshot. The only path between them:
   wireSink(here, cross, { origin: fromWire }) / wireSink(there, cross, { origin: fromWire, initial: false })
   → cross() serialises the WireBatch to JSON bytes, prints it, and after a hold (350 ms, so the
   eye can follow — labelled and measured) calls ingest(other, wb.records, { origin: fromWire }).
   Origin tokens (clause 6): a wireSink declared with fromWire never re-emits a batch whose commit
   carries fromWire (kernel/runtime.ts effect loop), so nothing echoes — `echoed back` counts
   real callbacks that fire during an ingest, which the contract holds at 0.
   Every cell is written by that runtime's own sink (init snapshot, then per-commit deltas);
   conform(here[node]) + conform(there[node]) legality-check and replay-fold every commit — a
   violation throws through clause 4 and prints as ✗. After every landing the two snapshots are
   compared with deepEq (conformance/replay.ts). The only synthetic thing is the INPUT: the six
   seed rows and the idle writer's random qty steps. */
import { api, attest, put, REDUCED } from '../engine.js'
import { conform } from 'data/conform'
import { deepEq } from 'data/replay'

const { $, node, runtime, Runtime, InMemoryBacking, handleFor, wireSink, ingest } = api

const SEC = document.getElementById('wire')
const ROOT = SEC && SEC.querySelector('[data-variant="a"]')
if (ROOT) init(ROOT)

function init(root) {
  const q = id => root.querySelector('#' + id)
  const HOLD = REDUCED ? 0 : 350      // the wire holds each batch this long so the eye can follow (measured + labelled)
  const IDLE = 3400                   // the idle writer's cadence, ms (input)

  /* ---------- the two runtimes ---------- */
  const here = $({                    // runtime A: the page's default runtime (seed rows = input)
    t1: { sym: 'AAPL', side: 'buy', qty: 200, px: 187.5 },
    t2: { sym: 'MSFT', side: 'sell', qty: 120, px: 412.1 },
    t3: { sym: 'NVDA', side: 'buy', qty: 500, px: 118.4 },
    t4: { sym: 'AMZN', side: 'sell', qty: 340, px: 178.2 },
    t5: { sym: 'META', side: 'buy', qty: 90, px: 512.9 },
    t6: { sym: 'TSLA', side: 'sell', qty: 260, px: 244.7 },
  })
  const rtB = new Runtime()                                              // runtime B: a second engine
  const there = handleFor(new InMemoryBacking(rtB, {}).source)           // seeded ONLY by the wire
  const fromWire = Symbol('wire')                                        // the origin token both wireSinks declare
  conform(here[node])                                                    // legality + replay on every commit of A
  conform(there[node])                                                   // … and of B

  const S = {
    A: { name: 'A', where: 'here', v: 'here', h: here, rt: runtime(), batchName: 'batch', tbl: q('wire-tbl-here-a'), last: q('wire-last-here-a'), rowsEl: q('wire-rows-here-a'), rowEl: new Map() },
    B: { name: 'B', where: 'there', v: 'there', h: there, rt: rtB, batchName: 'rtB.batch', tbl: q('wire-tbl-there-a'), last: q('wire-last-there-a'), rowsEl: q('wire-rows-there-a'), rowEl: new Map() },
  }
  S.A.peer = S.B; S.B.peer = S.A
  const emptyB = q('wire-empty-there-a')

  const track = q('wire-track-a'), dot = q('wire-dot-a'), trail = q('wire-trail-a'), echo = q('wire-echo-a')
  const dirEl = q('wire-dir-a'), viaEl = q('wire-via-a'), batchEl = q('wire-batch-a')
  const crossedEl = q('wire-crossed-a'), echoedEl = q('wire-echoed-a'), measEl = q('wire-meas-a'), statusEl = q('wire-status-a')

  /* ---------- the tables: every cell written by that runtime's own sink ---------- */
  const span = (cls, tr) => { const s = document.createElement('span'); s.className = cls; tr.appendChild(s); return s }
  const flash = c => { c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash') }
  const fill = (tr, row, live) => {
    const qty = tr.querySelector('.c-qty')
    const changed = live && qty.textContent !== String(row.qty)
    put(tr.querySelector('.c-sym'), String(row.sym))
    put(tr.querySelector('.c-side'), String(row.side))
    attest(qty, String(row.qty), 'runtime')
    attest(tr.querySelector('.c-px'), String(row.px), 'runtime')
    if (changed) flash(qty)
  }
  const mkRow = (side, k, row) => {
    const tr = document.createElement('div')
    tr.className = 'wire-tr'; tr.setAttribute('role', 'row'); tr.tabIndex = 0; tr.dataset.k = k
    tr.title = `${side.v}.get('${k}').set('qty', …) — click to write`
    attest(span('c-k', tr), String(k), 'runtime')
    span('c-sym', tr); span('c-side', tr); span('c-qty', tr); span('c-px', tr)
    fill(tr, row, false)
    side.tbl.appendChild(tr)
    side.rowEl.set(k, tr)
    return tr
  }
  const rowCount = side => attest(side.rowsEl, side.h.rowCount(), 'runtime')
  // this page's own work inside the engine's effect phase (DOM rows, the flash's forced reflow, the
  // echo ring) is timed apart, so the printed ingest cost is the engine's, not the painting's
  let sinkMs = 0
  for (const side of [S.A, S.B]) {
    side.h.sink({
      init(snap) { for (const [k, row] of snap) mkRow(side, k, row); rowCount(side) },
      apply(b) {
        const t = performance.now()
        for (const d of b.rows) {
          if (d.op === 'add') { mkRow(side, d.key, d.row).classList.add('in'); if (side === S.B && emptyB) emptyB.hidden = true }
          else if (d.op === 'update') { const tr = side.rowEl.get(d.key); if (tr) fill(tr, d.row, true) }
          else { side.rowEl.get(d.key)?.remove(); side.rowEl.delete(d.key) }
        }
        rowCount(side)
        if (b.origin === fromWire) arrived(side)   // this runtime applied a batch that came over the wire (real event)
        sinkMs += performance.now() - t
      },
    })
  }

  /* ---------- the printed batch: the real WireBatch, pre.code tokens ---------- */
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const P = s => `<span class="tok-pun">${s}</span>`
  const STR = s => `<span class="tok-str">'${esc(s)}'</span>`
  const NUM = n => `<span class="tok-num">${esc(n)}</span>`
  const lit = v => typeof v === 'string' ? STR(v) : typeof v === 'number' ? NUM(v) : v !== null && typeof v === 'object' ? `${P('{')}…${P('}')}` : NUM(String(v))
  const path = p => `${P('[')}${(p ?? []).map(STR).join(`${P(',')} `)}${P(']')}`
  const rec = r => r.t === 'update'
    ? `    ${P('{')} t: ${STR('update')}, k: ${STR(r.k)},\n      v: <span class="hot">${esc(typeof r.v === 'object' && r.v !== null ? JSON.stringify(r.v) : r.v)}</span>, prev: ${lit(r.prev)},\n      path: ${path(r.path)} ${P('}')}`
    : r.t === 'add'
      ? `    ${P('{')} t: ${STR('add')}, k: ${STR(r.k)}, v: ${lit(r.v)}${r.at !== undefined ? `, at: ${NUM(r.at)}` : ''} ${P('}')}`
      : `    ${esc(JSON.stringify(r))}`
  const printBatch = wb => {
    batchEl.innerHTML = `${P('{')} keyDomain: ${STR(wb.keyDomain)}, seq: ${NUM(wb.seq)},\n  records: ${P('[')}\n${wb.records.map(rec).join(`${P(',')}\n`)}\n  ${P(']')} ${P('}')}`
    batchEl.setAttribute('data-attested', 'runtime')   // every figure above is a field of the real object
    batchEl.classList.remove('in'); void batchEl.offsetWidth; batchEl.classList.add('in')
  }

  /* ---------- the dot, the trail, the suppressed echo (presentation of real events) ---------- */
  const axis = () => track.offsetWidth >= track.offsetHeight ? 'x' : 'y'
  const len = ax => ax === 'x' ? track.offsetWidth : track.offsetHeight
  const at = (ax, p) => ax === 'x' ? `translate(${p}px, -50%)` : `translate(-50%, ${p}px)`
  const cancel = el => { for (const a of el.getAnimations()) a.cancel() }
  const fly = forward => {                      // forward = A → B
    if (REDUCED) return
    const ax = axis(), L = len(ax)
    const from = forward ? 0 : L, to = forward ? L : 0
    cancel(dot); cancel(trail); cancel(echo)
    dot.animate(
      [{ transform: at(ax, from), opacity: 1, easing: 'cubic-bezier(.45,0,.55,1)' }, { transform: at(ax, to), opacity: 1, offset: HOLD / (HOLD + 180) }, { transform: at(ax, to), opacity: 0 }],
      { duration: HOLD + 180, fill: 'forwards' })
    trail.style.transformOrigin = ax === 'x' ? (forward ? 'left center' : 'right center') : (forward ? 'center top' : 'center bottom')
    const sc = s => ax === 'x' ? `scaleX(${s})` : `scaleY(${s})`
    trail.animate(
      [{ transform: sc(0), opacity: 0.55, easing: 'cubic-bezier(.45,0,.55,1)' }, { transform: sc(1), opacity: 0.55, offset: HOLD / (HOLD + 520) }, { transform: sc(1), opacity: 0 }],
      { duration: HOLD + 520, fill: 'forwards' })
  }
  const echoRing = landedAtA => {               // the far side's wireSink saw its own origin and stayed silent
    if (REDUCED) return
    const ax = axis(), L = len(ax)
    const from = landedAtA ? 0 : L, to = landedAtA ? L * 0.16 : L * 0.84
    echo.animate([{ transform: at(ax, from), opacity: 0.85 }, { transform: at(ax, to), opacity: 0 }], { duration: 320, delay: 80, easing: 'ease-out', fill: 'forwards' })
  }

  /* ---------- the wire ---------- */
  let crossed = 0, echoed = 0, inflight = null, inIngest = false, viaT = 0, wired = false
  const queue = []
  const landings = []
  // probe hook (tools + scratch scripts): the handles are exposed so a reviewer can write to either
  // runtime behind the wire's back and watch the fold line say "diverged"
  window.__wire = { crossed: 0, echoed: 0, landings, seqA: () => S.A.rt.seq, seqB: () => rtB.seq, identical: null, inflight: () => inflight !== null, here, there, rtB, fromWire }
  attest(crossedEl, crossed, 'runtime'); attest(echoedEl, echoed, 'runtime')
  const status = html => { statusEl.innerHTML = html }
  const ms2 = v => v < 0.05 ? '&lt;0.1' : v.toFixed(2)   // performance.now() is clamped to 100 µs in a non-isolated tab — below that, say so
  const fail = (e, where) => {
    status(`fold(wire) ≡ ${where} · <span class="bad">✗ ${esc(e && e.message ? e.message : e)}</span>`)
    window.__wire.error = String(e && e.message ? e.message : e)
  }
  // out() of a wireSink: called INSIDE the emitting runtime's effect phase, synchronously with the write
  function cross(wb, from) {
    if (inIngest) { echoed++; attest(echoedEl, echoed, 'runtime'); window.__wire.echoed = echoed; return }   // an echo (never, by clause 6)
    const to = from.peer
    const bytes = new TextEncoder().encode(JSON.stringify(wb))       // the wire carries bytes
    const wire = JSON.parse(new TextDecoder().decode(bytes))
    inflight = { wb: wire, from, to, bytes: bytes.length, t0: performance.now() }
    printBatch(wire)
    put(dirEl, `${from.name} → ${to.name}`)
    clearTimeout(viaT); put(viaEl, 'held for the eye …'); viaEl.classList.remove('echo')
    status(`fold(wire) ≡ ${to.where} · <span class="pending">seq <b data-attested="runtime">${esc(wire.seq)}</b> in flight …</span>`)
    fly(from === S.A)
    setTimeout(() => land(inflight), HOLD)
  }
  function land(f) {
    const { wb, from, to } = f
    const held = performance.now() - f.t0
    let report
    const t1 = performance.now()
    inIngest = true; sinkMs = 0
    try { report = ingest(to.h, wb.records, { origin: fromWire }) }   // ONE commit on the far runtime; per-record isolation
    catch (e) { inIngest = false; inflight = null; fail(e, to.where); return }
    inIngest = false
    const ms = performance.now() - t1                                  // the whole call — this page's sink runs inside it
    const pageMs = sinkMs, engineMs = Math.max(0, ms - pageMs)        // engine (+ the conform harness) = the call minus this page's sink
    crossed++
    attest(crossedEl, crossed, 'runtime'); attest(echoedEl, echoed, 'runtime')
    measEl.innerHTML = `<b data-attested="measured">${f.bytes}</b> B · held <b data-attested="measured">${Math.round(held)}</b> ms for the eye<br>ingest <b data-attested="measured">${ms2(engineMs)}</b> ms · this page's sink <b data-attested="measured">${ms2(pageMs)}</b> ms · this machine`
    measEl.hidden = false
    to.last.innerHTML = `<code>ingest(${to.v}, wb.records, { origin: fromWire })</code><br>applied <b data-attested="runtime">${report.applied}</b> · rejected <b data-attested="runtime">${report.rejected}</b>`
    let same = false, err = null
    try { same = deepEq(here.snapshot(), there.snapshot()) } catch (e) { err = e }
    if (err) fail(err, to.where)
    else status(`fold(wire) ≡ ${to.where} · checked at seq <span class="seq" data-attested="runtime">${esc(wb.seq)}</span> · <span class="${same ? 'ok' : 'bad'}">${same ? 'identical' : 'diverged'}</span>`)
    window.__wire.crossed = crossed; window.__wire.identical = same
    landings.push({ dir: `${from.name}→${to.name}`, seq: wb.seq, records: wb.records.length, applied: report.applied, rejected: report.rejected, identical: same, bytes: f.bytes, held, ms, pageMs, engineMs })
    if (landings.length > 200) landings.splice(0, landings.length - 200)   // a probe log, not a leak
    inflight = null
    if (queue.length) { const [side, ks] = queue.shift(); write(side, ks) } else schedule()
  }
  // the far side's sink applied a batch carrying fromWire — its wireSink was suppressed (clause 6)
  function arrived(side) {
    echoRing(side === S.A)
    put(viaEl, 'own origin · suppressed'); viaEl.classList.add('echo')
    clearTimeout(viaT); viaT = setTimeout(() => { put(viaEl, 'wireSink → ingest'); viaEl.classList.remove('echo') }, 1500)
  }
  function attach() {
    if (wired) return
    wired = true
    wireSink(here, wb => cross(wb, S.A), { origin: fromWire })                     // emits the seq-0 snapshot NOW
    wireSink(there, wb => cross(wb, S.B), { origin: fromWire, initial: false })
  }

  /* ---------- writes: one key = a bare write; two keys = batch(() => { … }) → ONE commit ---------- */
  const bump = prev => {                        // input: a random step of 10–80, never below 10
    let step = (1 + Math.floor(Math.random() * 8)) * 10 * (Math.random() < 0.5 ? -1 : 1)
    if (prev + step < 10) step = -step
    return prev + step
  }
  function write(side, ks) {
    if (!wired) attach()
    if (inflight) { queue.push([side, ks]); return }
    ks = ks.filter(k => side.h.get(k).snapshot() !== undefined)
    if (!ks.length) return
    const one = k => side.h.get(k).set('qty', bump(side.h.get(k).snapshot().qty))
    try {
      if (ks.length > 1) side.rt.batch(() => { for (const k of ks) one(k) })
      else one(ks[0])
    } catch (e) { fail(e, side.where); return }
    // the foot prints the call just issued, its value read back from the WireBatch the engine emitted
    const recs = inflight ? inflight.wb.records : []
    const val = k => { const r = recs.find(r => r.k === k); return r ? `<b data-attested="runtime">${esc(r.v)}</b>` : '…' }
    const calls = ks.map(k => `${side.v}.get('${k}').set('qty', ${val(k)})`)
    side.last.innerHTML = `<code>${ks.length > 1 ? `${side.batchName}(() => { ${calls.join('; ')} })` : calls[0]}</code>`
  }

  /* ---------- the idle writer (input: mostly A, every third B, every fourth a two-row batch) ---------- */
  let idleT = 0, tick = 0, active = false, shown = !root.hidden, seen = false
  const keys = side => [...side.rowEl.keys()]
  const pick = side => { const ks = keys(side); return ks[Math.floor(Math.random() * ks.length)] }
  const idle = () => {
    idleT = 0
    if (!active) return
    if (inflight) { schedule(); return }
    tick++
    if (tick % 4 === 0) { const a = pick(S.A); let b = pick(S.A); while (b === a) b = pick(S.A); write(S.A, [a, b].sort()) }
    else { const side = tick % 3 === 0 && S.B.rowEl.size ? S.B : S.A; write(side, [pick(side)]) }
  }
  function schedule() { clearTimeout(idleT); idleT = 0; if (active && !REDUCED) idleT = setTimeout(idle, IDLE) }
  const sync = () => {
    active = shown && seen && !document.hidden
    if (!active) { clearTimeout(idleT); idleT = 0; return }
    if (!wired) attach(); else if (!inflight) schedule()
  }
  root.addEventListener('variantshow', () => { shown = true; sync() })
  root.addEventListener('varianthide', () => { shown = false; sync() })
  document.addEventListener('visibilitychange', sync)
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(es => { seen = es.some(e => e.isIntersecting); sync() }, { rootMargin: '80px' }).observe(q('wire-card-a'))
  } else { seen = true; sync() }

  /* ---------- clicks (and Enter / Space) on either table = a real write on that runtime ---------- */
  for (const side of [S.A, S.B]) {
    const go = e => {
      const tr = e.target.closest('.wire-tr'); if (!tr || !side.tbl.contains(tr)) return
      e.preventDefault()
      write(side, [tr.dataset.k]); schedule()
    }
    side.tbl.addEventListener('click', go)
    side.tbl.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') go(e) })
  }
  window.__wire.write = (which, ks) => write(which === 'B' ? S.B : S.A, ks)   // for the probe script
}
