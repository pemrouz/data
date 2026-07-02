// v3/types/check.ts — POSITIVE consumer fixtures for the v3 typed surface.
// Compiled by `npx tsc -p v3/types` (noCheck:false): every line marked
// `// expect:` is one fixture assertion that MUST type-check. The rejection
// half lives in check.negative.ts. Never executed — compile-only, like the
// v2 types/check.ts idiom this carries over.

import { typedDollar as $, value } from './surface.ts'
import type {
  ChangeRecordV2,
  Children,
  ColOf,
  Data,
  DataChild,
  Mirror,
  OrderedData,
  RafWriter,
  Reactive,
  ReadonlyChild,
  ReadonlyData,
  RowOf,
  Scalar,
  SubscriptionHandle,
  View,
  WireRecord,
} from './surface.ts'

type Row = { region: string; val: number; nested: { deep: number } }
type Rows = Record<string, Row>
const rows: Rows = {
  a: { region: 'north', val: 10, nested: { deep: 1 } },
  b: { region: 'south', val: 20, nested: { deep: 2 } },
}

// ── sources ──────────────────────────────────────────────────────────────────
const d = $(rows) // expect: $ infers Data<Record<string, Row>>
const fixed = $({ a: { on: true }, b: { on: false } }) // expect: fixed-shape source infers
const prices = $([10, 20, 30]) // expect: array-born source is Data<number[]>

// ── chaining infers the row type ─────────────────────────────────────────────
const north = d.filter((r) => r.region === 'north') // expect: filter row param is Row (r.region: string)
const winners = north.za('val', 2) // expect: za('col') is key-checked via ColOf and chains off a derived view
const ordered: Row[] = winners[value] // expect: ordered view [value] is an ARRAY in rank order
const rechain = winners.filter((r) => r.val > 0) // expect: RowOf survives through an ordered view
const mapped: Record<string, number> = d.map((r) => r.val)[value] // expect: map re-types rows (keyed output)
const banded = d.between('val', [0, 100]) // expect: between bounds are numeric; column key-checked
d.between('val') // expect: bounds are optional (full domain)
d.between('val', [5]) // expect: half-open bounds
const hot = d.gt('val', 15) // expect: threshold typed from the column (number)
d.lt('val', 15); d.gte('val', 15); d.lte('val', 15) // expect: whole compare family key-checked

// ── aggregates: precisely-typed scalars ──────────────────────────────────────
const count: number = d.length()[value] // expect: length() is Scalar<number>
const total: number = d.sum('val')[value] // expect: sum('col') key-checked, plain number (0 on empty)
const mean: number | undefined = d.avg('val')[value] // expect: avg may be undefined on the empty set
const hi: number | undefined = d.max('val')[value] // expect: max carries the COLUMN's element type
const loName: string | undefined = d.min('region')[value] // expect: min('region') is string-typed
const hiRow: Row | undefined = $(rows).max()[value] // expect: no-column max is row-typed
const any10: boolean = d.some((r) => r.val > 10)[value] // expect: some is Scalar<boolean>, row inferred
const all10: boolean = d.every((r) => r.val > 10)[value] // expect: every is Scalar<boolean>
const scalarSum: number = prices.sum()[value] // expect: scalar rows — column-less aggregate

// ── reduce (both arities) + to ───────────────────────────────────────────────
const folded: number = d.reduce((acc: number, r) => acc + r.val, 0)[value] // expect: 2-arg fold, row inferred
const inc: number = d.reduce((acc: number, r) => acc + r.val, (acc: number, r) => acc - r.val, 0)[value] // expect: 3-arg incremental fold
const size: number = d.to((plain) => Object.keys(plain).length)[value] // expect: to() sees the whole plain snapshot

// ── reactive value-slot args accept View<number> ─────────────────────────────
const controls = $({ pageSize: 2, threshold: 15 }) // NB not `page` — that's a RESERVED name, so it can't be a sugar key
d.za('val', controls.pageSize) // expect: a child handle is a View<number> — reactive window size
d.top(controls.pageSize); d.limit(controls.pageSize) // expect: top/limit reactive n
d.gt('val', controls.threshold) // expect: reactive threshold
d.gt('val', d.sum('val')) // expect: a Scalar<number> is a View<number> too
d.sum(controls.threshold.snapshot() > 0 ? 'val' : undefined) // expect: sum col stays optional
const bound: Reactive<number> = controls.pageSize // expect: Reactive<T> is nameable and accepts a live view
const covariant: View<{ region: string }> = north.get('a') // expect: View is covariant (Row ⊆ {region})

// ── get() returns typed children; nested update requires the leaf type ──────
const a = d.get('a') // expect: get(key) is DataChild<Row>
const av: number = a.get('val')[value] // expect: nested get is typed
a.val.update(11) // expect: leaf update takes the field's type
a.set('val', 12) // expect: child set(k, v) value-checks against the field
d.a.nested.deep.update(7) // expect: property sugar composes to any depth
const deep: number = d.a.nested.deep[value] // expect: deep child reads are typed
a.remove() // expect: row removal is a method on the child
const fixedOn: boolean = fixed.a.on[value] // expect: fixed-shape children are per-key typed
fixed.get('b').on.update(true) // expect: fixed-shape get() is key-checked

