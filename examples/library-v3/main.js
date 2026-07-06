// Library, on the v3 engine — faceted browsing as SET ALGEBRA.
//
// The same faceted media browser as ../library, rewritten on data/v3. One
// source of movies; the visible set is a composition of the operators that
// are *about* sets — union (OR within a facet), intersect (AND across
// facets), except (exclusions), between (numeric ranges):
//
//   genreSlot   = media.mirror()                        // re-pointable facet slot
//   ratingView  = media.between('rating', bounds.get('rating'))  // reactive bounds
//   final       = genreSlot.intersect(decadeSlot, searchSlot, ratingView, runtimeView)
//   browsing    = final.except(exclSlot)                // minus exclusions
//   grid        = browsing.za('rating', pageSize.get('n'))       // reactive top-K window
//
// THE v3 STORY: the whole derivation chain above is built ONCE, at startup.
// Interaction never rebuilds it — a facet click re-points a mirror slot, a
// slider drag writes a bounds tuple, "load more" writes a window size. The
// keyed delta graph recomputes incrementally and the card grid catches up
// surgically. What v2's library needed and this one doesn't: no `$(view)`
// swap sources, no repage() re-pointing a fresh `za` when the page size
// changes (the window is a REACTIVE arg — it grows in place), no defensive
// `r == null ? '–' : …` bindings (v3 views are dense keyed objects; the
// sparse-undefined gotcha is structurally gone).

import { $, value, render, list, text, bind, HTML } from 'data/v3'

const { div, section, header, span, button, input, h1, h2, label } = HTML

// ── synthetic catalogue (same seeded generator as ../library) ────────────────
const GENRES = ['Action', 'Drama', 'SciFi', 'Comedy', 'Thriller', 'Horror', 'Romance', 'Crime', 'Fantasy', 'Doc']
const DECADES = [1970, 1980, 1990, 2000, 2010, 2020]
const ADJ = ['Last', 'Crimson', 'Silent', 'Broken', 'Golden', 'Hidden', 'Endless', 'Frozen', 'Burning', 'Distant', 'Hollow', 'Electric', 'Velvet', 'Savage', 'Quiet']
const NOUN = ['Horizon', 'Echo', 'Empire', 'Mirror', 'Harbor', 'Signal', 'Garden', 'Machine', 'Promise', 'Wolves', 'Tide', 'Circuit', 'Cathedral', 'Drift', 'Ghost']

let s = 987654
const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
const pick = a => a[(rnd() * a.length) | 0]

let nextId = 1
function newMovie() {
  const n = 1 + ((rnd() * 2.99) | 0)            // 1–3 genres
  const genres = []
  while (genres.length < n) { const g = pick(GENRES); if (!genres.includes(g)) genres.push(g) }
  return {
    id: 'v' + nextId,
    title: `The ${pick(ADJ)} ${pick(NOUN)}`,
    genres,
    decade: pick(DECADES),
    rating: +(4 + rnd() * 5.5).toFixed(1),       // 4.0–9.5
    runtime: 80 + ((rnd() * 100) | 0),           // 80–180
  }
}
const seed = {}
for (let i = 0; i < 6000; i++) { const m = newMovie(); seed[m.id] = m; nextId++ }

// ── the reactive graph — built ONCE ──────────────────────────────────────────

const media = $(seed)

// Per-value facet views, created once and reused by every recomposition. A
// facet selection only ever POINTS at these (or at a transient union of
// them); it never re-runs a filter over 6,000 rows per click.
const genreViews = {}
for (const g of GENRES) genreViews[g] = media.filter(m => m.genres.includes(g))
const decadeViews = {}
for (const d of DECADES) decadeViews[d] = media.filter(m => m.decade === d)
const EMPTY = $({})

// The re-pointable slots (mirror() — the v2 $(view) swap, done right): each
// facet's contribution to the AND is a mirror; a selection change is ONE
// consolidated diff commit through slot.set(view), and everything chained
// downstream — intersect, except, the sort window, the DOM list — never
// re-binds.
const genreSlot = media.mirror()
const decadeSlot = media.mirror()
const searchSlot = media.mirror()
const exclSlot = EMPTY.mirror()

// Range facets: REACTIVE bounds (the crossfilter-v3 idiom). The bounds live
// in a plain reactive source; each between subscribes to its tuple, and a
// brush is just a write — `bounds.set('rating', [lo, hi])` re-selects via
// the O(Δ) boundary walk. `[]` means unfiltered (opens to ±∞).
const bounds = $({ rating: [], runtime: [] })
const ratingView = media.between('rating', bounds.get('rating'))
const runtimeView = media.between('runtime', bounds.get('runtime'))

