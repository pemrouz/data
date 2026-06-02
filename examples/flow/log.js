/* The essay's protagonist: the change log, and the folds over it.
 *
 * Everything you see on the page is a window onto ONE model built here:
 *
 *   • `log`      — the append-only sequence of change records the library
 *                  itself emits. We capture it straight off the source via
 *                  `connect`, so these are the runtime's REAL records
 *                  ({ type, key, value, at? } — a path-addressed delta),
 *                  not a hand-rolled imitation.
 *   • `display`  — a `$()` source whose value is the fold of `log[0..head]`.
 *                  Move the playhead and we re-fold into it; the derived
 *                  views below re-derive for free.
 *   • the folds  — `active`, `perRegion`, `avg` are ordinary one-line
 *                  operator chains off `display`. Each IS a fold over the
 *                  log; the runtime maintains it.
 *
 * Two ways to move through the log, and the whole cost story lives in the
 * difference:
 *   • append(mutate)  — apply ONE record at the head incrementally. The
 *                       runtime pays O(Δ); we diff each fold's output to see
 *                       which ones the record actually moved (selectivity).
 *   • scrubTo(k)      — reconstruct state at an arbitrary point by re-folding
 *                       log[0..k] from zero. That's O(k) — the naive baseline.
 *
 * Hand-written .js, no .ts sibling (see CLAUDE.md).
 */

import { $, value } from 'data/full'

export const REGIONS = ['north', 'south', 'east', 'west']
export const FOLDS = ['orders', 'active', 'perRegion', 'avg']

const clone = v => (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v

export function createLog (seed) {
  /* the fold root + the derived folds — each a one-line operator chain.
   * Keyed by id (an object), so removal is a clean per-key delete with stable
   * keys — no array index-shifting to keep the plain fold in lockstep with. */
  const display   = $({})
  const active    = display.filter(o => o.active)
  const perRegion = active.length(o => o.region)
  const avg       = display.avg('value')

  const log = []
  let head = 0
  let nextId = 1
  let capturing = false

  /* capture the runtime's real records — but only while we're appending, so a
   * scrub's wholesale re-fold doesn't pollute history. The two-arg
   * `connect(anchor, fn)` form attaches a FunctionSink and pins it to `anchor`
   * so the WeakRef sink survives GC (CLAUDE.md gotcha). */
  const anchor = {}
  display.connect(anchor, c => { if (capturing) log.push(cloneRecord(c)) })

  /* pin every view + sink so nothing is collected mid-session. */
  const keep = { display, active, perRegion, avg, anchor }
  globalThis.__flowKeep = keep

  function cloneRecord (c) {
    return { type: c.type, key: (c.key || []).slice(), value: clone(c.value), at: c.at }
  }

  /* ---- the fold, in plain JS: state = records.reduce(apply, []) ----
   * This is exactly what the runtime does internally, written out so it's
   * inspectable. `visits` counts the work — the re-fold cost. */
  function foldPlain (records, upTo) {
    let acc = {}
    let visits = 0
    const n = upTo == null ? records.length : upTo
    for (let i = 0; i < n; i++) {
      const r = records[i]; visits++
      if (r.type === 'insert') {
        acc[r.at] = clone(r.value)
      } else if (r.type === 'remove') {
        delete acc[r.key[0]]
      } else if (r.type === 'update') {
        if (r.key.length === 0) acc = clone(r.value)
        else if (r.key.length === 1) acc[r.key[0]] = clone(r.value)
        else { const row = acc[r.key[0]]; if (row) row[r.key[r.key.length - 1]] = clone(r.value) }
      }
    }
    return { acc, visits }
  }

  /* re-fold log[0..k] into `display`. The folds re-derive automatically. */
  function scrubTo (k) {
    head = Math.max(0, Math.min(log.length, k | 0))
    const { acc } = foldPlain(log, head)
    display[value] = acc
    return head
  }

  /* snapshot the three folds' OUTPUTS, so an append can tell which actually
   * moved (changed) — a finer thing than which the record reached. */
  function snap () {
    return {
      active: JSON.stringify(Object.values(active[value] || {}).filter(Boolean).map(r => [r.id, r.region, r.value])),
      region: REGIONS.map(r => perRegion[r]?.value?.[value] ?? 0).join(','),
      avg: avg[value],
    }
  }

  /* apply ONE record at the head, incrementally, through the runtime, and read
   * back which folds it actually CHANGED — by diffing each fold's output before
   * and after. The runtime maintains the folds; we only observe which moved.
   * That set is the record's selectivity footprint. */
  function append (mutate) {
    if (head !== log.length) {           // fast-forward silently to the live end
      const { acc } = foldPlain(log, log.length)
      display[value] = acc
    }
    const before = log.length
    const pre = snap()
    capturing = true
    mutate(display)
    capturing = false
    head = log.length
    const post = snap()

    const changed = new Set(['orders'])
    if (post.active !== pre.active) changed.add('active')
    if (post.region !== pre.region) changed.add('perRegion')
    if (post.avg !== pre.avg) changed.add('avg')

    for (let i = before; i < log.length; i++) log[i].changed = changed
    return log.slice(before)
  }

  function presentKeys () {
    return Object.keys(display[value]).filter(k => display[value][k] != null)
  }
  const tag = (recs, meta) => { for (const r of recs) Object.assign(r, meta); return recs }
  const pick = ks => ks[(Math.random() * ks.length) | 0]

  /* ---- the reader's verbs — each appends exactly one record, tagged with
   * the row id + field it touched so the timeline chips can label themselves
   * without re-folding the log. ---- */
  const actions = {
    insert () {
      const id = nextId++
      const region = REGIONS[(id - 1) % REGIONS.length]
      const v = 40 + ((id * 37) % 80)
      return tag(append(d => { d[id] = { id, active: id % 2 === 1, region, value: v } }), { rid: id, field: 'row' })
    },
    toggle () {
      const ks = presentKeys(); if (!ks.length) return actions.insert()
      const k = pick(ks); const rid = display[value][k].id
      return tag(append(d => { d[k].active = !d[k].active[value] }), { rid, field: 'active' })
    },
    bump () {
      const ks = presentKeys().filter(k => display[value][k].active)
      if (!ks.length) return actions.toggle()
      const k = pick(ks); const rid = display[value][k].id
      return tag(append(d => { d[k].value = d[k].value[value] + 15 }), { rid, field: 'value' })
    },
    remove () {
      const ks = presentKeys(); if (!ks.length) return []
      const k = pick(ks); const rid = display[value][k].id
      return tag(append(d => { delete d[k] }), { rid, field: 'row' })
    },
  }

  /* seed the log as a sequence of inserts (clean opening chips). */
  capturing = true
  for (const r of seed) { const id = nextId++; r.id = id; display[id] = r }
  capturing = false
  head = log.length
  for (let i = 0; i < log.length; i++) { log[i].changed = new Set(FOLDS); log[i].rid = seed[i] && seed[i].id; log[i].field = 'row' }

  return {
    display, active, perRegion, avg, log, keep,
    head: () => head, scrubTo, append, actions, foldPlain, nextId: () => nextId,
  }
}
