// Kanban, on the v3 engine — the same issue tracker as ../kanban, rebuilt on
// data/v3 with the HTML builder DSL (the fourth M5 migration).
//
// The whole board is ONE source: `board = $({})` keyed by card id. Everything
// else derives from it, and every derivation is built ONCE:
//
//   colFilter[s] = board.filter(c => c.status === s)   // one filter per column
//   colSlot[s]   = colFilter[s].mirror()               // the re-pointable slot
//   colView[s]   = colSlot[s].az('order')              // sorted column, off the slot
//   colCount[s]  = colSlot[s].length()                 // count follows re-points
//   colPoints[s] = colSlot[s].sum('points')            // points follow re-points
//
// Filtering (by assignee / search text) never rebuilds this graph: it composes
// ONE transient filter per column, re-points the slot at it, and dispose()s
// the previous transient — v3's answer to the v2 kanban lesson, where
// undisposed per-keystroke operators piled up on the source until every later
// board edit paid for all of them (v2 could only rAF-coalesce the damage).
//
// What v2's kanban needed and this one doesn't:
// - no data-id read-back in handlers: a v3 ordered view keeps the CARD ID as
//   the row key (order is a separate channel), so every handler closes over
//   the stable id — v2's az columns were array-keyed, forcing handlers to
//   read the live id off the DOM.
// - no .to() bindings inside the card: the row fn receives PLAIN data and the
//   renderer diffs its output per update (class-from-row-data patches
//   surgically), so cells are plain expressions.
// - no `|| 0` guard on the column points: v3's sum() is 0 over an empty set
//   (v2 gave undefined).
//
// Drag a card to move/reorder it (ONE batch() commit); double-click a title
// to edit; click a pill to cycle priority/points/assignee; "+ add" appends.

import { $, value, batch, render, list, text, bind, HTML } from 'data/v3'

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
  seed[id] = { id, title, status, assignee, priority, points, labels, order }
}

const board = $(seed)

// UI state is data too: the active assignee chip and the search query.
// The chips' active class binds to it reactively — no v2 syncFilterChips()
// walking the DOM to toggle classes by hand.
const ui = $({ assignee: '', q: '' })

// ── the column graph (built ONCE — re-points never re-bind it) ───────────────
// mirror() is the re-pointable slot: az/length/sum chain off it a single time
// and follow every re-point; the keyed list below never re-binds either.
const colFilter = {}, colSlot = {}, colView = {}, colCount = {}, colPoints = {}
for (const s of STATUSES) {
  colFilter[s] = board.filter(c => c.status === s)
  colSlot[s] = colFilter[s].mirror()
  colView[s] = colSlot[s].az('order')
  colCount[s] = colSlot[s].length()
  colPoints[s] = colSlot[s].sum('points')
}

// ── re-pointing the slots ────────────────────────────────────────────────────
// An active filter composes ONE TRANSIENT filter per column over that
// column's standing view; the slot re-points at it, and the PREVIOUS
// transient is dispose()d right after — the chat-v3 idiom. dispose() detaches
// the node, so the graph stays exactly as big as what's on screen (the v2
// version leaked one filter+az chain per keystroke until GC).
let transients = null
const repoint = () => {
  const { assignee, q } = ui[value]
  const query = q.trim().toLowerCase()
  const prev = transients
  if (assignee || query) {
    const match = c =>
      (!assignee || c.assignee === assignee) &&
      (!query || c.title.toLowerCase().includes(query))
    transients = {}
    for (const s of STATUSES) {
      transients[s] = colFilter[s].filter(match)
      colSlot[s].set(transients[s])
    }
  } else {
    transients = null
    for (const s of STATUSES) colSlot[s].set(colFilter[s]) // back to the standing views
  }
  if (prev) for (const s of STATUSES) prev[s].dispose() // AFTER re-pointing away
}

const setAssigneeFilter = who => () => {
  ui.set('assignee', ui[value].assignee === who ? '' : who)
  repoint() // chip clicks are one event each — re-point immediately
}

// Coalesce search re-points to one per frame: a fast typer fires several
// input events per frame, but the slots only need the LATEST query. The ui
// write itself is cheap; the five transient filters + re-points are the part
// worth coalescing (the kanban-search / library-slider discipline).
let searchPending = false
const onSearch = ev => {
  ui.set('q', ev.target.value)
  if (searchPending) return
  searchPending = true
  requestAnimationFrame(() => { searchPending = false; repoint() })
}