// AND across every facet, then subtract the exclusions. v2 needed a fix for
// intersect-over-sparse-views here; v3 views are dense keyed sets, so the
// composition is just the algebra.
const final = genreSlot.intersect(decadeSlot, searchSlot, ratingView, runtimeView)
const browsing = final.except(exclSlot)
const resultCount = browsing.length()

// THE PAGE — the headline v3 win. `za('rating', n)` with a REACTIVE window
// size: "load more" writes n+24 and the bounded top-K window GROWS IN PLACE
// (only the newly-admitted rows are emitted). v2 needed repage() — a fresh
// `za('rating', pageSize)` operator per size change, deduped by matches() —
// because its window size was baked in at construction. v3 deletes the
// concept: the window size is just another input to the standing view.
const pageSize = $({ n: 24 })
const grid = browsing.za('rating', pageSize.get('n'))

// ── facet state (UI state is data too) + recomposition ───────────────────────

// Selections drive the chip highlights reactively; the arrays are the single
// source of truth the recompose functions read.
const sel = $({ genres: [], decades: [], excl: [], q: '' })

const unionOf = views => views.length === 1 ? views[0] : views[0].union(...views.slice(1))

// A multi-select facet is a TRANSIENT union: selecting {SciFi, Drama} mints
// union(genreViews.SciFi, genreViews.Drama), points the slot at it, and
// dispose()s the previous transient AFTER re-pointing away (the chat-v3
// idiom — v3's answer to the v2 kanban lesson, where undisposed per-change
// operators piled up on the source and every later write paid for all of
// them). Zero or one selection needs no transient: the slot points straight
// at the source or at the prebuilt per-value view.
let genreTransient = null
function recomposeGenres() {
  const gs = sel.get('genres')[value]
  const prev = genreTransient
  genreTransient = gs.length > 1 ? unionOf(gs.map(g => genreViews[g])) : null
  genreSlot.set(genreTransient ?? (gs.length === 1 ? genreViews[gs[0]] : media))
  if (prev) prev.dispose()
}

let decadeTransient = null
function recomposeDecades() {
  const ds = sel.get('decades')[value]
  const prev = decadeTransient
  decadeTransient = ds.length > 1 ? unionOf(ds.map(d => decadeViews[d])) : null
  decadeSlot.set(decadeTransient ?? (ds.length === 1 ? decadeViews[ds[0]] : media))
  if (prev) prev.dispose()
}

// Exclusion chips subtract a union of the SAME prebuilt genre views — except
// works over the re-pointable slot exactly like intersect does (an empty
// selection points it at an empty source, subtracting nothing).
let exclTransient = null
function recomposeExcl() {
  const gs = sel.get('excl')[value]
  const prev = exclTransient
  exclTransient = gs.length > 1 ? unionOf(gs.map(g => genreViews[g])) : null
  exclSlot.set(exclTransient ?? (gs.length === 1 ? genreViews[gs[0]] : EMPTY))
  if (prev) prev.dispose()
}

// Search composes a transient filter per query, disposed on the next one.
let searchTransient = null
function recomposeSearch() {
  const q = sel.get('q')[value].trim().toLowerCase()
  const prev = searchTransient
  searchTransient = q ? media.filter(m => m.title.toLowerCase().includes(q)) : null
  searchSlot.set(searchTransient ?? media)
  if (prev) prev.dispose()
}

// ── handlers ─────────────────────────────────────────────────────────────────

// Facet changes reset the page window; the reactive n shrinks it in place.
const resetPage = () => pageSize.get('n').update(24)
const loadMore = () => pageSize.get('n').update(pageSize.get('n')[value] + 24)

const toggle = (key, val, recompose) => () => {
  const cur = sel.get(key)[value]
  sel.set(key, cur.includes(val) ? cur.filter(x => x !== val) : [...cur, val])
  recompose()
  resetPage()
}

// Coalesce search re-points to one per frame (the kanban-search / chat-v3
// discipline): the sel write itself is cheap, but the transient filter +
// re-point is O(catalogue), so a fast typer pays it once per frame.
let searchPending = false
const onSearch = ev => {
  sel.set('q', ev.target.value)
  if (searchPending) return
  searchPending = true
  requestAnimationFrame(() => { searchPending = false; recomposeSearch(); resetPage() })
}

// rAF-coalesced writers for the two range brushes: a fast slider drag fires
// many `input` events per frame, but the bounds (and the whole between →
// intersect → except → za cascade) only need to commit once per frame.
// write([lo, hi]) overwrites the pending value; the latest lands on the next
// frame, and .flush() on release commits the final position without an extra
// frame's latency. A brush does NOT touch the page — the bounded za window
// re-windows itself as between emits enter/leave deltas.
const writeRating = bounds.get('rating').raf()
const writeRuntime = bounds.get('runtime').raf()

