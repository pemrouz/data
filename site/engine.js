// site/engine.js — the ONE place the page boots the real engine.
// Every section does `import { api, contract, attest, put, fmt, fps, REDUCED } from '../engine.js'`;
// the module graph dedups, so there is exactly one runtime on the page (sections that need a
// SECOND runtime — the wire — construct it themselves via api.Runtime / handleFor).
//
// The footer's `engine · live` (#engine) is an attestation: it flips only after the real
// `api/index.js` (type-stripped, unbundled, served from ./lib) has been imported.
export const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
export const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

const status = document.querySelector('#engine')
const set = (t, cls) => { if (status) { status.textContent = t; status.classList.remove('ok', 'bad'); if (cls) status.classList.add(cls) } }
set('engine · loading')
let api, contract
try {
  api = await import('data')
  contract = await import('data/contract')
} catch (e) {
  set('engine · failed to load', 'bad')
  throw e
}
export { api, contract }

// attest(el, value, tier): write an engine-produced ('runtime'), in-tab measured ('measured') or
// build-time ('build') value and stamp its provenance. tools/audit.mjs fails the page on any
// digit-bearing text that is not attested (or inside pre/code/[data-literal]). Never print a
// number without it.
export function attest(el, value, tier = 'runtime') {
  if (!el) return
  const s = typeof value === 'number' ? fmt(value) : String(value)
  if (el.textContent !== s) el.textContent = s
  if (el.getAttribute('data-attested') !== tier) el.setAttribute('data-attested', tier)
}
export function put(el, s) { if (el && el.textContent !== s) el.textContent = s }
export const fmt = (v, d = 0) => typeof v === 'number' && Number.isFinite(v)
  // an integer prints no decimals unless d asks for them; min must never exceed max (RangeError)
  ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: Number.isInteger(v) ? Math.max(d, 0) : Math.max(d, 2) })
  : String(v)

// the honest frame meter: window.__fpsSamples (rAF deltas, ms); tools/probe.mjs reads it.
export function fps() {
  const samples = (window.__fpsSamples ||= [])
  window.__perf ||= {}
  let last = performance.now()
  return {
    tick(now = performance.now()) { samples.push(now - last); last = now; if (samples.length > 600) samples.splice(0, samples.length - 600) },
    median() { const s = samples.slice(-120).sort((a, b) => a - b); if (!s.length) return 0; const m = s[s.length >> 1]; return m > 0 ? Math.round(1000 / m) : 0 },
  }
}

// what this page actually pulled from ./lib (resource timing) — the footer's two figures
export function libResources() {
  let n = 0, bytes = 0
  for (const r of performance.getEntriesByType('resource')) {
    if (!/\/lib\/.*\.js$/.test(r.name)) continue
    n++; bytes += r.transferSize || r.encodedBodySize || 0
  }
  return { n, kb: bytes / 1024 }
}

// the page-wide frame loop: one rAF, many subscribers (sections register a tick; they must be
// cheap and must return immediately while hidden/off-screen)
const ticks = new Set()
export function onFrame(fn) { ticks.add(fn); return () => ticks.delete(fn) }
const meter = fps()
// re-arm BEFORE running the ticks and guard each one: a throwing tick (clause 4 surfaces a failing
// effect sink as an AggregateError from the write that committed) must not take the page's loop down
function loop(now) {
  requestAnimationFrame(loop)
  meter.tick(now)
  for (const t of ticks) { try { t(now) } catch (e) { console.error(e) } }
}
requestAnimationFrame(loop)

// footer attestation
set('engine · live', 'ok'); status?.setAttribute('data-attested', 'runtime')
const ver = document.querySelector('#ver'); if (ver) attest(ver, contract.SCHEDULE_VERSION)
function footer() {
  const r = libResources()
  const m = document.querySelector('#mods'), k = document.querySelector('#kb')
  if (m) attest(m, r.n, 'measured'); if (k) attest(k, Math.round(r.kb), 'measured')
}
footer(); setTimeout(footer, 1500)
window.__engine = { api, contract }
