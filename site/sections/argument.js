/* sections/argument.js — §01 The argument.
   b (THE PICK) · the strip is the REAL engine. trades = $({ t1…t5 }) — five rows;
     buys = trades.filter(t => t.side === 'buy'); largest = buys.za('qty', 2);
     volume = buys.sum('qty'). The DOM card's cell is render(host, text(trades.t3.qty))
     — the engine's own text node — watched by a MutationObserver (text / added /
     removed per commit, read with takeRecords() right after the write).
     "run it ▸" issues trades.t3.qty.update(v) with v alternating 500 ↔ 380 (a
     same-value write is a kernel no-op — no phantom commits — so it must alternate;
     the call issued is printed). The DELTA card prints the RowDelta trades.sink()
     delivered (op / key / path / prev / row) and its batch's seq; the VIEWS card
     reads the views' own sinks: buys via sink() (what filter emitted), largest via
     sink({ wantsOrder: true }) with the order channel replayed onto a local rank
     mirror (a WINDOWED za emits the survivor's orderMove, so t3's rank before → after
     is derived, not read off a delta's key), volume via connect(anchor, fn) records
     (sink() throws on scalars by design — prev → next is the previous and the
     current record's value); the per-node line and the status line's seq · origin ·
     nodes come from runtime().onCommit's CommitInfo (the hook lives only around the
     write, so other sections' commits stay unmeasured). The status ms is ONE
     performance.now() interval around the write call (commit + effects, the DOM
     text write included), printed at the tab's clock resolution — Chromium clamps
     performance.now() to 100 µs unless cross-origin isolated, so the kernel's four
     separately-clamped per-node readings summed to a figure made of quantization
     (0.000 / 0.100 / 0.200 with three decimals the clock cannot back); one interval,
     quantized once, printed as '< 0.1' when it is below a tick, is the honest
     instrument. The clock resolution itself is measured at boot (a spin until
     performance.now() changes).
     The cards are the record of the LAST COMMIT THE BUTTON ISSUED (the only write
     path a visitor has); the DOM cell alone is the engine's live node — a probe
     writing through window.__argument.trades moves the cell at once and the cards
     on the next click (whose prev / volume / rank then start from the probe's value).
     The left-to-right sweep is PRESENTATION of that commit: every figure is written
     synchronously before it starts and none is sourced from it; under
     prefers-reduced-motion there is no sweep at all. The rest state is a real
     boot-time write (500 → 380) so first paint shows a landed commit, never '—'.
   a (not picked, untouched) · static, no script. */
import { api, attest, put, fmt, REDUCED } from '../engine.js'

const root = document.getElementById('argument')
const vb = root && root.querySelector('[data-variant="b"]')

