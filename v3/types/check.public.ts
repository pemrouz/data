// v3/types/check.public.ts — compile-only fixture for the SHIPPED types
// (public.d.ts, the file package.json exports["."].types points at). Imports
// from the REAL specifier 'data' (mapped to ./public.d.ts by
// tsconfig.public.json's paths), so it checks exactly what an npm consumer's
// editor resolves. Positives must compile; every @ts-expect-error line must
// BITE — tsc fails both ways (a clean marked line reports TS2578 "Unused
// '@ts-expect-error' directive"), the check.ts/check.negative.ts idiom in one
// file. Never executed. Gate: `npx tsc -p v3/types/tsconfig.public.json`.

import {
  $, value, node, batch, runtime,
  render, el, text, list, bind, component, boundary, onCleanup,
  HTML, SVG, normChildren,
  h, Fragment, For, ErrorBoundary, jsx, jsxs, jsxDEV,
  fromAsync, exportContract, InMemoryBacking,
  DataNode, Runtime, handleFor, materialize, domLinks, liveLists,
} from 'data'
import type {
  ChangeRecordV2, WireRecord, RowKey,
  Data, ReadonlyData, OrderedData, Mirror, Scalar, View, Reactive,
  RowOf, ColOf, DataChild, ReadonlyChild, RafWriter, SubscriptionHandle,
  Element, VNodeLike, BindLike, CountBucket,
  AsyncSourceHandle, ContractManifest,
} from 'data'

type Row = { region: string; val: number; nested: { deep: number } }
type Rows = Record<string, Row>
const rows: Rows = {
  a: { region: 'north', val: 10, nested: { deep: 1 } },
  b: { region: 'south', val: 20, nested: { deep: 2 } },
}

// ── $() + chained operators ──────────────────────────────────────────────────
const d = $(rows) // expect: $ infers Data<Rows>
const prices = $([10, 20, 30]) // expect: array-born source is Data<number[]>

const north = d.filter((r) => r.region === 'north') // expect: filter row param is Row
const mapped: Record<string, number> = d.map((r) => r.val)[value] // expect: map re-types rows (keyed)
const winners: Row[] = d.za('val', 2)[value] // expect: bounded za materializes an ARRAY in rank order
const controls = $({ pageSize: 2, range: [0, 100] as [number, number] })
d.za('val', controls.pageSize) // expect: reactive window size — a child handle is a View<number>
const buckets = d.length((r) => r.region) // expect: length(fn) is the histogram (lengthBuckets)
const northCount: number = buckets[value]['north'].value // expect: buckets are { value: N } wrappers
const bucketVP: CountBucket = buckets[value]['south'] // expect: CountBucket is nameable
const total: number = d.sum('val')[value] // expect: sum('col') key-checked, Scalar<number>
const banded = d.between('val', [0, 100]) // expect: static numeric bounds
d.between('val') // expect: bounds optional (full domain)
const brushed = d.between('val', controls.range) // expect: reactive bounds HANDLE (the crossfilter-v3 idiom)
const both: Rows = banded.intersect(north, brushed)[value] // expect: intersect over sibling keyed views

// ── get / update / remove / patch / batch ────────────────────────────────────
const a: DataChild<Row> = d.get('a') // expect: get(key) is a typed child
a.update({ region: 'east', val: 5, nested: { deep: 0 } }) // expect: whole-row update row-checks
d.a.val.update(11) // expect: leaf update takes the field's type
d.a.nested.deep.update(7) // expect: sugar composes to any depth
d.set('c', { region: 'west', val: 1, nested: { deep: 3 } }) // expect: root set(k, row) row-checks
d.get('b').remove() // expect: row removal is a child method
d.patch([['a', { region: 'west', val: 1, nested: { deep: 3 } }]]) // expect: patch pairs are [key, row] tuples
prices.patch([[0, 11], [1, 21]]) // expect: array-born patch keys are numeric
const minted: RowKey = prices.insert(15, 1) // expect: insert returns the minted key
const batched: number = batch(() => {
  d.a.val.update(12)
  return d.sum('val')[value]
}) // expect: batch passes the fn's return through

// ── value / node symbol reads ────────────────────────────────────────────────
const snap: Rows = d[value] // expect: [value] is the plain snapshot
const rawNode: object = d[node] // expect: [node] is the graph node (opaque object)
const leaf: number = d.a.val[value] // expect: child [value] reads are typed
const derived: Rows = north[value] // expect: derived-view [value] too

// ── connect + the record vocabulary ──────────────────────────────────────────
const recs: ChangeRecordV2[] = []
const sub: SubscriptionHandle = d.connect(recs)
sub.dispose()
d.connect({}, (r) => { const t: 'update' | 'insert' | 'remove' | 'move' = r.type; void t })

// ── mirror + raf (HANDLE METHODS, not module exports) ────────────────────────
const m: Mirror<Rows> = d.mirror() // expect: mirror() is the re-pointable slot
m.set(north) // expect: repoint accepts a compatible view
const w: RafWriter<number> = d.a.val.raf() // expect: raf() writer typed to the leaf
w(5); w.flush(); w.cancel()

