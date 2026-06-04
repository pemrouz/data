// Library — a faceted media browser built from set algebra.
//
// One source of movies; the visible set is a composition of the operators that
// are *about* sets — union (OR within a facet), intersect (AND across facets),
// except (exclusions), between (numeric ranges), distinct (facet values):
//
//   genreFacet  = filter(g1).union(filter(g2), …)     // any selected genre
//   decadeFacet = filter(d1).union(filter(d2), …)
//   ratingFacet = movies.between('rating',  ratingBounds)   // reactive bounds
//   selected    = movies.intersect(genreFacet, decadeFacet, ratingFacet, …)
//   final       = selected.except(excludedFacet)            // minus exclusions
//   display     = final.za('rating').limit(n)               // sorted, paged
//
// Facet selections re-point the per-facet `$(view)` sources (genre/decade/
// exclude/search); the range sliders mutate reactive `between` bounds. The
// intersect / except / sort / limit chain downstream recomputes incrementally
// and the card grid catches up surgically — no manual invalidation.

import { $, value, render, HTML } from 'data'

const { div, section, header, span, button, input, h1, h2, label } = HTML

// ── synthetic catalog ────────────────────────────────────────────────────────
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
const movies = window.movies = $(seed)
window.value = value

// ── precomputed per-value facet views (built once, reused) ───────────────────
const genreView = {}
for (const g of GENRES) genreView[g] = movies.filter(m => m.genres.includes(g))
const decadeView = {}
for (const d of DECADES) decadeView[d] = movies.filter('decade', d)
const EMPTY = $({})

// ── facet state + reactive sources ───────────────────────────────────────────
const state = { genres: new Set(), decades: new Set(), exclude: new Set(), search: '' }

const genreFacet = $(movies)
const decadeFacet = $(movies)
const searchFacet = $(movies)
const excludedFacet = $(EMPTY)
const ratingBounds = $([4, 9.5])
const runtimeBounds = $([80, 180])

const ratingFacet = movies.between('rating', ratingBounds)
const runtimeFacet = movies.between('runtime', runtimeBounds)

// AND across every facet, then subtract the exclusions
const selected = movies.intersect(genreFacet, decadeFacet, searchFacet, ratingFacet, runtimeFacet)
const final = selected.except(excludedFacet)
const resultCount = final.length()

// sorted + paged display (re-pointed when "load more" grows the page)
const sorted = final.za('rating')
let pageSize = 60
const display = $(sorted.limit(pageSize))

// union a set of precomputed views, or fall back to `whenEmpty`
function unionOf(views, whenEmpty) {
  if (views.length === 0) return whenEmpty
  if (views.length === 1) return views[0]
  return views[0].union(...views.slice(1))
}

function rebuildGenre() {
  genreFacet[value] = unionOf([...state.genres].map(g => genreView[g]), movies)
}
function rebuildDecade() {
  decadeFacet[value] = unionOf([...state.decades].map(d => decadeView[d]), movies)
}
function rebuildExclude() {
  excludedFacet[value] = unionOf([...state.exclude].map(g => genreView[g]), EMPTY)
}
function rebuildSearch() {
  const q = state.search.trim().toLowerCase()
  searchFacet[value] = q ? movies.filter(m => m.title.toLowerCase().includes(q)) : movies
}
function repage() { display[value] = sorted.limit(pageSize) }

// ── handlers ─────────────────────────────────────────────────────────────────
const toggle = (set, key, rebuild) => () => {
  set.has(key) ? set.delete(key) : set.add(key)
  rebuild(); syncChips(); pageSize = 60; repage()
}
const onSearch = ev => { state.search = ev.target.value; rebuildSearch(); pageSize = 60; repage() }
const loadMore = () => { pageSize += 60; repage() }
const clearAll = () => {
  state.genres.clear(); state.decades.clear(); state.exclude.clear(); state.search = ''
  ratingBounds[value] = [4, 9.5]; runtimeBounds[value] = [80, 180]
  document.querySelector('#search').value = ''
  syncRanges()
  rebuildGenre(); rebuildDecade(); rebuildExclude(); rebuildSearch(); syncChips(); pageSize = 60; repage()
}

