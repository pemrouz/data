// Kanban — an issue tracker built entirely from derived reactive views.
//
// The whole board is one source: `board = $({})` keyed by card id. Everything
// else is a derivation of it, kept live by `data` for the cost of the change:
//
//   • each COLUMN is `board.filter('status', s).az('order')` — the cards in
//     that status, ascending by order. Moving a card between columns is a
//     single in-place write (`card.status = …`): it leaves one filter and
//     enters another, and both columns re-render surgically.
//   • each column's COUNT and STORY-POINT total are `col.length()` /
//     `col.sum('points')` — O(Δ) per change, never a rescan.
//   • the assignee WORKLOAD deck is `board.length(a => a.assignee)` (cards
//     per person) alongside an incremental `board.reduce(add, remove, init)`
//     (points per person) — the bucketed-sum idiom.
//   • the header SPRINT bar is `board.sum('points')` vs
//     `board.filter('status','done').sum('points')`.
//
// Filtering (by assignee / by search text) re-points each column's source via
// the todo-style `$(view)` swap: `colData[s][value] = base.filter(...).az(...)`
// — the count/points views chained on top follow the relink automatically.
//
// Drag a card to move/reorder it; double-click its title to edit in place;
// "+ add" appends to a column. All of these are plain writes to `board`.

import { $, value, render, HTML } from 'data'

const { div, section, header, span, button, input, h1, h2 } = HTML

// ── seed ────────────────────────────────────────────────────────────────────
const STATUSES = ['backlog', 'todo', 'in-progress', 'review', 'done']
const STATUS_LABEL = {
  backlog: 'Backlog', todo: 'To Do', 'in-progress': 'In Progress',
  review: 'Review', done: 'Done',
}
const WIP = { backlog: Infinity, todo: 8, 'in-progress': 4, review: 3, done: Infinity }
const PEOPLE = ['ana', 'bo', 'cy', 'di']
const PRIORITIES = ['low', 'med', 'high']

const SEED = [
  ['Design auth flow',          'in-progress', 'ana', 'high', 5, ['auth', 'design']],
  ['Postgres schema',           'todo',        'bo',  'high', 8, ['db']],
  ['Landing hero',              'review',      'di',  'med',  3, ['ui']],
  ['CI pipeline',               'done',        'cy',  'low',  2, ['infra']],
  ['Rate limiter',              'backlog',     'bo',  'med',  3, ['infra', 'api']],
  ['OAuth providers',           'todo',        'ana', 'med',  5, ['auth']],
  ['Dark mode',                 'backlog',     'di',  'low',  2, ['ui']],
  ['Email templates',           'todo',        'cy',  'low',  1, ['email']],
  ['Search index',              'in-progress', 'bo',  'high', 8, ['search', 'db']],
  ['Onboarding tour',           'backlog',     'di',  'med',  3, ['ui']],
  ['Webhook delivery',          'review',      'ana', 'high', 5, ['api']],
  ['Audit log',                 'todo',        'bo',  'med',  3, ['infra', 'security']],
  ['Avatar upload',             'done',        'di',  'low',  2, ['ui']],
  ['2FA',                       'backlog',     'ana', 'high', 5, ['auth', 'security']],
  ['Billing portal',            'todo',        'cy',  'high', 8, ['billing']],
  ['Export to CSV',             'backlog',     'cy',  'low',  2, ['data']],
  ['Mobile nav',                'in-progress', 'di',  'med',  3, ['ui']],
  ['API docs',                  'review',      'bo',  'low',  2, ['docs', 'api']],
  ['Session expiry',            'todo',        'ana', 'med',  3, ['auth']],
  ['Error tracking',            'done',        'cy',  'med',  3, ['infra']],
]

let nextId = 1
const seed = {}
const orderByStatus = {}
for (const [title, status, assignee, priority, points, labels] of SEED) {
  const order = (orderByStatus[status] = (orderByStatus[status] ?? -1) + 1)
  const id = 't' + nextId++
  // Each column is `…az('order')`, an array-shaped view — so the row
  // template's positional key is NOT the card id. We carry the real id INSIDE
  // the card (`id`) and bind it to data-id, so handlers can read the live id
  // off the DOM regardless of how positions shuffle on re-sort.
  seed[id] = { id, title, status, assignee, priority, points, labels, order }
}

const board = window.board = $(seed)
window.value = value

// ── reactive filter state → re-pointable column sources ──────────────────────
// Each column renders a `$(view)` we can re-point when a filter changes; the
// count/points views chained on the proxy follow the relink (verified — see
// the todo "selected" pattern). `filterState` is plain; rebuildColumns() folds
// it into the base view and re-points every column.
const filterState = { assignee: null, search: '' }
const colData = {}, colCount = {}, colPoints = {}
for (const s of STATUSES) {
  colData[s] = $(board)                  // placeholder; set properly below
  colCount[s] = colData[s].length()
  colPoints[s] = colData[s].sum('points')
}