// ── global metrics (header) ──────────────────────────────────────────────────
// One whole-board derive for the sprint summary. v3 snapshots are dense —
// no sparse-hole `if (!c) continue` guard needed.
const sprint = board.to(v => {
  let cards = 0, total = 0, done = 0
  for (const id in v) {
    const c = v[id]
    cards++; total += c.points
    if (c.status === 'done') done += c.points
  }
  return { cards, total, done, pct: total ? Math.round(100 * done / total) : 0 }
})

// ── assignee workload deck ───────────────────────────────────────────────────
// cards-per-person: a length(fn) histogram — each bucket is a { value: N }
// wrapper (read b.value, the documented bucket shape).
const cardsByPerson = board.length(c => c.assignee)

// points-per-person: the 3-arg INCREMENTAL reduce — an invertible fold over
// an object-map accumulator with a THUNK init. Every delta threads through
// add/remove in O(1): an insert calls add, a removal calls remove(prev), and
// an in-place edit (points bump, reassign) is remove(prevRow) + add(newRow) —
// the v3 update delta CARRIES the previous row, so there is no rebuild path
// (verified at the data level: one points edit = exactly one remove + one add).
const pointsByPerson = board.reduce(
  (acc, c) => { acc[c.assignee] = (acc[c.assignee] ?? 0) + c.points; return acc },
  (acc, c) => { acc[c.assignee] -= c.points; return acc },
  () => ({}),
)

// ── handlers ─────────────────────────────────────────────────────────────────
// Every handler closes over the card's STABLE row key (v3 ordered views keep
// card ids as keys — no v2 data-id read-back) and reads CURRENT state through
// the source: listeners bind once per row build, rows patch underneath them.
const card = id => board.get(id)

let dragId = null
const onDragStart = id => ev => {
  dragId = id
  ev.dataTransfer.effectAllowed = 'move'
  ev.dataTransfer.setData('text/plain', id)
  const el = ev.currentTarget
  requestAnimationFrame(() => el.classList.add('dragging'))
}
const onDragEnd = ev => { dragId = null; ev.currentTarget.classList.remove('dragging') }

// Compute the order value a dropped card should take to land at the pointer:
// scan the column's rendered cards, find the first whose vertical midpoint is
// below the pointer, and pick a fractional order between it and its
// predecessor (fractional ordering avoids renumbering the whole column).
// This is the one place data-id survives: a geometric hit-test inherently
// starts from DOM elements, so each card carries its id for the lookup
// (handlers themselves never need it).
function dropOrder(clientY, colEl) {
  const cards = [...colEl.querySelectorAll('.card:not(.dragging)')]
  let before = cards.length            // default: append to end
  for (let i = 0; i < cards.length; i++) {
    const box = cards[i].getBoundingClientRect()
    if (clientY < box.top + box.height / 2) { before = i; break }
  }
  const v = board[value]
  const prevOrder = before === 0 ? null : v[cards[before - 1].dataset.id].order
  const nextOrder = before >= cards.length ? null : v[cards[before].dataset.id].order
  if (prevOrder == null && nextOrder == null) return 0
  if (prevOrder == null) return nextOrder - 1
  if (nextOrder == null) return prevOrder + 1
  return (prevOrder + nextOrder) / 2
}

const onDrop = status => ev => {
  ev.preventDefault()
  const id = dragId || ev.dataTransfer.getData('text/plain')
  if (!id || !board[value][id]) return
  const order = dropOrder(ev.clientY, ev.currentTarget)
  // ONE logical move = ONE commit: batch() groups the two field writes, so
  // the card leaves one filter, enters the other, az re-sorts, and both
  // columns' count + points update in a single settle (verified at the data
  // level: each column sees exactly one batch, not two).
  batch(() => {
    card(id).set('status', status)
    card(id).set('order', order)
  })
  ev.currentTarget.classList.remove('drop-target')
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
  board.set(id, { id, title, status, assignee: PEOPLE[0], priority: 'med', points: 3, labels: [], order: maxOrder + 1 })
}