if (vb) {
  const { $, value, node, render, text, runtime } = api
  const q = (id) => vb.querySelector('#' + id)

  /* ---------- the graph (synthetic INPUT; every output below is the engine's) ---------- */
  const trades = $({
    t1: { sym: 'AAPL', side: 'buy', qty: 200, px: 187.5 },
    t2: { sym: 'MSFT', side: 'buy', qty: 450, px: 412.2 },
    t3: { sym: 'AAPL', side: 'buy', qty: 500, px: 188.1 },
    t4: { sym: 'NVDA', side: 'sell', qty: 320, px: 121.4 },
    t5: { sym: 'TSLA', side: 'buy', qty: 140, px: 251.9 },
  })
  const buys = trades.filter((t) => t.side === 'buy')
  const largest = buys.za('qty', 2)
  const volume = buys.sum('qty')
  const KEY = 't3'
  const A = 380, B = 500 // the two values the button alternates between

  const srcId = trades[node].id
  const views = [buys, largest, volume]
  const viewIds = new Set(views.map((v) => v[node].id))
  const opName = new Map(views.map((v) => [v[node].id, v[node].opName]))

  /* ---------- the elements ---------- */
  const cards = [...vb.querySelectorAll('.arg-card')]
  const arrows = [...vb.querySelectorAll('.arg-arrow')]
  const btn = q('arg-run-b')
  const callV = q('arg-call-v-b')
  const rowsEl = q('arg-rows-b'), symEl = q('arg-row-sym-b'), rowEl = q('arg-row-b')
  const deltaEl = q('arg-delta-b'), seqEl = q('arg-seq-b'), nrowsEl = q('arg-nrows-b')
  const buysEl = q('arg-buys-b'), largestEl = q('arg-largest-b'), volumeEl = q('arg-volume-b'), nodesEl = q('arg-nodes-b')
  const host = q('arg-cell-b')
  const moText = q('arg-mo-text-b'), moAdd = q('arg-mo-add-b'), moRem = q('arg-mo-rem-b')
  const stSeq = q('arg-st-seq-b'), stOrigin = q('arg-st-origin-b'), stNodes = q('arg-st-nodes-b'), stMs = q('arg-st-ms-b'), stText = q('arg-st-text-b')
  const LABEL = { first: btn.textContent, again: 'run again ▸' }

  /* ---------- what the last commit delivered (filled by the sinks, synchronously) ---------- */
  const last = { call: undefined, src: null, buys: null, largest: null, info: null, mo: null, ms: 0 }

  // the source's own CommitBatch, by reference (the DELTA card)
  trades.sink({ apply(b) { last.src = b } })
  // what filter emitted for this commit (the buys chip)
  buys.sink({ apply(b) { last.buys = b } })
  // the ordered view: init hands the window's order; apply replays the order channel
  // (orderRemove → orderInsert → orderMove, in array order, after row deltas) onto a
  // local rank mirror — t3's rank before → after falls out of the replay
  let rank = []
  largest.sink({
    wantsOrder: true,
    init(_snapshot, order) { rank = order ? [...order] : [] },
    apply(b) {
      const before = rank.indexOf(KEY)
      for (const od of b.order ?? []) {
        if (od.op === 'orderRemove') rank.splice(od.index, 1)
        else if (od.op === 'orderInsert') rank.splice(od.index, 0, od.key)
        else { rank.splice(od.from, 1); rank.splice(od.index, 0, od.key) }
      }
      last.largest = { batch: b, before, after: rank.indexOf(KEY) }
    },
  })
  // the scalar: the v2 record profile — the opening record is the current value,
  // then one { type: 'update', key: [], value } per scalar delta
  let vol = { prev: undefined, next: undefined }
  volume.connect({}, (r) => { if (r.type === 'update' && r.key.length === 0) vol = { prev: vol.next, next: r.value } })

  /* ---------- the DOM card: the engine's text node, under observation ---------- */
  render(host, text(trades.t3.qty))
  const mo = new MutationObserver(() => {}) // read synchronously via takeRecords() after each write
  mo.observe(host, { childList: true, characterData: true, subtree: true })

  /* ---------- the write ---------- */
  function write(v) {
    last.src = last.buys = last.largest = last.info = null
    last.call = v
    // the CommitInfo hook lives only around this write: the kernel measures per-node
    // settle ms while a hook is live, and other sections' commits stay unmeasured
    const hook = runtime().onCommit((c) => { if (c.nodes.some((n) => n.id === srcId)) last.info = c })
    const t0 = performance.now()
    try {
      trades.t3.qty.update(v) // one deep-path write → one synchronous commit (settle + effects + the DOM text)
    } finally {
      last.ms = performance.now() - t0
      hook.dispose()
    }
    let t = 0, added = 0, removed = 0
    for (const r of mo.takeRecords()) {
      if (r.type === 'characterData') t++
      added += r.addedNodes.length
      removed += r.removedNodes.length
    }
    last.mo = { text: t, added, removed }
  }

  /* ---------- printing ---------- */
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
  const leaf = (o, path) => path.reduce((x, k) => (x == null ? undefined : x[k]), o)
  const P = (s) => `<span class="tok-pun">${s}</span>`
  const lit = (v) => (typeof v === 'string' ? `<span class="tok-str">'${esc(v)}'</span>` : `<span class="tok-num">${esc(v)}</span>`)
  // the RowDelta as the algebra spells it; rows are elided to the written leaf
  function deltaHtml(d) {
    if (d.op === 'update') {
      const path = d.path
      const pathS = P('[') + path.map((k) => `<span class="arg-path">'${esc(k)}'</span>`).join(P(', ')) + P(']')
      const at = path.length ? esc(path[path.length - 1]) : 'row'
      const rowS = (r) => path.length
        ? `${P('{')} …${P(',')} ${at}${P(':')} ${lit(leaf(r, path))} ${P('}')}`
        : lit(JSON.stringify(r))
      return `${P('{')} op${P(':')} <span class="tok-str">'update'</span>${P(',')} key${P(':')} <span class="arg-path">'${esc(d.key)}'</span>${P(',')}\n` +
        `  path${P(':')} ${pathS}${P(',')}\n` +
        `  prev${P(':')} ${rowS(d.prev)}${P(',')}\n` +
        `  row${P(':')}  ${rowS(d.row)} ${P('}')}`
    }
    const r = d.op === 'add' ? d.row : d.prev
    return `${P('{')} op${P(':')} <span class="tok-str">'${esc(d.op)}'</span>${P(',')} key${P(':')} <span class="arg-path">'${esc(d.key)}'</span>${P(',')}\n` +
      `  ${d.op === 'add' ? 'row' : 'prev'}${P(':')} ${lit(JSON.stringify(r))} ${P('}')}`
  }
  const rankS = (i) => (i < 0 ? 'out' : '#' + fmt(i + 1))
  // the tab's performance.now() granularity, measured (Chromium: 100 µs unless cross-origin
  // isolated; Firefox: 1 ms). An interval is printed at this precision, never finer, and
  // one that is below a tick is printed as '< tick' — never as a decimal the clock cannot back.
  const RES = (() => {
    let min = Infinity
    for (let i = 0; i < 4; i++) { const a = performance.now(); let b; while ((b = performance.now()) === a); min = Math.min(min, b - a) }
    return min
  })()
  const DEC = Math.max(0, Math.min(3, Math.ceil(-Math.log10(RES) - 1e-6)))
  const msS = (t) => (t < RES ? '< ' + RES.toFixed(DEC) : t.toFixed(DEC))
  // a chip carries the accent only when the engine says its view MOVED (membership / rank / value)
  const chipHot = (el, moved) => { const c = el.closest('.arg-chip'); c.classList.toggle('is-hot', moved); c.classList.toggle('is-same', !moved) }

  function paint() {
    const b = last.src
    if (!b) return
    // WRITE — the call issued (input, inside <code>) and the source as the engine reads it back
    put(callV, String(last.call))
    attest(rowsEl, trades.rowCount())
    const row = trades.t3[value]
    put(symEl, `${row.sym} · ${row.side}`)
    attest(rowEl, trades.t3.qty[value])
    // DELTA — the RowDelta for the written key, from the source's batch
    const d = b.rows.find((x) => x.key === KEY) ?? b.rows[0]
    deltaEl.innerHTML = deltaHtml(d)
    deltaEl.setAttribute('data-attested', 'runtime')
    attest(seqEl, b.seq)
    attest(nrowsEl, b.rows.length)
    // VIEWS — each from its own sink; "re-tested · stays" only when filter emitted nothing
    const info = last.info
    const buysDeltas = info ? (info.nodes.find((n) => n.id === buys[node].id)?.deltas ?? 0) : 0
    const bb = last.buys
    attest(buysEl, buysDeltas === 0 || !bb
      ? 're-tested · stays'
      : bb.rows.map((x) => `${x.op} ${x.key}` + (x.op === 'update' ? ' · stays in' : x.op === 'add' ? ' · now in' : ' · now out')).join(', '))
    chipHot(buysEl, !!bb && buysDeltas > 0 && bb.rows.some((x) => x.op !== 'update')) // membership changed
    const L = last.largest
    const before = L ? L.before : rank.indexOf(KEY), after = L ? L.after : before
    attest(largestEl, before === after ? `${rankS(after)} · stays` : `${rankS(before)} → ${rankS(after)}`)
    chipHot(largestEl, before !== after)
    attest(volumeEl, vol.prev === undefined ? fmt(vol.next) : `${fmt(vol.prev)} → ${fmt(vol.next)}`)
    chipHot(volumeEl, vol.prev !== undefined && !Object.is(vol.prev, vol.next))
    if (info) attest(nodesEl, info.nodes.filter((n) => viewIds.has(n.id)).map((n) => `${opName.get(n.id)} ${fmt(n.deltas)}`).join(' · ') + ' deltas')
    // DOM — the MutationObserver's count for this commit (the cell itself is the engine's text node)
    const m = last.mo
    attest(moText, m.text, 'measured'); attest(moAdd, m.added, 'measured'); attest(moRem, m.removed, 'measured')
    // STATUS — the CommitInfo
    if (info) {
      attest(stSeq, info.seq)
      put(stOrigin, String(info.origin.description ?? 'user'))
      attest(stNodes, info.nodes.length)
      attest(stMs, msS(last.ms), 'measured') // the write call, wall-clock, at the clock's resolution
      stMs.title = `performance.now() resolves to ${RES.toFixed(DEC)} ms in this tab; the interval is the whole write call (commit + effects)`
      attest(stText, m.text, 'measured')
    }
  }

  /* ---------- the sweep: presentation of the commit (never the source of a figure) ---------- */
  const STEP = 260
  let timers = [], running = false
  const at = (ms, fn) => timers.push(setTimeout(fn, ms))
  const flash = (el) => { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash') }
  const swap = (el, a, b) => { el.classList.remove(a); el.classList.add(b) }
  function clearSweep() {
    for (const t of timers) clearTimeout(t)
    timers = []
    for (const c of cards) c.classList.remove('lit', 'wait', 'done')
    for (const a of arrows) a.classList.remove('lit', 'wait')
  }
  function rest() { clearSweep(); running = false; btn.disabled = false }

  function run() {
    if (running) return
    running = true
    btn.disabled = true
    write(trades.t3.qty[value] === A ? B : A) // the engine commits here, synchronously
    paint()                                    // every figure lands now, before any motion
    btn.textContent = LABEL.again
    if (REDUCED) { rest(); return }
    // light the cards in the commit's order — source → its batch → the views → the effect (DOM)
    const hot = [[callV, rowEl], [seqEl, nrowsEl], [buysEl, largestEl, volumeEl], [host]]
    for (const c of cards) c.classList.add('wait')
    for (const a of arrows) a.classList.add('wait')
    cards.forEach((card, i) => at(i * STEP, () => {
      if (i > 0) { swap(cards[i - 1], 'lit', 'done'); swap(arrows[i - 1], 'wait', 'lit') }
      swap(card, 'wait', 'lit')
      for (const el of hot[i]) flash(el)
    }))
    at(3 * STEP + 420, () => swap(cards[3], 'lit', 'done'))
    at(3 * STEP + 900, rest)
  }

  /* ---------- boot: a real write so the rest state is a landed commit ---------- */
  write(A)
  paint()
  btn.addEventListener('click', run)
  vb.addEventListener('varianthide', rest) // hidden mid-sweep: drop the timers, keep the (real) figures

  // probe hook for the scratch checks (read-only handles; the engine itself is window.__engine)
  window.__argument = { trades, buys, largest, volume, last, rank: () => rank.slice(), vol: () => vol }
}