function rebuildColumns() {
  let base = board
  const q = filterState.search.trim().toLowerCase()
  if (filterState.assignee) base = base.filter('assignee', filterState.assignee)
  if (q) base = base.filter(c => c.title.toLowerCase().includes(q))
  for (const s of STATUSES) {
    colData[s][value] = base.filter('status', s).az('order')
  }
}
rebuildColumns()

// ── global metrics (header) ──────────────────────────────────────────────────
// One whole-board derive for the sprint summary (cards / points / done %). The
// board is small, so the O(n) recompute per change is trivial and keeps the
// combined "done / total" ratio in a single reactive value.
const sprint = board.to(v => {
  let cards = 0, total = 0, done = 0
  for (const id in v) {
    const c = v[id]; if (!c) continue
    cards++; total += c.points
    if (c.status === 'done') done += c.points
  }
  return { cards, total, done, pct: total ? Math.round(100 * done / total) : 0 }
})

// ── assignee workload deck ───────────────────────────────────────────────────
// cards-per-person (length(fn) histogram) + points-per-person (incremental
// bucketed reduce — the 3-arg add/remove form). Both rebucket on insert /
// remove / move incrementally.
const cardsByPerson = board.length(a => a.assignee)
const pointsByPerson = board.reduce(
  (acc, row) => { acc[row.assignee] = (acc[row.assignee] || 0) + row.points; return acc },
  (acc, row) => { if ((acc[row.assignee] -= row.points) <= 0) delete acc[row.assignee]; return acc },
  () => ({}),
)

// ── handlers ─────────────────────────────────────────────────────────────────
// Read the live card id off the DOM (data-id is a reactive binding to c.id),
// so a handler bound at a fixed position still acts on whatever card occupies
// it after a re-sort.
const cardIdOf = ev => ev.target.closest('.card')?.dataset.id

let dragId = null
const onDragStart = ev => {
  dragId = ev.currentTarget.dataset.id
  ev.dataTransfer.effectAllowed = 'move'
  ev.dataTransfer.setData('text/plain', dragId)
  requestAnimationFrame(() => ev.currentTarget.classList.add('dragging'))
}
const onDragEnd = ev => { dragId = null; ev.currentTarget.classList.remove('dragging') }

// Compute the order value a dropped card should take to land at the pointer:
// scan the column's rendered cards, find the first whose vertical midpoint is
// below the pointer, and pick a fractional order between it and its predecessor
// (fractional ordering avoids renumbering the whole column).
function dropOrder(status, clientY, colEl) {
  const cards = [...colEl.querySelectorAll('.card:not(.dragging)')]
  const ids = cards.map(c => c.dataset.id)
  let before = ids.length            // default: append to end
  for (let i = 0; i < cards.length; i++) {
    const box = cards[i].getBoundingClientRect()
    if (clientY < box.top + box.height / 2) { before = i; break }
  }
  const v = board[value]
  const prevOrder = before === 0 ? null : v[ids[before - 1]].order
  const nextOrder = before >= ids.length ? null : v[ids[before]].order
  if (prevOrder == null && nextOrder == null) return 0
  if (prevOrder == null) return nextOrder - 1
  if (nextOrder == null) return prevOrder + 1
  return (prevOrder + nextOrder) / 2
}

const onDrop = status => ev => {
  ev.preventDefault()
  const id = dragId || ev.dataTransfer.getData('text/plain')
  if (!id || !board[value][id]) return
  const colEl = ev.currentTarget
  const order = dropOrder(status, ev.clientY, colEl)
  // one logical move → two in-place writes (status + order). Filters re-route
  // the card, az re-sorts, counts/points update — all surgical.
  board[id].status.update(status)
  board[id].order.update(order)
  colEl.classList.remove('drop-target')
}

const onDragOver = ev => { ev.preventDefault(); ev.currentTarget.classList.add('drop-target') }
const onDragLeave = ev => {
  if (!ev.currentTarget.contains(ev.relatedTarget)) ev.currentTarget.classList.remove('drop-target')
}

const addCard = status => () => {
  const title = (prompt('Card title?') || '').trim()
  if (!title) return
  // append to the end of the (unfiltered) column
  let maxOrder = -1
  for (const k in board[value]) {
    const c = board[value][k]
    if (c.status === status && c.order > maxOrder) maxOrder = c.order
  }
  const id = 't' + nextId++
  board.insert(
    { id, title, status, assignee: PEOPLE[0], priority: 'med', points: 3, labels: [], order: maxOrder + 1 },
    [id],
  )
}