// Card edits are single field writes: the row update flows through
// filter → mirror → az, the renderer re-runs the row fn and diffs — the
// priority class / pill text patch surgically, untouched cards never re-render.
const editTitle = id => () => {
  const next = (prompt('Edit title', card(id)[value].title) || '').trim()
  if (next) card(id).set('title', next)
}
const cyclePriority = id => ev => {
  ev.stopPropagation()
  const cur = card(id)[value].priority
  card(id).set('priority', PRIORITIES[(PRIORITIES.indexOf(cur) + 1) % PRIORITIES.length])
}
const cyclePoints = id => ev => {
  ev.stopPropagation()
  const steps = [1, 2, 3, 5, 8, 13]
  const cur = card(id)[value].points
  card(id).set('points', steps[(steps.indexOf(cur) + 1) % steps.length])
}
const reassign = id => ev => {
  ev.stopPropagation()
  const cur = card(id)[value].assignee
  card(id).set('assignee', PEOPLE[(PEOPLE.indexOf(cur) + 1) % PEOPLE.length])
}
const removeCard = id => ev => {
  ev.stopPropagation()
  card(id).remove()
}

// ── views ────────────────────────────────────────────────────────────────────
// The card row fn receives PLAIN row data + the stable card id (the row key
// in every derived view). Cells are plain expressions — no .to() bindings, no
// undefined guards; the class computed from row data diffs on update.
const cardRow = (c, id) => div.card(
  {
    draggable: 'true',
    'data-id': id, // for dropOrder's DOM hit-test + tests — handlers close over `id`
    class: 'pri-' + c.priority,
    onDragstart: onDragStart(id),
    onDragend: onDragEnd,
  },
  div.card_top(
    span.card_title({ onDblclick: editTitle(id) }, c.title),
    button.card_x({ onClick: removeCard(id) }, '×'),
  ),
  div.card_labels(c.labels.map(label => span.label(label))),
  div.card_meta(
    span.pill.pri({ onClick: cyclePriority(id) }, c.priority),
    span.pill.pts({ onClick: cyclePoints(id) }, c.points + ' pts'),
    span.pill.who({ onClick: reassign(id) }, c.assignee),
  ),
)

const column = s => section.col(
  { 'data-status': s },
  header.col_head(
    span.col_name(STATUS_LABEL[s]),
    span.col_count(
      { class: bind(colCount[s], n => n > WIP[s] ? 'over' : '') },
      text(colCount[s], n => WIP[s] === Infinity ? `${n}` : `${n}/${WIP[s]}`),
    ),
    span.col_pts(text(colPoints[s], n => n + ' pts')),
  ),
  div.col_body(
    {
      onDragover: onDragOver,
      onDragleave: onDragLeave,
      onDrop: onDrop(s),
    },
    // THE keyed list — the sole child of its container. Bound once to the
    // az view off the slot; re-points, moves and edits reconcile in place.
    list(colView[s], cardRow),
  ),
  button.col_add({ onClick: addCard(s) }, '+ add'),
)

// assignee chips + workload: counts from the length(fn) histogram (each
// bucket is { value: N } — read b.value; an emptied bucket persists as
// { value: 0 }), points from the incremental reduce's plain number map.
const personChip = who => button.chip(
  {
    'data-who': who,
    class: bind(ui.get('assignee'), a => a === who ? 'active' : ''),
    onClick: setAssigneeFilter(who),
  },
  span.chip_name(who),
  span.chip_load(text(cardsByPerson.get(who), b => b?.value ?? 0)),
  span.chip_pts(text(pointsByPerson, pts => `${pts[who] ?? 0}p`)),
)

render(document.body, [
  header.topbar(
    div.brand(h1('kanban'), h2('a board of derived views · v3')),
    div.spacer(),
    div.search_box(
      input.search({ placeholder: 'Filter cards…', onInput: onSearch }),
    ),
    div.filters(PEOPLE.map(personChip)),
  ),
  section.sprint(
    div.sprint_meta(
      span(text(sprint, s => `${s.cards} cards`)),
      span.dot('·'),
      span(text(sprint, s => `${s.total} pts total`)),
      span.dot('·'),
      span(text(sprint, s => `${s.done}/${s.total} pts done`)),
    ),
    div.sprint_bar(
      div.sprint_fill({ style: bind(sprint, s => `width:${s.pct}%`) }),
    ),
  ),
  section.board(STATUSES.map(column)),
])

// debug / test hooks
window.__kanban = {
  board, ui, colFilter, colSlot, colView, colCount, colPoints,
  cardsByPerson, pointsByPerson, value,
}
