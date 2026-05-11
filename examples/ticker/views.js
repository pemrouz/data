// Plain-DOM helpers shared across every library row. Each lib computes
// its own data using its own reactive primitives and pushes the result
// through these functions. Keeps the comparison focused on reactive
// update cost, not on DOM-update strategy.
//
// `renderTopMovers(el, items)` — items is an array of
//   { symbol, price, pctChg } sorted however the caller wants. We render
//   the first 5. Uses innerHTML because it's the cheapest write-the-whole-
//   list approach across every peer; for `data` we *could* surgically
//   update via the operator graph but doing so would create an unfair
//   advantage by making the DOM update layer differ. (Each library
//   independently shows its reactive update is well-formed by virtue of
//   the result being correct.)
//
// `renderSectors(el, totalsByName, max)` — totals is { TECH: 1234, ... }.
//   Uses textContent on cached span refs and a `--w` CSS variable on the
//   bar fill. Keeps the bars from flickering when only one sector's
//   value changes (which is the common case per tick).

export function renderTopMovers(el, items) {
  if (!el) return
  let html = ''
  const n = Math.min(5, items.length)
  for (let i = 0; i < n; i++) {
    const m = items[i]
    if (!m) continue
    const neg = m.pctChg < 0
    const sign = neg ? '' : '+'
    html += `<li class="tk-tm"><span class="tk-tm-s">${m.symbol}</span><span class="tk-tm-p">${m.price.toFixed(2)}</span><span class="tk-tm-c${neg ? ' tk-neg' : ''}">${sign}${m.pctChg.toFixed(2)}%</span></li>`
  }
  el.innerHTML = html
}

// Build the sector rows once, cache the span refs so each update is just
// a textContent + style.right change. Avoid building DOM on every tick.
const sectorCache = new WeakMap()

export function renderSectors(el, totals, sectorOrder) {
  if (!el) return
  let cache = sectorCache.get(el)
  if (!cache) {
    cache = {}
    let html = ''
    for (const k of sectorOrder) {
      html += `<div class="tk-sec-row"><span class="tk-sec-k">${k}</span><div class="tk-sec-bar"><div class="tk-sec-bar-fill" data-fill="${k}"></div></div><span class="tk-sec-v" data-val="${k}">—</span></div>`
    }
    el.innerHTML = html
    for (const k of sectorOrder) {
      cache[k] = {
        fill: el.querySelector(`[data-fill="${k}"]`),
        val:  el.querySelector(`[data-val="${k}"]`),
      }
    }
    sectorCache.set(el, cache)
  }
  // Compute scale: max across the displayed sectors. Empty (max 0) →
  // bars hide rather than divide-by-zero.
  let max = 0
  for (const k of sectorOrder) if ((totals[k] || 0) > max) max = totals[k] || 0
  for (const k of sectorOrder) {
    const v = totals[k] || 0
    const pct = max > 0 ? (v / max) * 100 : 0
    cache[k].fill.style.right = `${100 - pct}%`
    cache[k].val.textContent = fmtVol(v)
  }
}

// Throughput / latency stat cells. We write textContent directly; React /
// Solid rows that fully own their stats column would use their own
// renderer but the cells are cheap enough that plain DOM is fine.
export function renderThroughput(el, tps) {
  if (!el) return
  el.textContent = fmtTps(tps)
}

function fmtVol(v) {
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B'
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'k'
  return String(v | 0)
}

function fmtTps(v) {
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k'
  return String(v | 0)
}