const editTitle = ev => {
  const id = cardIdOf(ev); if (!id) return
  const next = (prompt('Edit title', board[value][id].title) || '').trim()
  if (next) board[id].title.update(next)          // in-place edit through filter→sort
}
const cyclePriority = ev => {
  ev.stopPropagation()
  const id = cardIdOf(ev); if (!id) return
  const cur = board[value][id].priority
  board[id].priority.update(PRIORITIES[(PRIORITIES.indexOf(cur) + 1) % PRIORITIES.length])
}
const cyclePoints = ev => {
  ev.stopPropagation()
  const id = cardIdOf(ev); if (!id) return
  const steps = [1, 2, 3, 5, 8, 13]
  const cur = board[value][id].points
  board[id].points.update(steps[(steps.indexOf(cur) + 1) % steps.length])
}
const reassign = ev => {
  ev.stopPropagation()
  const id = cardIdOf(ev); if (!id) return
  const cur = board[value][id].assignee
  board[id].assignee.update(PEOPLE[(PEOPLE.indexOf(cur) + 1) % PEOPLE.length])
}
const removeCard = ev => {
  ev.stopPropagation()
  const id = cardIdOf(ev); if (id) board[id].remove()
}

const setAssigneeFilter = who => () => {
  filterState.assignee = filterState.assignee === who ? null : who
  rebuildColumns()
  syncFilterChips()
}
// Coalesce the search re-point to one rebuild per frame. A fast typer fires
// several `input` events per frame, but the columns only need to re-point once
// with the latest query — the same rAF-coalescing the library slider uses.
// Without it, every keystroke re-points all 5 columns (O(board) per keystroke)
// and the undeduped filter/az operators pile up until GC, which measurably
// slows later board edits. Assignee clicks stay immediate (one event each).
let searchPending = false
const onSearch = ev => {
  filterState.search = ev.target.value
  if (searchPending) return
  searchPending = true
  requestAnimationFrame(() => { searchPending = false; rebuildColumns() })
}

// ── views ────────────────────────────────────────────────────────────────────
const fmtPts = n => (n || 0) + ' pts'

const card = (node, c) => node
  .attr('draggable', 'true')
  .attr('data-id', c.id)
  .class('pri-low', c.priority.to(p => p === 'low'))
  .class('pri-med', c.priority.to(p => p === 'med'))
  .class('pri-high', c.priority.to(p => p === 'high'))
  .on('dragstart', onDragStart)
  .on('dragend', onDragEnd)
  .nodes(
    div.card_top(
      span.card_title.text(c.title).on('dblclick', editTitle),
      button.card_x('×').on('click', removeCard),
    ),
    div.card_labels(
      span.label(c.labels, (n, label) => n.text(label)),
    ),
    div.card_meta(
      span.pill.pri.text(c.priority).on('click', cyclePriority),
      span.pill.pts.text(c.points.to(p => p + ' pts')).on('click', cyclePoints),
      span.pill.who.text(c.assignee).on('click', reassign),
    ),
  )

const column = s => section.col
  .attr('data-status', s)
  .nodes(
    header.col_head(
      span.col_name.text(STATUS_LABEL[s]),
      span.col_count
        .class('over', colCount[s].to(n => n > WIP[s]))
        .text(colCount[s].to(n => WIP[s] === Infinity ? `${n}` : `${n}/${WIP[s]}`)),
      span.col_pts.text(colPoints[s].to(fmtPts)),
    ),
    div.col_body
      .on('dragover', onDragOver)
      .on('dragleave', onDragLeave)
      .on('drop', onDrop(s))
      .nodes(
        div.card(colData[s], card),
      ),
    button.col_add('+ add').on('click', addCard(s)),
  )

// assignee chips + workload (read counts/points from the maintained views).
// length(fn) stores each bucket as { value: count }, so the count is
// `b[who]?.value` — reading b[who] directly renders [object Object]. The
// reduce-based points map stores a plain number per key.
const personChip = who => button.chip
  .attr('data-who', who)
  .on('click', setAssigneeFilter(who))
  .nodes(
    span.chip_name.text(who),
    span.chip_load.text(cardsByPerson.to(b => `${b[who]?.value || 0}`)),
    span.chip_pts.text(pointsByPerson.to(b => `${b[who] || 0}p`)),
  )

function syncFilterChips() {
  document.querySelectorAll('.chip').forEach(el =>
    el.classList.toggle('active', el.dataset.who === filterState.assignee))
}

render(document.body, HTML.body(
  header.topbar(
    div.brand(h1('kanban'), h2('a board of derived views')),
    div.spacer,
    div.search_box(
      input.search['placeholder=Filter cards…'].on('input', onSearch),
    ),
    div.filters(...PEOPLE.map(personChip)),
  ),
  section.sprint(
    div.sprint_meta(
      span.text(sprint.to(s => `${s.cards} cards`)),
      span.dot('·'),
      span.text(sprint.to(s => `${s.total} pts total`)),
      span.dot('·'),
      span.text(sprint.to(s => `${s.done}/${s.total} pts done`)),
    ),
    div.sprint_bar(
      div.sprint_fill.style('width', sprint.to(s => s.pct + '%')),
    ),
  ),
  section.board(...STATUSES.map(column)),
))

syncFilterChips()