// ── methods-only writes on the source root ───────────────────────────────────
d.set('c', { region: 'east', val: 5, nested: { deep: 0 } }) // expect: root set(k, row) row-checks
const minted: string | number = prices.insert(15, 1) // expect: insert returns the minted RowKey
prices.patch([[0, 11], [1, 21]]) // expect: patch pairs are [key, row]-typed
d.patch([['a', { region: 'west', val: 1, nested: { deep: 3 } }]]) // expect: object-source patch
const wire: WireRecord = { t: 'add', k: 'z', v: { region: 'west', val: 1, nested: { deep: 0 } } }
d.ingest([wire]) // expect: ingest takes wire records
d.ingest([{ type: 'update', key: ['a', 'val'], value: 5 }], { origin: Symbol('remote') }) // expect: v2 profile + origin

// ── connect arities ──────────────────────────────────────────────────────────
const recs: ChangeRecordV2[] = []
const h: SubscriptionHandle = d.connect(recs) // expect: connect([]) pushes v2 records, returns a handle
h.dispose()
d.connect({}, (r) => { const t: 'update' | 'insert' | 'remove' | 'move' = r.type; void t }) // expect: connect(anchor, fn) infers the record
d.sum('val').connect({}, 'total') // expect: connect(obj, prop) mirrors a scalar
north.connect(recs) // expect: derived views connect too

// ── ordered / keyed materialization ──────────────────────────────────────────
const paged: OrderedData<Rows> = d.az('val', 10) // expect: OrderedData is nameable
const pagedRows: Row[] = paged[value] // expect: bounded az materializes an array
const keyedFilter: Record<string, number> = prices.filter((n) => n > 1)[value] // expect: array-born row ops materialize KEYED

// ── set algebra over keyed views ─────────────────────────────────────────────
const both = banded.intersect(north) // expect: intersect takes sibling keyed views
banded.union(north, hot) // expect: union multi-operand
d.except(north) // expect: except off the source handle
const bothRows: Rows = both[value] // expect: set output stays keyed

// ── buckets ──────────────────────────────────────────────────────────────────
const byRegion = d.group((r) => r.region) // expect: group(fn) infers the row
const bucket: Record<string, Row> | undefined = byRegion[value]['north'] // expect: buckets are keyed member maps
const regions: Record<string, string> = d.distinct((r) => r.region)[value] // expect: distinct(fn) keys by projection
const dedup: Record<string, Row> = $(rows).distinct()[value] // expect: identity distinct keeps rows
const ks: Record<string, string> = d.keys()[value] // expect: keys() view
const vs: Rows = d.values()[value] // expect: values() identity view

// ── effect / iteration / misc built-ins ──────────────────────────────────────
d.tap(() => {}) // expect: bare 0-arg tap
d.tap((change) => { void change.type }) // expect: 1-arg tap gets the change record
for (const r of d) { const rr: Row = r; void rr } // expect: handles iterate their rows
const spread: number[] = [...prices] // expect: array-born iteration yields the row type
const firstRow: Row = d.first()[value] // expect: first() is a typed child
const lastRow: Row = d.last()[value] // expect: last() is a typed child
const nfirst: Row = north.first()[value] // expect: derived-view first() is a READONLY child
const w: RafWriter<number> = d.a.val.raf() // expect: raf() writer is typed to the leaf
w(5); w.flush(); w.cancel() // expect: writer verbs
const m: Mirror<Rows> = d.mirror() // expect: mirror() is the explicit swap handle
m.set(north) // expect: repointing accepts a compatible view
const nsnap: Rows = north.snapshot() // expect: snapshot() is typed
const na: Row = north.a[value] // expect: operator-view children read through the snapshot
const nav: number = north.a.val[value] // expect: ...to any depth
const ng: ReadonlyChild<Row> = north.get('a') // expect: derived get() is a readonly child

// ── dynamic / fallback sources ───────────────────────────────────────────────
const dyn = $({} as Record<string, number>)
dyn.az('whatever-column') // expect: scalar-row sources accept any string column (the fallback)
const dynSum: number = dyn.sum()[value] // expect: column-less sum over scalar rows

// ── the public vocabulary is NAMEABLE (the export gate) ──────────────────────
const _d: Data<Rows> = d // expect: Data
const _rd: ReadonlyData<Rows> = north // expect: ReadonlyData
const _row: RowOf<Rows> = { region: 'x', val: 1, nested: { deep: 0 } } // expect: RowOf
const _col: ColOf<Rows> = 'val' // expect: ColOf key-checks
const _sc: Scalar<number> = d.length() // expect: Scalar
const _ch: Children<Rows> = null as unknown as Children<Rows> // expect: Children is nameable
const _chx: DataChild<Row> = _ch['anything'] // expect: Children maps names to typed child handles

void ordered; void rechain; void mapped; void count; void total; void mean; void hi; void loName
void hiRow; void any10; void all10; void scalarSum; void folded; void inc; void size; void bound
void covariant; void av; void deep; void fixedOn; void minted; void pagedRows; void keyedFilter
void bothRows; void bucket; void regions; void dedup; void ks; void vs; void spread; void firstRow
void lastRow; void nfirst; void nsnap; void na; void nav; void ng; void dynSum
void _d; void _rd; void _row; void _col; void _sc; void _chx
