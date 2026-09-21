/* sections/race/flights.js — the main-thread half of the flights loader (stage 3).
 *
 * start() spawns race/flights-worker.js (fetch → JSON.parse → typed columns, all off
 * the main thread) and mirrors its progress into `st`; step(budget) then turns the
 * transferred columns into the row objects `$(flights)` will adopt, ≤ budget ms per
 * call, so the caller can spread the 231k-object build across frames behind the
 * progress line. Phases: idle → fetching → parsing → projecting (worker) → building
 * (here, chunked) → ready (st.flights is the array) | error. */
export function makeFlightsLoader ({ url }) {
  const st = { phase: 'idle', received: 0, total: 0, cols: null, flights: null, i: 0, n: 0, error: null, ms: {}, bytes: 0 }
  let worker = null
  const fail = (msg) => { st.error = msg; st.phase = 'error'; worker?.terminate(); worker = null }
  function start () {
    if (st.phase !== 'idle') return
    st.phase = 'fetching'
    try { worker = new Worker(new URL('./flights-worker.js', import.meta.url)) } catch (e) { fail(String(e?.message || e)); return }
    worker.onmessage = ({ data: m }) => {
      if (m.type === 'progress') { st.received = m.received; st.total = m.total }
      else if (m.type === 'stage') st.phase = m.stage
      else if (m.type === 'rows') { st.cols = m; st.n = m.n; st.bytes = m.bytes; st.ms = { ...m.ms }; st.flights = new Array(m.n); st.i = 0; st.phase = 'building'; worker.terminate(); worker = null }
      else if (m.type === 'error') fail(m.message)
    }
    worker.onerror = e => fail(e?.message || 'worker error')
    worker.postMessage({ url })
  }
  // the chunked projection: plain row objects from the typed columns
  function step (budget = 6) {
    if (st.phase !== 'building') return false
    const { n, date, time, delay, distance, orig, dest, codes } = st.cols
    const out = st.flights, t0 = performance.now()
    while (st.i < n) {
      const to = Math.min(n, st.i + 4000)
      for (let i = st.i; i < to; i++) out[i] = { date: date[i], time: time[i], delay: delay[i], distance: distance[i], origin: codes[orig[i]], destination: codes[dest[i]] }
      st.i = to
      if (performance.now() - t0 >= budget) break
    }
    st.ms.build = (st.ms.build || 0) + (performance.now() - t0)
    if (st.i >= n) { st.phase = 'ready'; st.cols = null; return true }
    return false
  }
  return { st, start, step }
}
