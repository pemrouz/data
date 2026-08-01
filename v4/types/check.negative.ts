// v3/types/check.negative.ts — NEGATIVE fixtures: every `@ts-expect-error`
// marks a pattern that MUST NOT type-check. tsc fails the gate both ways:
// a marked line that compiles clean reports TS2578 ("Unused '@ts-expect-error'
// directive"), and an unmarked line that errors fails normally — so this file
// locks in the surface's REJECTIONS (the half a positive fixture can't guard,
// and how a type that silently widens to `any` gets caught). v2 idiom
// (types/check.negative.ts) carried over to v3.

import { typedDollar as $, value } from './surface.ts'

type Row = { region: string; val: number; nested: { deep: number } }
const d = $({
  a: { region: 'north', val: 10, nested: { deep: 1 } },
  b: { region: 'south', val: 20, nested: { deep: 2 } },
} as Record<string, Row>)
const fixed = $({ a: { on: true }, b: { on: false } })
const prices = $([10, 20, 30])
const north = d.filter((r) => r.region === 'north')

// ── bare assignment / delete are NOT the write surface (methods only) ────────
// @ts-expect-error — bare child assignment is rejected (use .set / .get(k).update)
d.a = { region: 'x', val: 0, nested: { deep: 0 } }
// @ts-expect-error — bare leaf assignment is rejected (use .update / .set)
d.a.val = 13
// @ts-expect-error — [value] whole-view assignment is a v2 idiom, gone in v3
d[value] = {}
// @ts-expect-error — delete is not the write surface (use .get(k).remove())
delete d.a
// @ts-expect-error — fixed-shape children are readonly too
fixed.a.on = true

// ── wrong update types ───────────────────────────────────────────────────────
// @ts-expect-error — a string is not assignable to the number leaf 'val'
d.a.val.update('yes')
// @ts-expect-error — a partial row is not a Row (nested missing)
d.get('a').update({ region: 'x', val: 1 })
// @ts-expect-error — deep leaf updates are type-checked as well
d.a.nested.deep.update('deep')
// @ts-expect-error — child set(k, v) value-checks against the field
d.a.set('val', 'not-a-number')
// @ts-expect-error — root set(k, row) row-checks
d.set('c', 42)
// @ts-expect-error — insert takes the row type
d.insert(42)
// @ts-expect-error — patch pairs are [key, row]-typed
d.patch([['a', 42]])

// ── wrong column names (ColOf key-checking) ──────────────────────────────────
// @ts-expect-error — 'amont' is not a column of Row
d.sum('amont')
// @ts-expect-error — 'typo' is not a column (sort)
d.az('typo')
// @ts-expect-error — 'typo' is not a column (compare)
d.gt('typo', 3)
// @ts-expect-error — 'typo' is not a column (between)
d.between('typo', [0, 1])
// @ts-expect-error — 'typo' is not a column (max)
d.max('typo')

// ── wrong value types in operator args ───────────────────────────────────────
// @ts-expect-error — between bounds are numeric
d.between('val', ['a', 'b'])
// @ts-expect-error — the threshold is typed from the column (number, not string)
d.gt('val', 'high')
// @ts-expect-error — a window size is Reactive<number>, not a string
d.za('val', 'ten')
// @ts-expect-error — a View<string> child is not a Reactive<number> threshold
d.gt('val', $({ s: 'x' }).s)
// @ts-expect-error — the predicate row is Row, not any ('bogus' does not exist)
d.filter((r) => r.bogus > 3)
// @ts-expect-error — map's row is typed too
d.map((r) => r.bogus)
// @ts-expect-error — reduce's init is a plain identity element, never a view
d.reduce((acc: number, r) => acc + r.val, d.sum('val'))

// ── aggregate value types are precise (never `any`) ──────────────────────────
// @ts-expect-error — max('region') is string | undefined, not number
const _m1: number = d.max('region')[value]
// @ts-expect-error — avg may be undefined on the empty set
const _m2: number = d.avg('val')[value]
// @ts-expect-error — some() is a boolean scalar, not a number
const _m3: number = d.some((r) => r.val > 0)[value]

// ── calling operators on scalars ─────────────────────────────────────────────
// @ts-expect-error — a Scalar<number> has no row operators
d.length().filter((r: unknown) => r)
// @ts-expect-error — a Scalar<number> has no sort
d.sum('val').za('val')
// @ts-expect-error — a Scalar<number> has no children sugar
d.length().val

// ── operator views are read-only projections ─────────────────────────────────
// @ts-expect-error — no update on an operator-view child (write through the source)
north.a.update({ region: 'x', val: 0, nested: { deep: 0 } })
// @ts-expect-error — no remove on an operator-view child
north.get('a').remove()
// @ts-expect-error — no insert on an operator view
north.insert({ region: 'x', val: 0, nested: { deep: 0 } })
// @ts-expect-error — no set on an operator view
north.set('a', { region: 'x', val: 0, nested: { deep: 0 } })
// @ts-expect-error — no patch on an operator view
north.patch([['a', { region: 'x', val: 0, nested: { deep: 0 } }]])
// @ts-expect-error — operator-view children are readonly (no bare assignment either)
north.a.val = 5

// ── child handles are path ADDRESSES, not views ──────────────────────────────
// (the runtime would dispatch .filter against the OWNING source — forbidden here)
// @ts-expect-error — no operator methods on a child handle
d.a.filter((r: Row) => true)
// @ts-expect-error — no connect on a child handle (a runtime throw today)
d.a.val.connect([])

// ── addressing mistakes ──────────────────────────────────────────────────────
// @ts-expect-error — 'zzz' is not a key of the fixed-shape source
fixed.get('zzz')
// @ts-expect-error — use [value] (the symbol), not .value — no child named 'value' here
fixed.value
// @ts-expect-error — connect(fn) is not a valid sink (use connect(anchor, fn))
d.connect(() => {})
// @ts-expect-error — a mirror repoints only to a view of the SAME shape
d.mirror().set(prices)
// @ts-expect-error — v2's length(fn) histogram is not on the v3 surface (lengthBuckets gap)
d.length((r: Row) => r.region)
// @ts-expect-error — 'join' is RESERVED but unimplemented: no signature yet
d.join(north)
// @ts-expect-error — 'page' is RESERVED but unimplemented: no signature yet
d.page(2)

void north; void prices
