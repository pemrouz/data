/* sections/race/flights-worker.js — the flights loader, OFF the main thread (stage 3).
 *
 * The page's frame loop must stay at 60 fps while 37 MB arrives and is parsed, so the
 * fetch, the parse and the column projection all happen here; the main thread only
 * receives progress messages and, at the end, six transferable typed columns + the
 * airport-code table, from which race/brush.js builds the row objects in chunks
 * across frames.
 *
 * The dataset (data/flights.js, the old crossfilter example's) is an ES module —
 * `export const data = { "0": { date, delay, distance, origin, destination }, … }` —
 * whose object literal is valid JSON (every key and value is a quoted string), so it
 * is JSON.parse'd from the first `{` instead of import()ed: an import() would
 * evaluate the 37 MB literal on the main thread in one task.
 *
 * Projection, per the old multidim parse() (ref/multidim/main.js):
 *   date     "MMDDhhmm" → a 2001 timestamp (ms). UTC, and the hours/minutes are read
 *            off the string directly — the old code built a LOCAL Date and read
 *            getHours() back, which is the same number except across a DST gap.
 *   time     hours + minutes / 60
 *   delay    clamped to [-60, 149]
 *   distance ≤ 1999
 *   origin / destination → indices into a code table (transferred as a small array)
 * Nothing here prints a number; the main thread attests what it receives. */
self.onmessage = async ({ data: { url } }) => {
  try {
    const t0 = performance.now()
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
    const total = +res.headers.get('content-length') || 0
    let received = 0, lastPost = 0
    const chunks = []
    if (res.body && res.body.getReader) {
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value); received += value.byteLength
        const now = performance.now()
        if (now - lastPost > 40) { lastPost = now; self.postMessage({ type: 'progress', received, total }) }
      }
    } else {
      const buf = new Uint8Array(await res.arrayBuffer()); chunks.push(buf); received = buf.byteLength
    }
    self.postMessage({ type: 'progress', received, total: total || received })
    const tFetch = performance.now()

    self.postMessage({ type: 'stage', stage: 'parsing' })
    const buf = new Uint8Array(received)
    let off = 0
    for (const c of chunks) { buf.set(c, off); off += c.byteLength }
    chunks.length = 0
    const text = new TextDecoder().decode(buf)
    const start = text.indexOf('{')
    if (start < 0) throw new Error('flights.js: no object literal found')
    const obj = JSON.parse(text.slice(start))
    const tParse = performance.now()

    self.postMessage({ type: 'stage', stage: 'projecting' })
    const keys = Object.keys(obj), N = keys.length
    const date = new Float64Array(N), time = new Float64Array(N), delay = new Int16Array(N), distance = new Int16Array(N)
    const orig = new Uint16Array(N), dest = new Uint16Array(N)
    const codes = [], codeIx = new Map()
    const ix = c => { let i = codeIx.get(c); if (i === undefined) { i = codes.length; codes.push(c); codeIx.set(c, i) } return i }
    let n = 0
    for (let j = 0; j < N; j++) {
      const d = obj[keys[j]]
      if (!d) continue
      const s = String(d.date)
      const mo = +s.slice(0, 2) - 1, dd = +s.slice(2, 4), hh = +s.slice(4, 6), mi = +s.slice(6, 8)
      date[n] = Date.UTC(2001, mo, dd, hh, mi)
      time[n] = hh + mi / 60
      delay[n] = Math.max(-60, Math.min(149, +d.delay))
      distance[n] = Math.min(1999, +d.distance)
      orig[n] = ix(d.origin); dest[n] = ix(d.destination)
      n++
    }
    const tProject = performance.now()
    self.postMessage(
      { type: 'rows', n, bytes: received, date, time, delay, distance, orig, dest, codes, ms: { fetch: tFetch - t0, parse: tParse - tFetch, project: tProject - tParse } },
      [date.buffer, time.buffer, delay.buffer, distance.buffer, orig.buffer, dest.buffer],
    )
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err?.message || err) })
  }
}
