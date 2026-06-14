// data • perf control room — an INDEX-FIRST report, and itself a `data` app.
//
// Every harness emits one universal JSON row; the page flattens them into a
// single $(rows) source, derives STANDARDISED columns so metrics on wildly
// different scales (0.16ms vs 144ms vs integer op-counts) compare in one glance,
// and renders a scannable table where each row expands to its detail (chart /
// stats / trend). The overview scan row is intentionally minimal —
//   dot · id · value · ×mult · caret
// — with the trend sparkline and min/max band moved into the expanded detail
// (they restate the same K-window decision the dot already makes categorically,
// and aren't legible at 30-row density).
//
// The honest-vs-forced split (per the design): the $(rows) spine + sort/filter
// operators genuinely produce the table (the crossfilter case the lib wins on);
// each row's chart is rendered plainly from static recorded data.
import { $, value, render, HTML } from 'data/full'

const { span, b, div } = HTML

// ---- formatting + robust stats ---------------------------------------------
const fmt = (v, d = 2) => (v == null || Number.isNaN(v) ? '–' : (+v).toFixed(d))
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
const fmtN = n => (n >= 1000 ? `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}k` : `${n}`)
const pctOf = (a, b) => `${Math.round((a / b) * 100)}%`
const clamp01 = x => Math.max(0, Math.min(1, x))
const median = a => {
  if (!a.length) return undefined
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const MAD = a => {
  const m = median(a)
  return m == null ? undefined : median(a.map(v => Math.abs(v - m)))
}
const quantile = (a, q) => {
  const s = [...a].sort((x, y) => x - y), i = (s.length - 1) * q
  const lo = Math.floor(i), hi = Math.ceil(i)
  return s[lo] + (s[hi] - s[lo]) * (i - lo)
}

const report = await fetch('./perf.json').then(r => r.json())
const K = 5 // trend window: prior K runs feed the baseline

// ---- the spine: every metric row, with direction-of-good as DATA ------------
const rows = Object.values(report.harnesses).flatMap(h => h.rows)
// goodSign: -1 = lower-is-better (timing/work), +1 = higher-is-better (throughput),
// 0 = bool. Direction is a row field (`dir`); the regex is a legacy fallback only.
const goodSign = r =>
  r.kind === 'bool' ? 0
  : r.dir === 'up' ? +1
  : r.dir === 'down' ? -1
  : /saved|throughput|hits|ops|dispatch/.test(r.id) ? +1
  : -1

function histOf(id) {
  const series = report.history.map(h => h.points[id]).filter(v => v != null) // chronological
  const commits = report.history.map(h => h.run.commit)
  const n = series.length
  const baseSamples = series.slice(0, -1).slice(-K) // prior K, excludes current
  const winCommits = commits.slice(0, -1).slice(-K)
  const distinctCommits = new Set(winCommits).size || (commits.length ? 1 : 0)
  return { series, n, cur: series[n - 1], baseSamples, distinctCommits,
    min: series.length ? Math.min(...series) : undefined,
    max: series.length ? Math.max(...series) : undefined }
}

// band(): the categorical verdict driving the dot + the chip colour + the gate.
// Sets r._mult. Timing fails on a CONJUNCTION of magnitude AND significance
// (so run-noise can't trip it). count is deterministic — any drift is real.
function band(r) {
  if (r.kind === 'bool') return r.value ? 'pass' : 'fail'
  const h = histOf(r.id), nb = h.baseSamples.length
  if (nb === 0) return 'new'
  const base = median(h.baseSamples)
  if (base == null) return 'na'
  const ratio = goodSign(r) < 0 ? r.value / base : base / r.value // >1 always worse, any dir
  r._mult = ratio
  // count is deterministic — any drift is real. base===0 is a legitimately-zero
  // count (e.g. H6 self-regression with no regressions): 0→0 is pass, 0→n is a
  // real appearance (fail for a down metric), not the 0/0=NaN→gain mislabel.
  if (r.kind === 'count') {
    if (base === 0) { r._mult = r.value === 0 ? 1 : Infinity; return r.value === 0 ? 'pass' : goodSign(r) < 0 ? 'fail' : 'gain' }
    return ratio === 1 ? 'pass' : ratio > 1 ? 'fail' : 'gain'
  }
  // significance is direction-free (|deviation| beyond noise); ratio already carries
  // the worse/better direction, so no oriented compare is needed.
  const med = median(h.baseSamples), mad = MAD(h.baseSamples) || 1e-9
  const significant = nb >= 3 && Math.abs(r.value - med) > 3 * 1.4826 * mad // ~3σ via MAD
  if (ratio >= 1.4 && significant) return 'fail'
  if (ratio >= 1.1) return 'warn'
  if (ratio <= 0.9 && significant) return 'gain'
  return 'pass'
}

const SEV = { fail: 3, warn: 2, na: 1, new: 1, pass: 0, gain: 0 }
const nbConf = nb => (nb === 0 ? 'new' : nb < 3 ? 'provisional' : nb < 5 ? 'thin' : 'full')
// A single-commit history is run-noise, not a trend — cap EVERY row at 'thin'.
const confidence = (nb, dc) => (dc < 2 ? (nb === 0 ? 'new' : 'thin') : nbConf(nb))

const distinctCommits = new Set(report.history.map(h => h.run.commit)).size

// decorate each row once: _band / _mult / _sev / _conf / _h(istory)
for (const r of rows) {
  r._h = histOf(r.id)
  r._band = band(r) // sets r._mult
  if (r._mult == null) r._mult = NaN
  r._conf = confidence(r._h.baseSamples.length, r._h.distinctCommits)
  // Under <2 distinct commits the history is run-NOISE: we cannot substantiate a
  // drift/regression/improvement, so keep the dot calm (the provisional ×mult chip
  // still shows the raw ratio). Real warn/fail/gain only once cross-commit data lands.
  if (distinctCommits < 2 && (r._band === 'warn' || r._band === 'fail' || r._band === 'gain')) r._band = 'pass'
  r._sev = SEV[r._band] ?? 0
}

// ---- dogfood spine: $(rows) drives the live index + the table order ---------
const results = $(rows)
const total = results.length()
const densify = v => Object.values(v || {}).filter(x => x && typeof x === 'object' && x.id)

const SORTS = {
  severity: v => v.za('_sev'),
  worst: v => v.za('_mult'),
  value: v => v.za('value'),
  id: v => v.az('id'),
  harness: v => v.az('harness'),
}
// Default sort falls back to magnitude when nothing is a regression (today's
// single-commit reality: every _sev is 0, so za('_sev') would be a no-op).
const state = { sort: rows.every(r => r._sev === 0) ? 'worst' : 'severity', group: true, q: '', expandAll: false }

// ---- toolbar reactive count + trust line ------------------------------------
render(document.querySelector('#summary'), span(
  b.text(total.to(n => `${n} metric${n === 1 ? '' : 's'}`)),
  span.dim.text(` · ${report.history.length} runs / ${distinctCommits} commit${distinctCommits === 1 ? '' : 's'} · ${distinctCommits < 2 ? 'run-noise' : 'cross-commit'}`),
))

// ---- the index table (hierarchy: harness → operator → case) -----------------
const HARNESS_ORDER = ['ops', 'H0', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7']
const indexEl = document.querySelector('#index')

function ordered() {
  const q = state.q.trim().toLowerCase()
  const base = q
    ? results.filter(r => r.id.toLowerCase().includes(q) || r.harness.toLowerCase().includes(q))
    : results
  return densify(SORTS[state.sort](base)[value]) // a real sort operator produces the order
}

function harnessOrder(list) {
  const present = [...new Set(list.map(r => r.harness))]
  return [...HARNESS_ORDER.filter(h => present.includes(h)), ...present.filter(h => !HARNESS_ORDER.includes(h))]
}
const leafLabel = r => r.case || r.op || r.id
const flatLabel = r => `${r.op || r.id}${r.case ? ` · ${r.case}` : ''}`

function renderIndex() {
  const list = ordered()
  indexEl.innerHTML = ''
  if (!list.length) {
    indexEl.innerHTML = `<p class="ix-empty">no metrics match “${esc(state.q)}”.</p>`
    return
  }
  // flat: every leaf row, no nesting
  if (!state.group) {
    if (list.every(r => r._sev === 0)) indexEl.appendChild(emptyNote())
    for (const r of list) indexEl.appendChild(rowEl(r, 0, flatLabel(r)))
    return
  }
  // tree: harness (open) → operator group (collapsed) → case leaves.
  // Searching or "expand all" opens every level so matches are visible.
  const openMid = !!state.q.trim() || state.expandAll
  for (const H of harnessOrder(list)) {
    const hrows = list.filter(r => r.harness === H)
    if (!hrows.length) continue
    const hnode = nodeEl(0, H, report.harnesses[H]?.title || '', hrows, true)
    for (const r of hrows.filter(r => !r.group)) hnode.appendChild(rowEl(r, 1, leafLabel(r)))
    for (const G of [...new Set(hrows.filter(r => r.group).map(r => r.group))]) {
      const grows = hrows.filter(r => r.group === G)
      const gnode = nodeEl(1, G, '', grows, openMid)
      for (const r of grows) gnode.appendChild(rowEl(r, 2, leafLabel(r)))
      hnode.appendChild(gnode)
    }
    indexEl.appendChild(hnode)
  }
}

function emptyNote() {
  const p = document.createElement('p')
  p.className = 'ix-empty'
  p.textContent = 'no regressions — sorted by magnitude.'
  return p
}

// a collapsible tree node; roll-up dot = worst descendant severity
function nodeEl(level, name, title, rows, open) {
  const det = document.createElement('details')
  det.className = `ix-node lvl${level}`
  det.open = open
  const worst = rows.reduce((m, r) => (r._sev > m ? r._sev : m), 0)
  det.innerHTML =
    `<summary class="ix-node-head" style="padding-left:${(0.8 + level * 1.1).toFixed(2)}rem">` +
    `<span class="ix-ncaret">▸</span>` +
    `<span class="ix-dot ${dotClassFromSev(worst)}"></span>` +
    `<span class="ix-nname">${esc(name)}</span>` +
    (title ? `<span class="ix-ntitle">${esc(title)}</span>` : '') +
    `<span class="ix-ncount">${rows.length}</span>` +
    `</summary>`
  return det
}

function rowEl(r, depth = 0, label = r.op || r.id) {
  const det = document.createElement('details')
  det.className = 'ix-item'
  const dim = r.dims?.N ? ` <span class="ix-dim">N=${fmtN(r.dims.N)}</span>` : ''
  const pl = depth ? ` style="padding-left:${(0.4 + depth * 1.1).toFixed(2)}rem"` : ''
  det.innerHTML =
    `<summary class="ix-row" aria-expanded="false">` +
    `<span class="ix-dot ${dotClass(r)}" title="${r._band}"></span>` +
    `<span class="ix-id"${pl}>${esc(label)}${dim}</span>` +
    `<span class="ix-harness">${esc(r.harness)}</span>` +
    `<span class="ix-val">${fmt(r.value)}<span class="ix-unit">${r.unit ? ' ' + esc(r.unit) : ''}</span></span>` +
    multChip(r) +
    `<span class="ix-trend">${miniSpark(r)}</span>` +
    `<span class="ix-caret">▸</span>` +
    `</summary>`
  // lazy: build the heavy detail (SVG charts) only on first open
  det.addEventListener('toggle', () => {
    det.querySelector('summary').setAttribute('aria-expanded', String(det.open))
    if (det.open && !det._built) {
      det._built = true
      det.appendChild(detailFor(r))
    }
  })
  return det
}

// ---- standardised encodings -------------------------------------------------
function dotClassFromSev(sev) {
  return sev >= 3 ? 'bad' : sev === 2 ? 'watch' : sev === 1 ? 'na' : 'ok'
}
function dotClass(r) {
  if (r._band === 'fail') return r.kind === 'count' ? 'countbad' : 'bad'
  if (r._band === 'gain') return 'gain'
  if (r._band === 'warn') return 'watch'
  if (r._band === 'new' || r._band === 'na') return 'na'
  return 'ok'
}
// inline trend mini-spark (last N runs, oriented) — legible now there's a column
// for it; current point in accent (warn if the last move cleared a fail band).
function miniSpark(r) {
  const h = r._h
  if (h.n < 2 || r.kind === 'bool') return `<svg class="ix-mini" viewBox="0 0 100 22" aria-hidden="true"></svg>`
  const pts = h.series // raw values over runs (intuitive: up = the number went up)
  const W = 100, H = 22, pad = 3
  const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1
  const x = i => pad + (i / (pts.length - 1)) * (W - 2 * pad)
  const y = v => H - pad - ((v - lo) / span) * (H - 2 * pad)
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const last = pts.length - 1
  return `<svg class="ix-mini" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="trend, last ${h.n} runs">` +
    `<path class="ix-mini-line" d="${d}"/>` +
    `<circle class="${r._band === 'fail' ? 'ix-mini-bad' : 'ix-mini-cur'}" cx="${x(last).toFixed(1)}" cy="${y(pts[last]).toFixed(1)}" r="2"/></svg>`
}

function multChip(r) {
  if (r.kind === 'bool' || !isFinite(r._mult)) return `<span class="ix-mult flat">—</span>`
  const nb = r._h.baseSamples.length
  const prov = r._conf === 'thin' || r._conf === 'provisional' || r._conf === 'new' || nb < 3
  const caret = r._mult < 0.97 ? ' ▾' : r._mult > 1.03 ? ' ▴' : ''
  const cls = prov ? 'prov'
    : r._band === 'fail' ? 'bad'
    : r._band === 'warn' ? 'drift'
    : r._band === 'gain' ? 'good'
    : 'flat'
  return `<span class="ix-mult ${cls}" title="vs median of prior ${nb} run${nb === 1 ? '' : 's'}">×${fmt(r._mult)}${caret}${prov ? ' ⌁' : ''}</span>`
}

// ---- detail dispatch on harness ---------------------------------------------
function detailFor(r) {
  const wrap = document.createElement('div')
  wrap.className = 'ix-detail'
  if (r.harness === 'H4') wrap.appendChild(detailTail(r))
  else if (r.harness === 'H1') wrap.appendChild(detailScaling(r))
  else if (r.harness === 'H7') wrap.appendChild(detailCrossLib(r))
  else wrap.appendChild(detailGeneric(r))
  wrap.appendChild(detailFooter(r)) // shared: min/max band + trend spark + provenance
  return wrap
}

function detailTail(r) {
  const s = r.stats
  const el = document.createElement('div')
  el.innerHTML =
    `<div class="tile-cap">per-frame settle time across a ${r.dims.frames}-frame crossfilter
      brush — <b>${esc(r.op)}</b>. Bars over the ${r.dims.budget || 16}ms frame budget are
      <b>red</b>. y-axis is <b>log ms</b> so the 0.x–${fmt(s.max, 0)}ms span is legible.</div>
     <div class="chart-wrap">${chartSVG(r.frames, r.worst.at, r.dims.budget || 16)}</div>
     <div class="tile-badges">
       <span class="badge warn">${r.viol16} frames over 16ms <b>(${pctOf(r.viol16, r.dims.frames)})</b></span>
       <span class="badge warn">${r.viol33} over 33ms</span>
       <span class="badge warn">worst <b>${fmt(r.worst.ms)}ms</b> · ${esc(r.worst.op)} ${esc(r.worst.verb)} <span class="dim">(${esc(r.worst.note)})</span></span>
       <span class="badge">median-of-5 gate would report ~${fmt(s.p50)}ms and pass</span>
     </div>
     <div class="rcard-foot">${fstat('p50', s.p50)}${fstat('p95', s.p95)}${fstat('p99', s.p99)}${fstat('max', s.max)}</div>`
  return el
}

function detailScaling(r) {
  const el = document.createElement('div')
  const ins = r.instrument || {}
  const insBars = Object.entries(ins).map(([k, v]) =>
    `<div class="tcount-row"><span class="tcount-label">${esc(k)}</span><span class="tcount-bar"><span class="tcount-fill" style="width:${Math.min(100, v * 100)}%"></span></span><span class="tcount-val">${v}</span></div>`).join('')
  el.innerHTML =
    `<div class="tile-cap">incremental single-row insert at <b>N=${fmtN(r.dims.N)}</b>. The
      deterministic op-count below is the honest, machine-independent signal — a fresh
      insert evaluates the predicate once. <span class="dim">(this run)</span></div>
     <div class="rcard-foot">${fstat('value', r.value, r.unit)}${fstat('reads/insert', ins.readsPerInsert)}${fstat('N', r.dims.N, '', fmtN)}${fstat('dir', goodSign(r) < 0 ? '↓ lower' : '↑ higher', '', String)}</div>
     ${insBars ? `<div class="tcount-block" style="padding:.4rem 1.2rem">${insBars}</div>` : ''}`
  return el
}

function detailCrossLib(r) {
  const el = document.createElement('div')
  const peers = r.peers || []
  const maxS = Math.max(...peers.map(p => p.single || 0), 1e-9)
  const bars = peers.map(p => {
    const isData = p.lib === 'data'
    const w = Math.max(1.5, ((p.single || 0) / maxS) * 100)   // linear bar by single-tick ms
    const sx = p.singleX && p.singleX !== 1 ? `${fmt(p.singleX)}×` : '—'
    return `<div class="tcount-row" style="${isData ? 'font-weight:600' : ''}">` +
      `<span class="tcount-label">${esc(p.lib)}</span>` +
      `<span class="tcount-bar"><span class="tcount-fill" style="width:${w}%${isData ? ';opacity:.55' : ''}"></span></span>` +
      `<span class="tcount-val">${fmt(p.single, 3)}ms${isData ? '' : ` · ${sx}`}</span></div>`
  }).join('')
  el.innerHTML =
    `<div class="tile-cap">single-tick reactive cost vs <b>${r.dims.peers}</b> peer libraries at
      <b>N=${fmtN(r.dims.N)}</b>, from the committed <b>${esc(r.op)}</b> benchmark. data is
      <b>${fmt(r.value)}×</b> faster than its closest competitor (${esc(r.stats.closest)}).
      <span class="dim">(refresh: npm run bench:ops → npm run perf:h7)</span></div>
     <div class="rcard-foot">${fstat('data', r.stats['data (ms)'], 'ms')}${fstat('closest ×', r.stats['closest ×'], '', fmt)}${fstat('batch ×', r.stats['batch × (closest)'], '', fmt)}${fstat('peers', r.dims.peers, '', String)}</div>
     <div class="tcount-block" style="padding:.4rem 1.2rem">${bars}</div>`
  return el
}

function detailGeneric(r) {
  const el = document.createElement('div')
  const stats = r.stats || {}
  const cells = Object.entries(stats).slice(0, 4).map(([k, v]) => fstat(k, v, r.unit)).join('') ||
    fstat('value', r.value, r.unit)
  const dims = Object.entries(r.dims || {}).map(([k, v]) => `<span class="badge">${esc(k)}=${esc(v)}</span>`).join('')
  el.innerHTML =
    `<div class="tile-cap">${esc(r.op || r.id)} · kind <b>${esc(r.kind)}</b></div>
     <div class="rcard-foot">${cells}</div>
     ${dims ? `<div class="tile-badges">${dims}</div>` : ''}`
  return el
}

function detailFooter(r) {
  const el = document.createElement('div')
  el.className = 'ix-foot'
  el.innerHTML = rangeBand(r) + sparkBlock(r) + provLine(r)
  return el
}

// min/max band ⑤ — robust (p10..p90), direction-aware, oriented ×best. No
// threshold tick (no row carries a real value-threshold; a frame budget isn't one).
function rangeBand(r) {
  const h = r._h
  if (h.n < 3 || r.kind === 'bool') return ''
  const lower = goodSign(r) < 0 // lower-is-better
  const s = h.series
  const lo = quantile(s, 0.1), hi = quantile(s, 0.9) // robust clip of raw values
  // position 0 = best, 1 = worst (fill grows right = worse), direction-aware
  const pos = clamp01(lower ? (r.value - lo) / (hi - lo || 1) : (hi - r.value) / (hi - lo || 1))
  const best = lower ? Math.min(...s) : Math.max(...s)
  const xbest = best === 0 ? '–' : `×${fmt(lower ? r.value / best : best / r.value)}` // ≥1
  return `<div class="range-row ${pos > 0.66 ? 'warn' : ''}">
    <span class="range-lab">range</span>
    <span class="tcount-bar"><span class="tcount-fill" style="width:${(pos * 100).toFixed(0)}%"></span></span>
    <span class="range-num">${xbest} vs best</span></div>`
}

// trend spark ④ — detail only. last K+1 oriented points; current accent, dashed
// median-K baseline. Tight/noisy for timing; a real trend only emerges cross-commit.
function sparkBlock(r) {
  const h = r._h
  if (h.n < 2 || r.kind === 'bool') return `<div class="ix-spark-cap dim">trend · ${h.n} run${h.n === 1 ? '' : 's'}, ${h.distinctCommits} commit${h.distinctCommits === 1 ? '' : 's'} — ${h.distinctCommits < 2 ? 'run-noise' : 'cross-commit'}</div>`
  return `<div class="ix-spark-cap dim">trend · last ${h.series.length} runs (${h.distinctCommits} commit${h.distinctCommits === 1 ? '' : 's'}${h.distinctCommits < 2 ? ' · run-noise' : ''})</div>${sparkSVG(r)}`
}

function sparkSVG(r) {
  const h = r._h
  const pts = h.series // raw values over runs
  const W = 720, H = 64, pad = 8
  const lo = Math.min(...pts), hi = Math.max(...pts)
  const span = hi - lo || 1
  const x = i => pad + (i / (pts.length - 1)) * (W - 2 * pad)
  const y = v => H - pad - ((v - lo) / span) * (H - 2 * pad)
  const baseV = median(h.baseSamples)
  const path = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const baseLine = baseV != null
    ? `<line class="spark-base" x1="${pad}" y1="${y(baseV).toFixed(1)}" x2="${W - pad}" y2="${y(baseV).toFixed(1)}"/>` : ''
  const dots = pts.map((v, i) =>
    `<circle class="${i === pts.length - 1 ? (r._band === 'fail' ? 'spark-bad' : 'spark-cur') : 'spark-pt'}" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${i === pts.length - 1 ? 2.6 : 1.6}"/>`).join('')
  return `<svg class="ix-detail-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="trend">${baseLine}<path class="spark-line" d="${path}"/>${dots}</svg>`
}

function provLine(r) {
  const run = report.run
  return `<div class="ix-detail-prov">` + [
    `<span><b>run</b> ${esc(run.id)}</span>`,
    `<span><b>commit</b> ${esc(run.commit)}${run.dirty ? ' (dirty)' : ''} · ${esc(run.branch)}</span>`,
    `<span><b>node</b> ${esc(run.node)} · gc ${run.gc ? 'forced' : 'off'}</span>`,
    `<span><b>kind</b> ${esc(r.kind)}${r.dims?.synthetic ? ' · synthetic cascade (no rAF/paint)' : ''}</span>`,
  ].join('') + `</div>`
}

// ---- shared chart + stat primitives (kept) ----------------------------------
function chartSVG(frames, worstAt, budget) {
  const W = 960, H = 190, pad = 16
  const n = frames.length
  const maxF = Math.max(...frames)
  const lo = Math.log10(0.25), hi = Math.log10(Math.max(maxF, 33) * 1.12)
  const y = v => H - pad - ((Math.log10(Math.max(v, 0.25)) - lo) / (hi - lo)) * (H - 2 * pad)
  const bw = (W - 2 * pad) / n
  const x = i => pad + i * bw
  const base = H - pad
  let bars = ''
  for (let i = 0; i < n; i++) {
    const f = frames[i]
    const cls = i === worstAt ? 'bar-worst' : f > budget ? 'bar-warn' : 'bar-ok'
    const yi = y(f)
    bars += `<rect class="${cls}" x="${x(i).toFixed(1)}" y="${yi.toFixed(1)}" width="${Math.max(0.8, bw - 0.4).toFixed(2)}" height="${Math.max(0.6, base - yi).toFixed(1)}"/>`
  }
  const line = (v, cls, label) =>
    `<line class="budget-line ${cls}" x1="${pad}" y1="${y(v).toFixed(1)}" x2="${W - pad}" y2="${y(v).toFixed(1)}"/>` +
    `<text class="budget-label ${cls}" x="${W - pad}" y="${(y(v) - 3).toFixed(1)}" text-anchor="end">${label}</text>`
  const wx = (x(worstAt) + bw / 2).toFixed(1)
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="per-frame latency, log scale">${line(33, 'b33', '33ms')}${line(16, 'b16', '16ms · frame budget')}${bars}<line class="worst-mark" x1="${wx}" y1="${pad}" x2="${wx}" y2="${base}"/></svg>`
}

function fstat(k, v, unit = '', f = fmt) {
  const u = unit ? `<span class="dim" style="font-size:.7rem"> ${esc(unit)}</span>` : ''
  return `<div class="fstat"><span class="fstat-k">${esc(k)}</span><span class="fstat-v">${f === fmt ? fmt(v) : f(v)}${u}</span></div>`
}

// ---- controls ---------------------------------------------------------------
function wireControls() {
  const sortSel = document.querySelector('#sort')
  const grpBtn = document.querySelector('#group')
  const search = document.querySelector('#search')
  if (sortSel) {
    sortSel.value = state.sort
    sortSel.onchange = () => { state.sort = sortSel.value; renderIndex() }
  }
  if (grpBtn) grpBtn.onclick = () => {
    state.group = !state.group
    grpBtn.textContent = state.group ? 'grouped' : 'flat'
    grpBtn.setAttribute('aria-pressed', String(state.group))
    renderIndex()
  }
  const expBtn = document.querySelector('#expand')
  if (expBtn) expBtn.onclick = () => {
    state.expandAll = !state.expandAll
    expBtn.textContent = state.expandAll ? 'collapse all' : 'expand all'
    expBtn.setAttribute('aria-pressed', String(state.expandAll))
    renderIndex()
  }
  // rAF-coalesce search: re-pointing a fresh filter per keystroke piles up
  // undeduped operators (the documented gotcha) — one re-render per frame.
  if (search) {
    let raf = 0
    search.oninput = () => {
      state.q = search.value
      if (raf) return
      raf = requestAnimationFrame(() => { raf = 0; renderIndex() })
    }
  }
}

wireControls()
renderIndex()
