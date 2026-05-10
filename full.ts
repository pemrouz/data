// @ts-nocheck
// "Batteries-included" entry: re-exports the core surface from `./index.ts`
// and *additionally* registers every operator on the global Operators dispatch
// table so chainable methods (`proxy.filter(...)`, `proxy.between(...)`, …) are
// available. Importing this module has the side effect of populating the
// dispatch — that is its whole purpose.
//
// Most apps want this entry. Consumers who care about tree-shaking and only
// use a subset of operators can import from `data` (the lean entry) and call
// the function-style API exported by individual operator modules.
export * from './index.ts'
// JSX authoring layer. Re-exported here (rather than as its own dist entry)
// so the host element identity (NodeProxy class, NODE/view symbols) stays
// shared with `render`, `HTML`, `SVG`. With separate bundles, each entry
// gets its own NodeProxy class and `instanceof` checks across bundles fail —
// folding JSX into `data/full` keeps everything one bundle, one identity.
export { h, Fragment, For, jsx, jsxs, jsxDEV } from './jsx/index.ts'

import { isArray } from './utils.ts'
import { Operators } from './core.ts'
import { FilterValue, FilterObjectValue, FilterStringValue, FilterColumnValue } from './operators/filter/index.ts'
import { BetweenValue } from './operators/between/index.ts'
import { ZAColumnValue, ZANumberValue, AZColumnValue, AZNumberValue, LimitValue } from './operators/sort/index.ts'
import { ToValue } from './operators/to/index.ts'
import { MapValue } from './operators/map/index.ts'
import { GroupValue } from './operators/group/index.ts'
import { LengthValue, LengthFnValue } from './operators/length/index.ts'
import { IntersectValue } from './operators/intersect/index.ts'
import { SumValue, AvgValue, MaxValue, MinValue, SomeValue, EveryValue } from './operators/aggregate/index.ts'
import { TapValue, TapBareValue } from './operators/tap/index.ts'
import { DistinctValue } from './operators/distinct/index.ts'
import { ReduceValue, ReduceIncrementalValue } from './operators/reduce/index.ts'
import { UnionValue } from './operators/union/index.ts'
import { ExceptValue } from './operators/except/index.ts'
import { KeysValue, ValuesValue } from './operators/keys/index.ts'
import { ReverseValue } from './operators/reverse/index.ts'

// Operator dispatch table. Each entry receives the call arguments and returns
// the appropriate Operator subclass — letting one method name (`filter`,
// `length`, `za`/`az`) cover several internal implementations chosen by
// argument shape. Adding an operator means: implement the class, then a
// one-line registration here.
Operators['filter']    = (a, b) => typeof a === 'function' ? FilterValue   // filter(fn)
                                 : typeof a === 'string'   ? FilterStringValue // filter('key', val?)
                                 : isArray(a)              ? FilterColumnValue // filter(['k','sub'], val?)
                                 : FilterObjectValue                            // filter({k:v,...})
Operators['between']   = () => BetweenValue
Operators['to']        = () => ToValue
Operators['map']       = () => MapValue
// length() counts rows; length(fn) groups by fn(row) and counts each group.
Operators['length']    = (fn) => typeof fn === 'function' ? LengthFnValue : LengthValue
Operators['intersect'] = () => IntersectValue
Operators['group']     = () => GroupValue
// za sorts descending, az sorts ascending. `top` is `za` with no column —
// rows compared as-is — useful when the source itself is comparable
// (numbers, dates, strings) rather than rows-with-columns.
Operators['za']        = (a, b) => typeof a === 'string' ? ZAColumnValue : ZANumberValue
Operators['top']       = () => ZANumberValue
Operators['az']        = (a, b) => typeof a === 'string' ? AZColumnValue : AZNumberValue
Operators['limit']     = () => LimitValue
// Scalar aggregates: each takes an optional column accessor, returns a
// single-value reactive view. sum/avg are O(1) per change; max/min recompute
// O(n) per change (simple-correct, swap in a sorted multiset if it bottlenecks).
Operators['sum']       = () => SumValue
Operators['avg']       = () => AvgValue
Operators['max']       = () => MaxValue
Operators['min']       = () => MinValue
// Predicate aggregates: scalar booleans tracking whether ANY (some) or ALL
// (every) tracked rows match the predicate. Empty set: some=false, every=true.
Operators['some']      = () => SomeValue
Operators['every']     = () => EveryValue
// tap: passthrough operator that fires fn(change) on every event AND
// propagates downstream. For declarative side effects (logging, persistence).
// `fn.length === 0` (zero-arg callback) opts into TapBareValue: skips
// structuredClone + per-row record construction, fires fn() once per emit.
// Strict 0-arity check — `(c) => doThing()` (length 1) keeps the full
// record path so a minifier that drops unused params doesn't silently
// downgrade real consumers.
Operators['tap']       = (fn) => typeof fn === 'function' && fn.length === 0 ? TapBareValue : TapValue
// distinct: dedup rows by a projection, materialized as a first-seen array.
// reduce: general fold over rows; rebuilds on change (use the dedicated
// aggregates for commutative ops — they're O(1) per delta).
Operators['distinct']  = () => DistinctValue
// reduce(fn, init) — general fold, O(n) rebuild per change.
// reduce(add, remove, init) — incremental, O(Δ) per insert/remove batch.
// Dispatch key is `typeof second-arg === 'function'`: a function in the
// second slot means the caller passed (add, remove, init); a non-function
// (or undefined) means (fn, init) with init being a value or a thunk.
Operators['reduce']    = (_, b) => typeof b === 'function' ? ReduceIncrementalValue : ReduceValue
// Set algebra companions to intersect:
//   union(...): rows in any source (value from first source containing it)
//   except(other): rows in source but not in other
Operators['union']     = () => UnionValue
Operators['except']    = () => ExceptValue
// Collection projections: snapshot of current keys / values, rebuilt on change.
Operators['keys']      = () => KeysValue
Operators['values']    = () => ValuesValue
// reverse: array order inversion, full rebuild on change.
Operators['reverse']   = () => ReverseValue