// ── render + el / text / list / bind + builders ──────────────────────────────
const host: any = {}
const ui = el(
  'section',
  { class: 'deck' },
  el('h1', null, 'totals'),
  text(d.sum('val'), (v) => v.toFixed(0)), // expect: format fn param infers number
  list(north, (r, k) => el('li', { 'data-key': String(k) }, r.region)), // expect: row/key infer
)
const rh = render(host, ui, runtime())
rh.dispose()
const card: VNodeLike = HTML.div.card('#sum: ', 42) // expect: dot sugar chains; call returns a vnode
render(host, [card, HTML.span('x'), SVG.path({ d: 'M0 0' })]) // expect: render takes a vnode array
const bp: BindLike = bind(d.length(), (n) => (n > 0 ? 'full' : 'empty')) // expect: bind fn infers number
el('button', { onClick: () => {}, disabled: bind(d.length(), (n) => n === 0) })
const normed: VNodeLike[] = normChildren(['x', 1, null, ui])

// ── components / boundaries / cleanup + h / Fragment / For direct ────────────
const Chip = (props: { label: string }) => el('span', { class: 'chip' }, props.label)
const cn: VNodeLike = component(Chip, { label: 'x' }) // expect: props type-check against the fn
const bn: VNodeLike = boundary(cn, (err, reset) => {
  void reset
  return el('div', null, String(err))
})
const Comp2 = () => {
  onCleanup(() => {}) // expect: cleanup registers on the ambient scope
  return el('div', null)
}
const hv: Element = h('div', { class: 'x' }, 'static ', text(d.length())) // expect: string-tag h
const hc: Element = h(Chip, { label: 'y' }) // expect: component-tag h checks props
const fr: Element = Fragment({ children: [hv, hc] })
const fo: Element = For({
  each: north,
  children: (r, k) => h('li', null, r.region, String(k)), // expect: row type infers from each
})
const eb: Element = ErrorBoundary({
  fallback: (err, reset) => { void reset; return el('div', null, String(err)) },
  children: hv,
})
const jv: Element = jsx('div', { class: 'x', children: 'hi' }) // expect: automatic-runtime verbs
const js2: Element = jsxs('ul', { children: [h('li', null, 'a')] })
const jd: Element = jsxDEV('div', null, undefined, false, undefined, undefined)

// ── seam: fromAsync / exportContract / InMemoryBacking (loose) ───────────────
const rt: Runtime = runtime()
const ah: AsyncSourceHandle<{ id: number }> = fromAsync(rt, Promise.resolve([{ id: 1 }]), {
  key: (r) => r.id, // expect: key fn row infers, returns RowKey
  coalesce: 'microtask',
  onStatus: (s) => { const st: 'pending' | 'ready' | 'error' = s; void st },
})
const status: 'pending' | 'ready' | 'error' = ah.status()
ah.dispose()
const wire: WireRecord = { t: 'add', k: 'z', v: { region: 'west', val: 1, nested: { deep: 0 } } }
d.ingest([wire], { origin: Symbol('remote') }) // expect: ingest takes wire records + origin
const backing = new InMemoryBacking(rt, rows)
backing.apply([wire])
const loaded: { rows: Map<RowKey, Row>; order: readonly RowKey[] | null } = backing.load()
const manifest: ContractManifest = exportContract()
const reservedNames: readonly string[] = manifest.reserved

// ── devtools seam is reachable but opaque ────────────────────────────────────
const dn: DataNode<any> = d[node] as DataNode<any>
const again: any = handleFor(dn)
const mat: unknown = materialize(new Map(), null)
void domLinks; void liveLists

// ── the public vocabulary is NAMEABLE (the export gate) ──────────────────────
const _d: Data<Rows> = d
const _rd: ReadonlyData<Rows> = north
const _od: OrderedData<Rows> = d.az('val', 10)
const _sc: Scalar<number> = d.length()
const _v: View<Rows> = north
const _re: Reactive<number> = controls.pageSize
const _row: RowOf<Rows> = rows.a
const _col: ColOf<Rows> = 'val'
const _rc: ReadonlyChild<Row> = north.get('a')

// ── negatives: every line must FAIL to compile ───────────────────────────────
// @ts-expect-error — 'amont' is not a column of Row (ColOf key-checking)
d.sum('amont')
// @ts-expect-error — 'typo' is not a column (between)
d.between('typo', [0, 1])
// @ts-expect-error — between bounds are numeric (or a View of a numeric tuple)
d.between('val', ['a', 'b'])
// @ts-expect-error — a window size is Reactive<number>, not a string
d.za('val', 'ten')
// @ts-expect-error — the predicate row is Row, not any ('bogus' does not exist)
d.filter((r) => r.bogus > 3)
// @ts-expect-error — patch takes [key, row] TUPLE pairs; v2's flat array form is gone
d.patch(['a', rows.a, 'b', rows.b])
// @ts-expect-error — a derived view is read-only: no insert (write through the source)
north.insert({ region: 'x', val: 0, nested: { deep: 0 } })
// @ts-expect-error — operator-view children have no update either
north.a.update({ region: 'x', val: 0, nested: { deep: 0 } })
// @ts-expect-error — bare child assignment is not the write surface (use set/update)
d.a = { region: 'x', val: 0, nested: { deep: 0 } }
// @ts-expect-error — a string leaf rejects a number write
d.a.region.update(42)
// @ts-expect-error — onCleanup registers a FUNCTION
onCleanup(123)
// @ts-expect-error — ErrorBoundary REQUIRES the fallback prop
ErrorBoundary({ children: hv })
// @ts-expect-error — For requires the row-fn child
For({ each: north })

void mapped; void winners; void northCount; void bucketVP; void total; void both
void a; void minted; void batched; void snap; void rawNode; void leaf; void derived
void bp; void normed; void bn; void Comp2; void fr; void fo; void eb; void jv; void js2
void jd; void status; void loaded; void reservedNames; void again; void mat
void _d; void _rd; void _od; void _sc; void _v; void _re; void _row; void _col; void _rc