const clearAll = () => {
  sel.set('genres', []); sel.set('decades', []); sel.set('excl', []); sel.set('q', '')
  recomposeGenres(); recomposeDecades(); recomposeExcl(); recomposeSearch()
  // Route the resets through the same writers the brushes use, so a pending
  // mid-drag frame can't clobber the reset a frame later.
  writeRating([]); writeRating.flush()
  writeRuntime([]); writeRuntime.flush()
  resetPage()
}

// ── views ────────────────────────────────────────────────────────────────────

// A chip's highlight derives from the selection data — no manual syncChips
// pass like v2; toggling writes the array, the class binding catches up.
const chip = (key, val, recompose) => button.chip({
  'data-key': val,
  class: bind(sel.get(key), arr => arr.includes(val) ? 'on' : null),
  onClick: toggle(key, val, recompose),
}, String(val))

// Range control: two clamped thumbs whose positions DERIVE from the bounds
// tuple (so clear-all snaps them home reactively — v2 needed a syncRanges()
// DOM pass), writing through the rAF-coalesced writer.
function rangeControl(idLo, idHi, min, max, step, key, write, fmt) {
  const b = bounds.get(key)
  const current = () => { const t = b[value]; return t.length ? t : [min, max] }
  const onInput = which => ev => {
    let [lo, hi] = current()
    const v = +ev.target.value
    if (which === 'lo') lo = Math.min(v, hi)
    else hi = Math.max(v, lo)
    write([lo, hi])
  }
  const flush = () => write.flush()
  const thumb = (id, which, edge) => input({
    id, type: 'range', min, max, step,
    value: bind(b, t => t.length ? t[which === 'lo' ? 0 : 1] : edge),
    onInput: onInput(which), onPointerup: flush, onChange: flush,
  })
  return div.range(
    thumb(idLo, 'lo', min),
    thumb(idHi, 'hi', max),
    div.rangeval(text(b, t => {
      const [lo, hi] = t.length ? t : [min, max]
      return `${fmt(lo)} – ${fmt(hi)}`
    })),
  )
}

// The card. The row fn receives PLAIN row data (a snapshot, not a proxy), so
// every cell is a plain expression — no .to() bindings, and none of v2's
// defensive `r == null ? '–' : …` guards: those existed because rendering an
// except(intersect(…)) chain could momentarily surface an excluded slot as
// explicit `undefined` mid-cascade. v3 views materialize DENSE keyed objects
// — the gotcha is gone. Row keys are the stable movie ids in every view
// (source → filter → intersect → za), so `id` here is m.id, not an index.
const card = (m, id) => div.card({ 'data-id': id },
  div.poster(
    span.score(m.rating.toFixed(1)),
    span.runtime(m.runtime + 'm'),
  ),
  div.cardbody(
    div.ctitle(m.title),
    div.cdecade(m.decade + 's'),
    div.cgenres(m.genres.map(g => span.cg(g))),
  ),
)

render(document.body, [
  header.topbar(
    div.brand(h1('library'), h2('faceted browse as set algebra')),
    div.spacer(),
    div.count(
      span.cnum(text(resultCount, n => n.toLocaleString())),
      span.clabel(' of 6,000 titles'),
    ),
    button.clearbtn({ onClick: clearAll }, 'clear all'),
  ),
  section.shell(
    section.facets(
      div.facet.facet_genres(
        label.flabel('Genre  ·  any of'),
        div.chips(...GENRES.map(g => chip('genres', g, recomposeGenres))),
      ),
      div.facet.facet_decades(
        label.flabel('Decade  ·  any of'),
        div.chips(...DECADES.map(d => chip('decades', d, recomposeDecades))),
      ),
      div.facet(
        label.flabel('Rating'),
        rangeControl('rlo', 'rhi', 4, 9.5, 0.1, 'rating', writeRating, v => v.toFixed(1)),
      ),
      div.facet(
        label.flabel('Runtime'),
        rangeControl('tlo', 'thi', 80, 180, 1, 'runtime', writeRuntime, v => v + 'm'),
      ),
      div.facet.facet_exclude(
        label.flabel('Exclude genre'),
        div.chips(...GENRES.map(g => chip('excl', g, recomposeExcl))),
      ),
    ),
    section.results(
      div.searchbar(
        input({ id: 'search', placeholder: 'Search titles…', value: bind(sel.get('q')), onInput: onSearch }),
      ),
      div.grid(list(grid, card)),
      button.more({ onClick: loadMore }, 'load more'),
    ),
  ),
])

// debug / test hooks
window.__library = {
  media, bounds, pageSize, sel, value,
  slots: { genre: genreSlot, decade: decadeSlot, search: searchSlot, excl: exclSlot },
  views: { final, browsing, grid, resultCount },
}