// range sliders: two inputs per dimension, clamped so lo ≤ hi
function rangeControl(idLo, idHi, min, max, step, bounds, fmt) {
  const read = () => bounds[value]
  const onInput = which => ev => {
    let [lo, hi] = read()
    const v = +ev.target.value
    if (which === 'lo') lo = Math.min(v, hi)
    else hi = Math.max(v, lo)
    bounds[value] = [lo, hi]
    pageSize = 60; repage()
  }
  return div.range(
    input.attr({ id: idLo, type: 'range', min, max, step, value: read()[0] }).on('input', onInput('lo')),
    input.attr({ id: idHi, type: 'range', min, max, step, value: read()[1] }).on('input', onInput('hi')),
    div.rangeval.text(bounds.to(([lo, hi]) => `${fmt(lo)} – ${fmt(hi)}`)),
  )
}

// ── views ────────────────────────────────────────────────────────────────────
const chip = (key, set, rebuild) => button.chip
  .attr('data-key', key)
  .on('click', toggle(set, key, rebuild))
  .text('' + key)

// Defensive bindings: `final` is an except(intersect(…)) view, and rendering a
// between/intersect/union/except chain directly can momentarily surface an
// EXCLUDED slot (explicit `undefined`) during a multi-source re-point cascade —
// the documented sparse-view gotcha. Guard each field so a transient undefined
// row renders blank instead of throwing (the row leaves the window a tick later).
const card = (node, m) => node
  .attr('data-id', m.id)
  .nodes(
    div.poster(
      span.score.text(m.rating.to(r => r == null ? '–' : r.toFixed(1))),
      span.runtime.text(m.runtime.to(r => r == null ? '' : r + 'm')),
    ),
    div.cardbody(
      div.ctitle.text(m.title),
      div.cdecade.text(m.decade.to(d => d == null ? '' : d + 's')),
      div.cgenres(span.cg(m.genres, (n, g) => n.text(g))),
    ),
  )

function syncChips() {
  document.querySelectorAll('.facet-genres .chip').forEach(el =>
    el.classList.toggle('on', state.genres.has(el.dataset.key)))
  document.querySelectorAll('.facet-decades .chip').forEach(el =>
    el.classList.toggle('on', state.decades.has(+el.dataset.key)))
  document.querySelectorAll('.facet-exclude .chip').forEach(el =>
    el.classList.toggle('on', state.exclude.has(el.dataset.key)))
}
function syncRanges() {
  const set = (id, v) => { const el = document.querySelector('#' + id); if (el) el.value = v }
  set('rlo', ratingBounds[value][0]); set('rhi', ratingBounds[value][1])
  set('tlo', runtimeBounds[value][0]); set('thi', runtimeBounds[value][1])
}

render(document.body, HTML.body(
  header.topbar(
    div.brand(h1('library'), h2('faceted browse as set algebra')),
    div.spacer,
    div.count(
      span.cnum.text(resultCount.to(n => n.toLocaleString())),
      span.clabel(' of 6,000 titles'),
    ),
    button.clearbtn('clear all').on('click', clearAll),
  ),
  section.shell(
    section.facets(
      div.facet.facet_genres(
        label.flabel('Genre  ·  any of'),
        div.chips(...GENRES.map(g => chip(g, state.genres, rebuildGenre))),
      ),
      div.facet.facet_decades(
        label.flabel('Decade  ·  any of'),
        div.chips(...DECADES.map(d => chip(d, state.decades, rebuildDecade))),
      ),
      div.facet(
        label.flabel('Rating'),
        rangeControl('rlo', 'rhi', 4, 9.5, 0.1, ratingBounds, v => v.toFixed(1)),
      ),
      div.facet(
        label.flabel('Runtime'),
        rangeControl('tlo', 'thi', 80, 180, 1, runtimeBounds, v => v + 'm'),
      ),
      div.facet.facet_exclude(
        label.flabel('Exclude genre'),
        div.chips(...GENRES.map(g => chip(g, state.exclude, rebuildExclude))),
      ),
    ),
    section.results(
      div.searchbar(
        input['#search']['placeholder=Search titles…'].on('input', onSearch),
      ),
      div.grid(div.card(display, card)),
      button.more('load more').on('click', loadMore),
    ),
  ),
))

syncChips()
