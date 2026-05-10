// Per-row "top 5 by delay" list. Pure DOM, no reactivity. Each library row
// computes the top-5 via its own primitives (data via `za('delay', 5)`,
// crossfilter via a sort dimension's `.top(5)`, the rest via sort+slice)
// and pushes the result through this helper. Adding this view exercises
// what comparisons.html calls the dashboard case — multiple derived views
// off the same source. For peers it's another O(N) walk + O(N log N) sort
// per filter change; for data it's incremental, ~free on top of the
// existing intersect → length chain.

export function renderTopList(listEl, flights) {
  if (!listEl) return
  let html = ''
  for (let i = 0; i < flights.length && i < 5; i++) {
    const f = flights[i]
    if (!f) continue
    const cls = f.delay < 0 ? 'mdf-tf-d mdf-tf-early' : 'mdf-tf-d'
    const sign = f.delay >= 0 ? '+' : ''
    html += `<li class="mdf-top-flight"><span class="mdf-tf-od">${f.origin}→${f.destination}</span><span class="${cls}">${sign}${f.delay | 0}m</span></li>`
  }
  listEl.innerHTML = html
}
