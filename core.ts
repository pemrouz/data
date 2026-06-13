// @ts-nocheck
import { iter, isArray, noop } from './utils.ts'

// `value` and `view` are Symbol keys deliberately not exported as plain
// properties to keep the proxy's user-facing namespace clean: any string-named
// access on a ViewProxy creates a child view, so internal state has to live on
// a Symbol to avoid colliding with user data. `reactive` is a global symbol so
// foreign code (e.g. render templates from a separately-bundled copy) can ask
// "is this a reactive value?" without needing access to this module's exports.
/**
 * Symbol key for reading/writing a proxy's raw underlying value.
 *
 * Use `proxy[value]` to read the snapshot and `proxy[value] = next` to replace
 * it. Read with the symbol, **not** `proxy.value` — any string-named access on a
 * ViewProxy creates a child view, so `proxy.value` would make a child named
 * "value" rather than returning the data.
 *
 * @example
 * import { $, value } from 'data'
 * const n = $(41)
 * n[value]        // 41
 * n[value] = 42   // now 42
 */
export const value = Symbol('value')
export const reactive = Symbol.for('reactive')
export const view = Symbol('view')
const Symbols = { value, view }
const isObject = v => v.constructor === Object
// Sinks emit value snapshots through their callback; cloning here means the
// consumer can mutate freely without ever leaking back into the live tree.
// `d[view] ? d[view].value` short-circuits the structuredClone for nested
// proxies — those carry the live ref and would throw on clone otherwise.
// `d == null` (not `=== undefined`): null is ordinary data and must pass
// through — `null[view]` would throw mid-cascade, aborting fan-out after the
// backing value was already committed.
const sclone = d =>
  d == null ? d
: d[view] ? d[view].value
: structuredClone(d)

// --- cascade re-entrancy discipline ---
// Mutations fan out to sinks synchronously. A sink callback that writes back to
// the graph (a derive-on-change rule, a clamp, an echo) would otherwise RE-ENTER
// the fan-out mid-flight: unbounded recursion -> stack overflow and a
// half-applied, permanently-poisoned graph; or — for a terminating rule —
// events delivered out of order, so payload-driven sinks (running-total
// aggregates, change streams) read a stale delta and desync forever. Instead we
// run the outermost mutation to completion, THEN drain re-entrant writes FIFO,
// so every write lands atomically and in submission order. A genuinely
// non-converging feedback loop (a rule that rewrites its own trigger every time)
// can't be made to terminate, but is reported via _DRAIN_CAP rather than hanging
// or overflowing the stack. transact() is wrapped around the public mutation
// entry points only (Value.update/insert/remove and the patch path); the
// internal verb methods (XU0/BU1/BU2/BI0/BR1/...) run inline as the fan-out
// itself, never deferred.
let _cascading = false
const _pending = []
let _errors = null
const _DRAIN_CAP = 100_000 // re-entrant writes drained per top-level mutation; far above any legitimate fan-out
function transact(fn) {
  if (_cascading) { _pending.push(fn); return }
  _cascading = true
  try {
    fn()
    let n = 0
    while (_pending.length) {
      if (++n > _DRAIN_CAP)
        throw new Error('reactive cycle: a sink keeps writing back to its source without converging')
      _pending.shift()()
    }
    // Exception isolation: a sink that threw mid-fan-out did NOT rob the sinks
    // after it of the event (they were still notified — see _notify). Surface
    // the first such error now that every sink has seen the delta, so the
    // mutator still learns something went wrong without one bad sink silently
    // desyncing a running-total aggregate registered behind it.
    if (_errors) throw _errors[0]
  } finally {
    _pending.length = 0
    _cascading = false
    _errors = null
  }
}
// Invoke a single sink, isolating its exception so the rest of the fan-out
// still runs. Errors are stashed and rethrown by the enclosing transact once
// the cascade settles. Outside a cascade (construction-time fan-out before any
// sink is attached) there's nothing to collect against, so rethrow inline.
function _notify(sink, fn){
  try { fn(sink) }
  catch (e) { if (_cascading) (_errors ??= []).push(e); else throw e }
}

// Operator dispatch table populated by index.ts at module load. Stored on a
// shared object so that adding an operator is a one-line registration rather
// than a switch in ViewProxy.apply.
/**
 * Operator dispatch table: maps an operator name to a factory that picks the
 * implementation class by argument shape. Populated by the default `data`
 * entry (and `data/full`) on import; the `data/lean` entry leaves it empty.
 * Register onto it directly only if you import `data/lean` and want a
 * hand-picked subset of operators: `Operators['filter'] = () => FilterValue`.
 */
export const Operators: Record<string, (...args: any[]) => any> = {}

/**
 * Wrap a value or collection in a reactive `ViewProxy`.
 *
 * Read the raw value with `proxy[value]` (the {@link value} symbol). Mutate by
 * assignment — `proxy.foo = 1`, `proxy[0].done = true`, `delete proxy[1]`,
 * `proxy[value] = next` — including nested paths; the right update cascade
 * fires automatically. Derive reactive views with chainable operators
 * (`filter`, `between`, `map`, `length`, `sum`, …), which are registered when
 * you import from `data` or `data/full`.
 *
 * @example
 * import { $, value } from 'data'
 * const rows = $([{ n: 1 }, { n: 5 }, { n: 9 }])
 * const big  = rows.filter(d => d.n > 3).length()
 * big[value]      // 2
 * rows[0].n = 10  // views update incrementally
 */
export const $ = <T>(v: T) => new ViewProxy(View.value(v)) as Data<T>
export default $
// Overridable for deterministic IDs in tests — see core.test.ts:7.
$.random = (o) => crypto.randomUUID() as string | number

// Internal hooks for the optional devtools entrypoint (see devtools/walk.ts).
// _devtoolsRoots: every root view is registered here on construction; held
// via WeakRef so unreachable roots can be GC'd. Iteration prunes dead refs
// in the same lazy pattern as View.sinks. _devtoolsInternalRoots: roots the
// devtools layer creates for its own state (e.g. panel proxy state); the
// panel filters these out of the user-facing graph view.
export const _devtoolsRoots = new Set<WeakRef<View>>()
export const _devtoolsInternalRoots = new WeakSet<View>()

// Operator dedup: if a sink with the same class + matching args is already
// attached to this source, reuse it instead of building a parallel pipeline.
// Only operators that implement `matches()` participate; everything else gets
// a fresh instance per call. Reusing matters most for `between`/`sort` where
// the same brush bound may be subscribed to from multiple chart components.
/**
 * Low-level escape hatch for building a derived view from a custom `Operator`
 * subclass without going through the named dispatch table — `createOperator(src,
 * MyOperatorClass, ...args)`. Most code should use the chainable operators
 * (`src.filter(...)`) instead; reach for this only when authoring a new
 * operator or wiring one that isn't registered. See operators/README.md.
 */
export function createOperator(source, OperatorClass, ...args) {
  const p = source[view]
  // some_sink returns whatever the predicate returns, so the predicate has
  // to yield the sink itself (not a boolean) for the dedup branch to find it.
  let op = p.some_sink(sink =>
    sink instanceof OperatorClass && sink.matches?.(...args) ? sink : undefined)
  if (!op) {
    op = new OperatorClass(p, ...args)
    p.sinks.add(new WeakRef(op))
  }
  return new ViewProxy(op.view)
}

type Prettify<T> = { [K in keyof T]: T[K] } & {};
type RowOf<T> = T extends Record<any, infer R> ? R : never
type ChangeRecord = { type: 'update' | 'insert' | 'remove', key: string[], value: any, at?: any }
type Data<T = any> = { [k in keyof T]: Data<T[k]> } & {
  [value]?: T;
  /**
   * Subscribe to this view. Three forms:
   *
   * - `connect([])` — pushes each change record `{ type, key, value, at? }` into
   *   the array and returns it. Best for tests and seeing what flows through.
   * - `connect(anchor, 'prop')` — mirrors the current value onto `anchor.prop`
   *   (e.g. `connect(el, 'textContent')`); returns `anchor`.
   * - `connect(anchor, fn)` — calls `fn(change)` on every event. `anchor` is the
   *   lifetime handle: sinks are held weakly, so the subscription lives only as
   *   long as `anchor` is reachable.
   *
   * There is **no single-argument `connect(fn)` form** — a lone function is
   * attached as a raw sink with no initial emit and throws on the first insert.
   * Use the two-argument `connect(anchor, fn)`.
   *
   * @example
   * const events = rows.filter('done', false).length().connect([])
   * count.connect(document.body, 'textContent')
   * rows.connect(controller, change => redraw())
   */
  connect<A extends any[]>(events: A): A;
  connect<O extends object>(anchor: O, prop: string): O;
  connect<O extends object>(anchor: O, fn: (change: ChangeRecord) => void): O;
  /**
   * @deprecated `connect(fn)` (a lone function) is **not** a supported form — it
   * attaches with no initial emit and throws on the first insert. Use the
   * two-argument `connect(anchor, fn)` instead.
   */
  connect(fn: (change: ChangeRecord) => void): never;
  raf(): ((value: T) => void) & { flush(): void }
  first(): Data<RowOf<T>>
  last(): Data<RowOf<T>>
  update(value: T): undefined
  update(value, key: string[]): undefined
  insert(value: RowOf<T>): undefined
  insert(value, key: string[]): undefined
  remove(key?: string[]): undefined
  /**
   * Rows matching a predicate. Four shapes: a `(row, key) => boolean` function,
   * a `key, value` pair, a `string[]` path + value, or a partial-shape object.
   * The predicate is captured once — it re-runs when a row mutates, not when
   * outside state changes; for a reactive predicate derive a view and chain
   * `between`/`intersect`.
   * @example rows.filter(d => d.active)   //  rows.filter('done', false)   //  rows.filter({ done: false })
   */
  filter(arg: object): Data<T>
  filter(key: string, value: any): Data<T>
  filter(fn: (row: RowOf<T>) => boolean): Data<T>
  /**
   * Rows whose `key` column falls within `[lo, hi]` (sort-indexed). Pass
   * ViewProxy bounds for a reactive range (a moving brush); plain numbers are
   * static. For a single moving threshold prefer `gt`/`lt`/`gte`/`lte`.
   * @example trades.between('pnl', [-1e6, 1e6])
   */
  between(key: string, [lo, hi]: [number, number]): Data<T>
  /**
   * Whole-value transform — maps the entire snapshot, rebuilding on change.
   * @example count.to(n => n * 2)
   */
  to<R>(fn: (value: T) => R): Data<R>
  /**
   * Per-row transform; each row maps independently (only the changed row re-runs).
   * @example rows.map(r => r.qty * r.price)
   */
  map<R>(fn: (row: RowOf<T>) => R): Data<Record<string, R>>
  /**
   * Row count (`length()`), or grouped counts (`length(fn)`). Grouped counts
   * store each bucket as `{ value: count }` — read a count via
   * `counts[key].value`, **not** `counts[key]`. Emptied buckets persist at
   * `{ value: 0 }` (fixed-keyspace histograms); use `group` for enter/leave.
   * @example rows.length()   //  rows.length(r => r.region) → { east: { value: 4 }, … }
   */
  length(): Data<number>
  length<R>(fn: (row: RowOf<T>) => R): Data<Record<R, number>>
  /**
   * Scalar aggregate over a column (or row values if `col` omitted). `sum`/`avg`
   * are O(1) per change; `max`/`min` recompute O(n). Empty set → `undefined`.
   * @example orders.sum('amount')   //  orders.avg('amount')
   */
  sum(col?: string): Data<number>
  avg(col?: string): Data<number>
  max(col?: string): Data<any>
  min(col?: string): Data<any>
  /**
   * Scalar boolean — does any (`some`) / every (`every`) row match the predicate.
   * @example alerts.some(a => a.level >= 3)
   */
  some(fn: (row: RowOf<T>) => boolean): Data<boolean>
  every(fn: (row: RowOf<T>) => boolean): Data<boolean>
  /**
   * Passthrough side effect. A 1+-arg `fn(change)` fires once per row with a
   * cloned change record; a 0-arg `fn()` fires once per emit (no clone) — for
   * cheap "re-read and redraw" callbacks.
   * @example view.tap(() => redraw())
   */
  tap(fn: (change: ChangeRecord) => void): Data<T>
  /**
   * First-seen unique rows, by an optional projection.
   * @example trades.distinct(t => t.symbol)
   */
  distinct<K = RowOf<T>>(fn?: (row: RowOf<T>) => K): Data<RowOf<T>[]>
  /**
   * Fold. `reduce(fn, init)` is the general (rebuild-on-change) form; the 3-arg
   * `reduce(add, remove, init)` threads inserts/removes through in O(Δ).
   * @example rows.reduce((acc, r) => acc + r.n, 0)
   */
  reduce<R>(fn: (acc: R, row: RowOf<T>, key: string) => R, init: R): Data<R>
  /**
   * Rows present in ANY source (value taken from the first source containing it).
   * @example a.union(b, c)
   */
  union(...sources: Data[]): Data<T>
  /**
   * Rows in this view but not in `other`.
   * @example all.except(archived)
   */
  except(other: Data): Data<T>
  /** Current `Object.keys` as a reactive array. */
  keys(): Data<string[]>
  /** Current `Object.values` as a reactive array. */
  values(): Data<RowOf<T>[]>
  /** Array order flipped. */
  reverse(): Data<RowOf<T>[]>
  /**
   * Descending sort (`za`) by `column`, optionally windowed to the top `max` —
   * a bounded top-K, cheaper than `za(col).limit(n)`. `az` is ascending;
   * `top`/`limit` window without re-sorting.
   * @example trades.za('pnl', 50)   //  rows.az('name')
   */
  za(column: string, max?: number): Data<T>
  za(max?: number): Data<T>
  az(column: string, max?: number): Data<T>
  az(max?: number): Data<T>
  top(max?: number): Data<T>
  limit(max: number): Data<T>
  /**
   * Rows present in ALL source views — set intersection (one bitmask bit per row,
   * O(1) per membership flip). Tracks reactive sources live.
   * @example a.intersect(b, c)
   */
  intersect(...sources: Data[]): Data<T>
  /**
   * Rows nested under a computed key. Prunes emptied groups (enter/leave
   * semantics) — use `length(fn)` when you want zero-count buckets to persist.
   * @example sales.group(s => s.region)
   */
  group<R>(fn: (value: RowOf<T>) => R): Data<Record<R, RowOf<T>>>
}

// Value is the source-of-truth node. It owns the underlying data (held on
// `this.view.value`) and exposes the per-verb mutation methods: every change
// to the data goes through one of these methods, which then fan out to any
// downstream Views/Sinks.
//
// Method-name legend (see CLAUDE.md / .claude/architecture.md):
//   X / B   — root-level vs branch (with key context)
//   U/I/R   — update / insert / remove
//   0/1/2   — depth of the key path (0=direct, 1=single name, 2=full path)
//   A suffix (BR1A/BI0A) — array-aware variant carrying suffix-shift semantics
export class Value {
  constructor(){
    this.view = new View(this)
  }

  // Entry points from ViewProxy.set / .insert(...) / deleteProperty. They
  // dispatch on key-path length to the correct depth-suffixed verb. Setting a
  // proxy to another proxy is forbidden here because the resulting cycle is
  // ambiguous (copy or link?) — the caller must use a linked value instead
  // (see LinkedView).
  update(value, key) {
    if (value instanceof ViewProxy) throw new Error('cannot set value to another data, use a linked value instead')
    transact(() =>
      key.length === 0 ? this.XU0(value)
    : key.length === 1 ? this.BU1([key[0], value])
                       : this.BU2([key, value]))
  }

  insert(value, key, at){
    if (value instanceof ViewProxy) throw new Error('cannot set value to another data, use a linked value instead')
    // `at` is normalized to a string so downstream code can use `name in obj`
    // checks uniformly (numeric keys on plain objects coerce to strings anyway).
    at = at === undefined ? at : `${at}`
    transact(() =>
      key.length === 0 ? this.BI0([at, value])
                       : this.BI2([key, value, at]))
  }

  remove(key){
    transact(() =>
      key.length === 0 ? this.XR0()
    : key.length === 1 ? this.BR1([key[0]])
                       : this.BR2([key]))
  }

  // Idempotent: a Value already at undefined emits nothing. Returns false so
  // callers can short-circuit when nothing happened (used by Sink chains that
  // skip propagation on no-ops).
  XR0() {
    if (this.view.value === undefined) return false
    const value = this.view.value
    this.view.value = undefined
    this.view.XR0(value)
  }

  // BR1A: array-aware remove-at-name. Each name is treated as a positional
  // index; surviving rows shift down. The downstream BR1 carries the original
  // (pre-shift) name so sinks can identify which element left, but the
  // underlying array is already spliced by the time the View dispatches.
  //
  // Splice only if this operator owns its view.value — when the value is a
  // reference shared with the upstream (the common case for pass-through
  // operators like tap, which point view.value at p.value via XU0),
  // upstream has already spliced the array and re-splicing here shifts
  // every survivor one position further than intended.
  BR1A(R1){
    const owns = this.view.value !== this.p?.value
    const NR1 = []
    for (let i = 0; i < R1.length; i++) {
      const name = R1[i]
      const value = this.view.value?.[name]
      if (owns) this.view.value.splice(name, 1)
      NR1.push(name)
      NR1.push(value)
    }
    this.view.BR1(NR1)
  }

  // BR1: object remove-at-name. Routes to BR1A when the underlying value is
  // an array so we get splice semantics and downstream V1 propagation. Skips
  // already-undefined slots so a remove is a true no-op rather than emitting
  // a phantom event.
  BR1(R1){
    if (isArray(this.view.value)) return this.BR1A(R1)
    const NR1 = []
    for (let i = 0; i < R1.length; i++) {
      const name = R1[i]
      const value = this.view.value?.[name]
      if (value === undefined) continue
      delete this.view.value[name]
      NR1.push(name)
      NR1.push(value)
    }
    this.view.BR1(NR1)
  }

  BR2(R2){
    const NR2 = []
    loop1: for (let i = 0; i < R2.length; i++) {
      const key = R2[i]
      const [last, ...path] = key.slice().reverse()
      let vo = this.view.value
      if (typeof vo !== 'object') return
      while (path.length) {
        const n = path.pop()
        if (typeof vo !== 'object') continue loop1
        vo = vo[n]
      }
      if (vo[last] === undefined) continue loop1
      const value = vo[last]
      if (isArray(vo)) {
        vo.splice(last, 1)
      } else {
        delete vo[last]
      }
      NR2.push(key, value)
    }
    this.view.BR2(NR2)
  }

  // Reference-equality short-circuit: if the caller passed the same object we
  // already hold, skip the entire dispatch. Operators that mutate in place
  // and re-emit (e.g. between, sort) rely on this — they swap the live
  // reference for a copy first to avoid this guard suppressing real changes.
  XU0(value) {
    if (this.view.value === value) return
    this.view.value = value
    this.view.XU0()
  }

  // BU1 doubles as an upsert: keys whose previous value was undefined become
  // BI0 events, keys with an existing value become BU1, and identical values
  // are dropped entirely. Splitting the two avoids forcing every BU1 sink to
  // re-derive whether the row is new or a refresh.
  //
  // One refinement for ARRAY sources: writing a value into a slot that is
  // currently `undefined` is only a genuine INSERT if the index is at/beyond
  // the current length (an append/sparse-extend). An IN-BOUNDS undefined slot
  // is a positional HOLE, and filling it is length-stable — survivors don't
  // shift — so it must route through BF0, not BI0/BI0A (which splice-shift and
  // would grow a phantom ghost row in every downstream positional operator).
  // This is the root-array counterpart of the BH1/BF0 protocol the sparse
  // producers already use. For OBJECT sources a previously-undefined key is
  // always a fresh insert (no positions to shift) — load-bearing for the
  // upsert-as-leave/re-enter idiom — so the BF0 routing is array-only.
  BU1(U1) {
    const NU1 = []
    const NI0 = []
    const NF0 = []
    if (typeof this.view.value !== 'object' || this.view.value === null) this.view.value = {}
    const arr = isArray(this.view.value)
    for (let i = 0; i < U1.length; i++) {
      const name = U1[i++]
      const value = U1[i]
      const old = this.view.value?.[name]
      if (old === value) continue
      if (old !== undefined)                              NU1.push(name, value)
      else if (arr && +name < this.view.value.length)     NF0.push(name, value)
      else                                                NI0.push(name, value)
      this.view.value[name] = value
    }
    this.view.BU1(NU1)
    this.view.BI0(NI0)
    this.view.BF0(NF0)
  }

  // Deep update along a key path. We auto-create intermediate objects so a
  // user can write `proxy.a.b.c = 1` without first ensuring `a.b` exists; the
  // alternative would force callers to reproduce immutable-update boilerplate
  // for what's logically one assignment. `key.slice().reverse()` then `pop()`
  // is just a cheap way to walk the path forward without mutating the caller's
  // key array.
  BU2(U2){
    if (typeof this.view.value !== 'object' || this.view.value === null) this.view.value = {}
    // Build a filtered NU2 of pairs that actually changed something, exactly
    // like BU1 above. The old code skipped the no-op WRITE (continue) but still
    // dispatched the original U2, so a no-op deep write (`s.a.b = 1` when
    // already 1) emitted a phantom update — change-stream consumers saw an
    // update for nothing, and every BU2-rebuild operator (e.g. 3-arg reduce)
    // re-folded O(N) for a write that changed nothing.
    const NU2 = []
    for (let i = 0; i < U2.length; i++) {
      const key = U2[i++]
      const value = U2[i]
      const [last, ...path] = key.slice().reverse()
      let vo = this.view.value
      while (path.length) {
        const n = path.pop()
        vo = typeof vo[n] === 'object' ? vo[n] : (vo[n] = {})
      }
      if (vo[last] === value) continue
      vo[last] = value
      NU2.push(key, value)
    }
    this.view.BU2(NU2)
  }

  // BI0: object insert. If `at` is omitted we mint a random key — this lets
  // `arr.insert(row)` work without the caller managing IDs. Routes to BI0A
  // for arrays so insert-at-position carries shift semantics.
  BI0(I0){
    if (isArray(this.view.value)) return this.BI0A(I0)
    if (typeof this.view.value !== 'object' || this.view.value === null) this.view.value = {}
    // Filter and classify like BU1 (just above): a no-op insert (same value at
    // an existing key) emits NOTHING, and an insert at an EXISTING key with a
    // different value is an overwrite -> BU1 (update), not a phantom BI0. Only
    // a genuinely new key fans out as BI0. Incremental counting/aggregating
    // sinks trust the delta stream ("no phantom events" is a core invariant —
    // DECISIONS C8), so dispatching the raw I0 used to drift length()/sum()
    // permanently and feed connect([]) duplicate insert records no fold could
    // reconcile.
    const NI0 = []
    const NU1 = []
    for (let i = 0; i < I0.length; i++) {
      const at = I0[i++] ??= ''+$.random(this.view.value)
      const value = I0[i]
      const old = this.view.value?.[at]
      if (old === value) continue
      old === undefined ? NI0.push(at, value) : NU1.push(at, value)
      this.view.value[at] = value
    }
    this.view.BU1(NU1)
    this.view.BI0(NI0)
  }

  // BI0A: array insert-at-position. Undefined `at` means "push to end" and
  // we record the resulting index back into I0 so downstream sinks know
  // where the row landed. Defined `at` means splice — surviving elements at
  // that position and beyond shift up.
  //
  // Splice only if this operator owns its view.value (same shared-ref
  // guard as BR1A / BMV1 — see comment on BR1A).
  BI0A(I0){
    const owns = this.view.value !== this.p?.value
    for (let i = 0; i < I0.length; i+=2) {
      const at = I0[i]
      const value = I0[i+1]
      if (at === undefined) {
        // For push we still need to record the resulting index; for the
        // pass-through case the upstream has already pushed, so the
        // post-push length minus 1 is the same index either way.
        if (owns) I0[i] = ''+(this.view.value.push(value)-1)
        else      I0[i] = ''+(this.view.value.length-1)
      } else if (owns) {
        this.view.value.splice(at, 0, value)
      }
    }
    this.view.BI0(I0)
  }

  // Move-at-depth-1 verb. Each [from, to] pair moves the element at
  // index `from` to index `to`; rows in between rotate by one. Carried as a
  // single 'move' for change-stream consumers that want move semantics rather
  // than N value-update events. (DOMSink itself treats a move as a no-op: it
  // renders rows index-keyed, so Value.BMV1's positional child refresh below
  // already updates each slot's content — see render/index.ts BMV1.)
  //
  // Splice only if this operator owns its view.value (same shared-ref
  // guard as BR1A / BI0A — see comment on BR1A).
  BMV1(M1) {
    if (this.view.value !== this.p?.value) {
      for (let i = 0; i < M1.length; i += 2) {
        const from = +M1[i]
        const to = +M1[i + 1]
        const [v] = this.view.value.splice(from, 1)
        this.view.value.splice(to, 0, v)
      }
    }
    this.view.BMV1(M1)
  }

  BI2(I2){
    if (typeof this.view.value !== 'object' || this.view.value === null) this.view.value = {}
    for (let i = 0; i < I2.length; i++) {
      const key = I2[i++]
      const value = I2[i++]
      const path = key.slice().reverse()
      let vo = this.view.value

      while (path.length) {
        const n = path.pop()
        vo = typeof vo[n] === 'object' ? vo[n] : (vo[n] = {})
      }

      if (isArray(vo)) {
        if (I2[i] === undefined)
          I2[i] ??= ''+(vo.push(value)-1)
        else
          vo.splice(I2[i], 0, value)
      } else {
        const at = I2[i] ??= ''+$.random(vo)
        vo[at] = value
      }
    }
    this.view.BI2(I2)
  }
}

// Operator inherits Value's mutation surface so it can both *receive* events
// from its source (as a sink) and *emit* events to its own subscribers (via
// `this.view`). Most operators only override the verbs they care about; the
// rest fall through to Value's defaults and become pass-through.
export class Operator extends Value {}

// View is the read side: it holds the live value, tracks named child views
// (created lazily when callers access proxy.foo), and broadcasts every verb to
// its sink set. Sinks are held by WeakRef so a downstream operator that loses
// its only strong reference unsubscribes silently — tests must keep
// `connect([])`'s return alive in a local var to observe events.
export class View {
  constructor(res){
    // Initialise *all* fields here, including ones only used by child views
    // (`p`, `name`) and the data slot (`value`). Without this, root views
    // and child views end up with different V8 hidden classes because the
    // child-only fields are assigned post-construction in `View.child`,
    // making every method on `View` (`XU0`, `BU1`, `BR1`, etc.) see at least
    // two shapes at its call sites — polymorphic ICs, no inlining.
    this.res = res
    this.key = []
    this.sinks = new Set
    this.views = new Map
    this.p = undefined
    this.name = undefined
    this.value = undefined
  }

  // Child views are produced lazily when ViewProxy.get sees a property access.
  // A child stays attached to its parent's key (so writes route correctly) but
  // owns its own value snapshot — kept in sync by the parent's dispatch logic
  // calling child.XU0() / XR0() on every notification that crosses its key.
  static child(p, name){
    const view = new View(p.res)
    view.p = p
    view.key = [...p.key, name]
    view.name = name
    view.XU0(p.value?.[name])
    return view
  }

  // Two distinct entry points unified behind one factory: $(plain) builds a
  // fresh Value-backed View; $(otherProxy) builds a LinkedView that forwards
  // every read/write to the linked source. The branch matters for set/get
  // semantics — see LinkedView below.
  static value(value) {
    if (value instanceof ViewProxy) {
      return new LinkedView(value)
    } else {
      const res = new Value
      res.XU0(value)
      _devtoolsRoots.add(new WeakRef(res.view))
      return res.view
    }
  }

  // XR0 cascades a clear: every named child loses its value too, but only if
  // the corresponding key actually disappeared (the second half of the OR
  // covers the case where a child is currently undefined and stays that way —
  // we still want its sinks to know).
  XR0(value) {
    if (this.p) this.value = undefined
    this.each((name, child) => {
      if (child.value !== value?.[name] || child.value !== undefined)
        child.XR0(value?.[name])
    })
    this.sink(sink => sink.XR0(value, this))
  }

  // Splice-aware fan-out for object removes. For object sources we route each
  // R1 to the named child as an XR0 (a single key disappeared, named children
  // at other keys are unaffected). For array sources we instead refresh every
  // child whose index ≥ the smallest removed index — those rows just got
  // shifted to a different value. Sinks then see either the array-aware
  // BR1A (with shift semantics) or BR1 (treat as named delete) depending on
  // what they implement; the prototype check stops a sink that inherits the
  // default Value.BR1A from masquerading as array-aware.
  BR1(R1) {
    if (!R1.length) return
    const arr = isArray(this.value)
    if (!arr) {
      for (let i = 0; i < R1.length; i+=2)
        this.get_named(R1[i])?.XR0(R1[i+1])
    } else if (this.views.size) {
      // Names are strings by contract; coerce to numbers before taking the min,
      // or `'10' < '9'` (lexicographic) picks the wrong start index and V1
      // skips refreshing a held child at the true smallest shifted index.
      let offset = Infinity
      for (let i = 0; i < R1.length; i+=2) {
        const at = +R1[i]
        if (at < offset) offset = at
        if (!offset) break
      }
      this.V1(offset)
    }
    this.fanout(arr ? 'BR1A' : undefined, 'BR1', R1)
  }

  BR2(R2){
    for (let i = 0; i < R2.length; i++) {
      const [name, ...rest] = R2[i++]
      const value = R2[i]
      rest.length === 1
        ? this.get_named(name)?.BR1([rest[0], value])
        : this.get_named(name)?.BR2([rest, value])
    }
    this.sink(sink => sink.BR2(R2, this))
  }

  // Whole-value replacement. For child views this means: any name still
  // present in the new value gets a refresh (XU0), any name that vanished
  // gets a clear (XR0). The `if (this.p)` re-reads our slice from the parent
  // because XU0 on the parent already mutated `p.value`; we just mirror it.
  XU0() {
    if (this.p) this.value = this.p.value?.[this.name]
    this.each((name, child) => {
      if (this.value?.[name] !== undefined)
        child.XU0()
      else {
        if (child.value !== undefined)
          child.XR0(child.value)
      }
    })
    this.sink(sink => sink.XU0(this.value, this))
  }

  BU1(U1) {
    if (!U1.length) return
    if (this.p) this.value = this.p.value?.[this.name]
    // Each named child whose key got an update needs its own XU0 so its child
    // proxies can refresh transitively. Sinks then receive the batched BU1.
    for (let i = 0; i < U1.length; i++) this.get_named(U1[i++])?.XU0()
    this.sink(sink => sink.BU1(U1, this))
  }

  BU2(U2){
    if (!U2.length) return
    if (this.p) this.value = this.p.value?.[this.name]
    for (let i = 0; i < U2.length; i++) {
      const [name, ...rest] = U2[i++]
      const value = U2[i]
      rest.length === 1
        ? this.get_named(name)?.BU1([rest[0], value])
        : this.get_named(name)?.BU2([rest, value])
    }
    this.sink(sink => sink.BU2(U2, this))
  }

  BI0(I0) {
    if (!I0.length) return
    if (this.p) this.value = this.p.value?.[this.name]
    if (isArray(this.value)) return this.BI0A(I0)
    for (let i = 0; i < I0.length; i++) this.get_named(I0[i++])?.XU0()
    this.sink(sink => sink.BI0(I0, this))
  }

  // Array insert: every existing index ≥ the smallest insert position has
  // shifted up, so refresh those children once before fanning out to sinks.
  // The prototype check guards against a sink that only inherits the default
  // BI0A from Value being treated as array-aware.
  BI0A(I0){
    if (this.views.size) {
      // Coerce to numbers before the min — see the matching note in BR1.
      let offset = Infinity
      for (let i = 0; i < I0.length; i+=2) {
        const at = +I0[i]
        if (at < offset) offset = at
      }
      this.V1(offset)
    }
    this.fanout('BI0A', 'BI0', I0)
  }

  // Hole remove / hole fill — the positional-stable counterparts of BR1A/BI0A.
  // A sparse producer (between/intersect/union/except over an ARRAY) marks an
  // excluded slot `undefined` WITHOUT splicing: the array length is unchanged
  // and survivors do NOT shift. BR1A/BI0A would wrongly splice downstream
  // (ghost rows / dropped survivors — the array-positional desync). Instead the
  // producer emits BH1/BF0: we refresh only the touched children (no V1 shift)
  // and route to a sink's BH1/BF0 if it has one. A sink WITHOUT them (an
  // aggregate, say — position-agnostic) falls back to BR1/BI0, which is correct:
  // it just drops/adds the row. Operator positional sinks (RowOperator, a
  // downstream sparse op, sort) implement BH1/BF0 to mirror the hole instead
  // of shifting. The DOMSink ALSO implements them (index-keyed _remove_at/
  // _create_at, see render/index.ts) so a sparse producer can be bound straight
  // to a row template without phantom holes — the V1 content refresh we fire
  // here (get_named(k).XU0()) sets the touched child's value BEFORE the sink's
  // BH1/BF0 runs, and because the DOMSink keys nodes by index that refresh is
  // not double-applied (closed ISSUES.md C4). BH1/BF0 live on View only — never
  // on Value — so a plain Value sink never inherits one and always takes the
  // BR1/BI0 fallback.
  BH1(R1) {
    if (!R1.length) return
    for (let i = 0; i < R1.length; i += 2) this.get_named(R1[i])?.XU0()
    this.fanout('BH1', 'BR1', R1)
  }

  BF0(I0) {
    if (!I0.length) return
    for (let i = 0; i < I0.length; i += 2) this.get_named(I0[i])?.XU0()
    this.fanout('BF0', 'BI0', I0)
  }

  BI2(I2){
    if (this.p) this.value = this.p.value?.[this.name]
    for (let i = 0; i < I2.length;) {
      const [name, ...rest] = I2[i++]
      const value = I2[i++]
      const at = I2[i++]
      rest.length
        ? this.get_named(name)?.BI2([rest, value, at])
        : this.get_named(name)?.BI0([at, value])
    }
    this.sink(sink => sink.BI2(I2, this))
  }

  // Apply a batched [from, to] rotation to named children whose key falls
  // inside any affected range, refreshing each from the (already moved)
  // parent value. Sinks that don't implement BMV1 fall back to BU1 over the
  // affected positions so they refresh content reactively.
  BMV1(M1) {
    if (!M1.length) return
    if (this.p) this.value = this.p.value?.[this.name]
    if (this.views.size) {
      let lo = Infinity, hi = -Infinity
      for (let i = 0; i < M1.length; i += 2) {
        const a = +M1[i], b = +M1[i + 1]
        if (a < lo) lo = a; if (b < lo) lo = b
        if (a > hi) hi = a; if (b > hi) hi = b
      }
      for (let j = lo; j <= hi; j++) {
        const child = this.get_named(`${j}`)
        if (child && child.value !== this.value[j]) child.XU0()
      }
    }
    for (const x of [...this.sinks]) { // snapshot — see sink()
      const sink = x.deref()
      if (!sink) { this.sinks.delete(x); continue }
      try {
        if (sink.BMV1 && sink.BMV1 !== Value.prototype.BMV1) {
          sink.BMV1(M1, this)
        } else {
          // fallback: emit BU1 for the affected range
          const NU1 = []
          for (let i = 0; i < M1.length; i += 2) {
            const a = +M1[i], b = +M1[i + 1]
            const lo = a < b ? a : b
            const hi = a < b ? b : a
            for (let j = lo; j <= hi; j++) NU1.push('' + j, this.value[j])
          }
          if (NU1.length) sink.BU1(NU1, this)
        }
      } catch (e) { if (_cascading) (_errors ??= []).push(e); else throw e }
    }
  }

  // After an array splice every index from `offset` onward may now hold a
  // different element. Walk all named children in that range and refresh
  // those whose snapshot diverged. Off-by-one (`length+1`) intentional: a
  // child created at the now-empty tail needs an XU0 to clear itself.
  V1(offset){
    for (let i = offset; i < this.value.length+1; i++) {
      const child = this.get_named(`${i}`)
      if (child && child.value !== this.value[i]) child.XU0()
    }
  }

  // Iteration helpers all double as sweepers: a WeakRef whose target was GC'd
  // is removed from the collection on the fly, so dead subscribers don't
  // accumulate. `sink(fn)` is the standard fan-out; `some_sink(fn)` is the
  // operator-dedup helper used by createOperator and ViewProxy.apply.
  some_sink(fn) {
    let n
    for (const x of this.sinks) {
      const sink = x.deref?.()
      if (!sink) { this.sinks.delete(x); continue }
      if (n = fn(sink)) return n
    }
  }

  // Snapshot the sink set before fanning out: a sink that SUBSCRIBES during this
  // emit (a connect() inside another sink's callback) is seeded with the
  // post-commit snapshot at subscription time and must NOT also receive the
  // in-flight delta — a live Set iterator visits entries added mid-loop, which
  // delivered the current change twice (duplicating it for fold consumers). The
  // dead-WeakRef sweep still mutates the live set. `sinks.size` fast-path avoids
  // the array alloc when there's nothing (or nothing yet) to notify.
  sink(fn){
    if (!this.sinks.size) return
    for (const x of [...this.sinks]) {
      const sink = x.deref?.()
      if (!sink) { this.sinks.delete(x); continue }
      _notify(sink, fn)
    }
  }

  // Array-aware fan-out: dispatch `verb` to each sink that has its OWN
  // implementation, else fall back to `fallback`. The four array-positional
  // dispatch sites (BR1→BR1A, BI0A, BH1, BF0) collapse onto this. "Has its own"
  // means: for BR1A/BI0A — distinct from Value.prototype's default (Value
  // defines those, so a bare Value sink must NOT masquerade as array-aware);
  // for BH1/BF0 — merely present (Value defines neither, so `proto` is undefined
  // and any method counts). A sink without `verb` takes `fallback` (BR1/BI0),
  // which is correct for position-agnostic sinks (aggregates, length). Pass
  // `verb = undefined` to force the fallback (object BR1 — no array variant).
  // `verb`/`fallback` are constant string literals at each call site, so V8
  // specializes `sink[verb]` back to a fixed-offset access after inlining.
  fanout(verb, fallback, payload){
    if (!this.sinks.size) return
    const proto = verb && Value.prototype[verb]
    for (const x of [...this.sinks]) { // snapshot — see sink()
      const sink = x.deref?.()
      if (!sink) { this.sinks.delete(x); continue }
      const m = verb && sink[verb]
      // exception-isolated like sink() — inlined try/catch to avoid a closure
      // per sink on this hot path.
      try {
        m && (proto === undefined || m !== proto)
          ? m.call(sink, payload, this)
          : sink[fallback](payload, this)
      } catch (e) { if (_cascading) (_errors ??= []).push(e); else throw e }
    }
  }

  each(fn){
    for (const [name, ref] of this.views) {
      const res = ref.deref?.()
      if (!res) { this.views.delete(name); continue }
      fn(name, res)
    }
  }

  get_or_create_named(name){
    return this.views.get(name)?.deref?.() ?? create(
      this.views,
      name,
      View.child(this, name)
    )
  }

  get_named(name){
    const res = this.views.get(name)?.deref?.()
    if (!res) this.views.delete(name)
    return res
  }

  disconnect(sink){
    for (const x of this.sinks) {
      const s = x.deref?.()
      if (s === sink) { this.sinks.delete(x); break }
      if (!s) { this.sinks.delete(x); continue }
    }
  }

  connect(sink){
    this.sinks.add(new WeakRef(sink))
  }
}

// Marker class. Anything attached via `.connect(sink)` is expected to be a
// Sink (or compatible); the marker exists so user-built sinks can opt in by
// extending it without having to re-derive the protocol surface from scratch.
export class Sink {}

// LinkedView lets one ViewProxy alias another: `a[value] = b` makes `a`
// forward every read and write to `b`'s underlying Value. Necessary because
// without it, `a[value] = otherProxy` would either copy the snapshot (losing
// reactivity) or throw (unfriendly). `update` with an empty key swaps the
// source target itself; with a non-empty key it forwards the write into the
// linked tree. Re-connecting on swap ensures we stop receiving events from
// the old source.
class LinkedView extends View {
  constructor(p){
    super()
    this.src = p[Symbols.view]
    this.update(this.src)
  }

  update(value, key = []){
    if (key.length) {
      return this.src.res.update(value, key)
    }

    if (value instanceof ViewProxy) value = value[Symbols.view]
    if (!(value instanceof View))
      throw new Error('cannot set linked value to non-reactive source')

    this.src.disconnect(this)
    this.src = value
    this.src.connect(this)
    this.XU0()
  }
  insert(...args){ return this.src.res.insert(...args) }
  remove(...args){ return this.src.res.remove(...args) }
  // `value` and `res` are read-through to the source — the LinkedView itself
  // never holds data, it's a transparent forwarder.
  get value(){ return this.src.value }
  set value(v){ /* read-through getter; constructor's init falls here */ }
  get res(){ return this }
  set res(v){ }
}

// Pair/triple iterators over flat protocol arrays: most BU1/BR1/BI0 payloads
// are flat `[name, value, name, value, ...]` for compactness (avoids the
// allocation overhead of `[[name, value], ...]` on every event), so iter2 /
// iter3 are the canonical readers.
function iter2(arr, fn) {
  for (let i = 0; i < arr.length; i++) fn(arr[i++], arr[i])
}
function iter3(arr, fn) {
  for (let i = 0; i < arr.length; i++) fn(arr[i++], arr[i++], arr[i])
}

// ArrSink is the sink behind `proxy.connect([])` — every notification is
// translated into a `{ type, key, value, at? }` record pushed onto the user's
// array. Used heavily in tests: capture the change stream, then assert it.
class ArrSink {
  constructor(p, arr){
    this.p = p
    this.arr = arr
    // Pin to `arr` like PropSink/FunctionSink: the view holds this sink only via
    // a WeakRef, and `arr` references the sink only one way (sink.arr), so holding
    // the returned array would NOT keep the sink alive. Without this, a consumer
    // that kept only connect([])'s return value could have the sink GC'd and the
    // array silently stop receiving change records.
    const refs = lifetimes.get(arr) ?? new Set
    refs.add(this)
    lifetimes.set(arr, refs)
    this.update([], p.value)
  }
  update = (key, value) => this.arr.push({ type: 'update', key, value: sclone(value) })
  remove = (key, value) => this.arr.push({ type: 'remove', key, value: sclone(value) })
  insert = (key, value, at) => this.arr.push({ type: 'insert', key, value: sclone(value), at })
  XU0(value){ this.update([], value) }
  BU1(U1){ iter2(U1, (name, value) => this.update([name], value)) }
  BU2(U2){ iter2(U2, (key, value) => this.update(key, value)) }
  BI0(I0){ iter2(I0, (at, value) => this.insert([], value, at)) }
  BI2(I0){ iter3(I0, (key, value, at) => this.insert(key, value, at)) }
  XR0(value){ this.remove([], value) }
  BR1(R1){ iter2(R1, (name, value) => this.remove([name], value)) }
  BR2(R2){ iter2(R2, (key, value) => this.remove(key, value)) }
  move = (from, to) => this.arr.push({ type: 'move', from, to })
  BMV1(M1){ iter2(M1, (from, to) => this.move(+from, +to)) }

  R0(value){ this.arr.push({ type: 'remove', key: [], value: sclone(value) }) }
  R1(name, value){ this.arr.push({ type: 'remove', key: [name], value: sclone(value) }) }
  R2(key, value){ this.arr.push({ type: 'remove', key, value: sclone(value) }) }
  U0(value){ this.arr.push({ type: 'update', key: [], value: sclone(value) }) }
  U1(name, value){ this.arr.push({ type: 'update', key: [name], value: sclone(value) }) }
  U2(key, value){ this.arr.push({ type: 'update', key, value: sclone(value) }) }
  I0(value, at){ this.arr.push({ type: 'insert', value: sclone(value), at }) }
  I1(name, value, at){ this.arr.push({ type: 'insert', key: [name], value: sclone(value), at }) }
  I2(key, value, at){ this.arr.push({ type: 'insert', key, value: sclone(value), at }) }
}

// PropSinks would otherwise be eligible for GC the moment connect() returned
// (only WeakRef'd from sinks set, no other reference). lifetimes pins them to
// the host object so they live as long as their target does — this is what
// makes `proxy.connect(obj, 'prop')` actually keep updating `obj.prop` over
// time without the caller having to retain the sink in a local var.
const lifetimes = new WeakMap

// `proxy.connect(obj, 'prop')` mirrors the proxy's value to obj[prop]. Every
// notification (regardless of which verb) collapses to "rewrite the whole
// snapshot" — fine for simple reactive bindings like a span's textContent or
// a UI flag, where granular events would just be more code for the same
// observable result.
class PropSink extends Sink {
  p; obj; prop;
  constructor(p, obj, prop){
    super()
    this.p = p
    this.obj = obj
    this.prop = prop
    this.obj[prop] = p.value
    const refs = lifetimes.get(obj) ?? new Set
    refs.add(this)
    lifetimes.set(obj, refs)
  }
  XU0(value){ this.obj[this.prop] = value }
  XR0(){ this.XU0(this.p.value) }
  BU1(){ this.XU0(this.p.value) }
  BR1(){ this.XU0(this.p.value) }
  BI0(){ this.XU0(this.p.value) }
  BU2(){ this.XU0(this.p.value) }
  BR2(){ this.XU0(this.p.value) }
  BI2(){ this.XU0(this.p.value) }
  BMV1(){ this.XU0(this.p.value) }
}

// `proxy.connect(obj, fn)` calls fn({ type, key, value, at? }) per event —
// same record shape as ArrSink so the two are interchangeable for testing
// and for downstream consumers that want to handle each event explicitly.
class FunctionSink extends Sink {
  constructor(p, obj, fn){
    super()
    this.fn = fn
    // Pin to `obj` exactly like PropSink: the view holds this sink only via a
    // WeakRef, so a caller that kept only connect()'s return value (`obj`) would
    // otherwise have the sink GC'd out from under it and silently stop firing.
    // Holding `obj` keeps the sink alive for as long as the caller cares.
    const refs = lifetimes.get(obj) ?? new Set
    refs.add(this)
    lifetimes.set(obj, refs)
    fn({ type: 'update', key: [], value: sclone(p.value) })
  }
  XU0(value){ this.fn({ type: 'update', key: [], value: sclone(value) }) }
  XR0(value){ this.fn({ type: 'remove', key: [], value: sclone(value) }) }
  BU1(U1){ iter2(U1, (name, value) => this.fn({ type: 'update', key: [name], value: sclone(value) })) }
  BU2(U2){ iter2(U2, (key, value) => this.fn({ type: 'update', key, value: sclone(value) })) }
  BI0(I0){ iter2(I0, (at, value) => this.fn({ type: 'insert', key: [], value: sclone(value), at })) }
  BI2(I2){ iter3(I2, (key, value, at) => this.fn({ type: 'insert', key, value: sclone(value), at })) }
  BR1(R1){ iter2(R1, (name, value) => this.fn({ type: 'remove', key: [name], value: sclone(value) })) }
  BR2(R2){ iter2(R2, (key, value) => this.fn({ type: 'remove', key, value: sclone(value) })) }
  BMV1(M1){ iter2(M1, (from, to) => this.fn({ type: 'move', from: +from, to: +to })) }
}

// ViewProxy is the user-facing handle. Every property access creates (or
// reuses) a child ViewProxy, every assignment routes through Value.update,
// and every method call (`.filter`, `.connect`, `.length` etc.) hits `apply`.
// Wrapping `noop` rather than `{}` is deliberate: a Proxy of a function lets
// us implement `apply` so the proxy is callable, which is what makes
// `proxy.filter(fn)` work as a method invocation.
export class ViewProxy {
  view;
  constructor(view){
    this.view = view
    return new Proxy(noop, this)
  }

  deleteProperty(target, name){
    const { res, key } = this.view
    // `delete proxy[value]` deletes the proxy's own value (key path stays
    // empty); any other delete drills into a child key.
    const path = name === Symbols.value ? key : [...key, ''+name]
    res.remove(path)
    return true
  }

  set(t, name, value){
    const { res, key } = this.view
    const path = name === Symbols.value ? key : [...key, name]
    res.update(value, path)
    return true
  }

  // Special-cased property reads:
  //   Symbol.toPrimitive — used by template literals and arithmetic. `hint`
  //     is "string" | "number" | "default"; truthy hint means string context.
  //   Symbol.iterator    — lets `for (const x of proxy)` walk numeric indices.
  //   Symbols.reactive   — branding so foreign code can detect ViewProxies.
  //   Symbols.view       — internal: the underlying View object.
  //   Symbols.value      — the raw snapshot. Reading proxy.value would create
  //                        a child view named "value" instead — that's the
  //                        canonical gotcha noted in CLAUDE.md.
  get(t, name){
    if (name === Symbol.toPrimitive) return (hint) => hint
      ? this.view.value?.toString()
      : +this.view.value
    if (name === Symbol.iterator) return this.iterator
    if (name === Symbols.reactive) return true
    if (name === Symbols.view) return this.view
    if (name === Symbols.value) return this.view.value
    return new ViewProxy(this.view.get_or_create_named(name))
  }

  // `proxy.filter(fn)` arrives here as: get → child view named "filter" →
  // apply. The child view's `name` tells us which operator to construct.
  // `connect`, `update`, `insert`, `remove` are handled directly without
  // going through the operator dispatch table.
  apply(t, m, args){
    const { p, name: type } = this.view
    if (!p) throw new Error('cannot invoke a root value!')
    // Promise assimilation (`await proxy`, `Promise.resolve(proxy)`,
    // `Promise.all([...,proxy])`) detects a thenable by reading `.then` — a
    // child view, callable like any ViewProxy — and *immediately* calling it
    // with (onFulfilled, onRejected), both functions. A genuine `proxy.then`
    // data access reads the child view but never calls it, so it never lands
    // here. Distinguish purely by the call signature (leading function arg)
    // and resolve with the current snapshot, so `await proxy === proxy[value]`
    // instead of throwing "Unknown operator 'then'". `.then` stays usable as a
    // real key via property access; only *calling* it is the promise probe.
    if (type === 'then' && typeof args[0] === 'function') {
      const [onFulfilled, onRejected] = args
      try { onFulfilled(p.value) }
      catch (e) { if (typeof onRejected === 'function') onRejected(e) }
      return
    }
    if (type === 'connect') return connect(p, ...args)
    if (type === 'raf')     return raf(p)
    // `proxy.patch([name, value, name, value, ...])` applies many child updates
    // as ONE cascade: the backing value is updated for every pair and sinks
    // receive a single batched BU1 (new keys split out as BI0), instead of one
    // dispatch per `proxy[name] = value`. For high-throughput producers that
    // touch thousands of rows per frame (a simulation, a market feed) this
    // collapses the per-row dispatch fan-out to one walk per sink. Writes route
    // through the root resource (`res`), exactly like the single-key setter; on
    // the root receiver the pairs are a flat BU1 batch, on a sub-proxy each
    // pair is rewritten to a deep path so semantics match N assignments at
    // `receiver[name] = value`.
    if (type === 'patch') {
      const { res, key } = p // the receiver's view, not the 'patch' method child
      const pairs = args[0]
      // Wrapped in transact like the single-key setters — patch is a public
      // mutation entry, so a re-entrant patch (from a sink callback) must queue
      // behind the in-flight cascade rather than re-enter it.
      return transact(() => {
        if (!key.length) return res.BU1(pairs)
        const U2 = []
        for (let i = 0; i < pairs.length; i += 2) U2.push([...key, pairs[i]], pairs[i + 1])
        return res.BU2(U2)
      })
    }
    if (type === 'first')   return new ViewProxy(p.get_or_create_named(firstKey(p.value)))
    if (type === 'last')    return new ViewProxy(p.get_or_create_named(lastKey(p.value)))
    // JSON.stringify probes `.toJSON` — a callable child view like any other —
    // and calls it (with the holder's key as the argument). Resolve with the
    // raw snapshot, same spirit as the thenable guard above: serializing a
    // proxy is routine state logging and must not throw. A key literally named
    // 'toJSON' stays readable as data via property access (proxy.toJSON[value]);
    // only *calling* it is the serialization probe.
    if (type === 'toJSON') return p.value
    const OperatorClass = Operators[type]?.(...args)
    if (OperatorClass) {
      // Same dedup logic as createOperator, inline because we already have p.
      // The predicate must return the sink itself (not a boolean) for the
      // dedup branch to find it — some_sink yields whatever the predicate yields.
      let sink = p.some_sink(sink =>
        sink instanceof OperatorClass && sink.matches?.(...args) ? sink : undefined)
      if (!sink) {
        p.sinks.add(new WeakRef(sink = new OperatorClass(p, ...args)))
      }
      return new ViewProxy(sink.view)
    }

    const [value, at] = args
    if (type === 'remove') return this.view.res.remove(p.key)
    if (type === 'update') return this.view.res.update(value, p.key)
    if (type === 'insert') return this.view.res.insert(value, p.key, at)
    // Two distinct failure modes deserve two diagnoses: an EMPTY table means
    // the side-effect registration never ran (the data/lean entry), while a
    // populated table means this particular name isn't an operator (a typo,
    // or calling a data key as a method).
    const registered = Object.keys(Operators)
    throw new Error(`Unknown operator '${type}'. ` + (registered.length === 0
      ? `The dispatch table is empty — likely an import from 'data/lean' (the ` +
        `registration-free core). Chainable operators (.filter, .between, ` +
        `.length, etc.) register when you import from 'data' (the default ` +
        `entry) or 'data/full' (adds JSX). Switch to 'data', or register the ` +
        `operators you need onto the exported 'Operators' table yourself.`
      : `No operator with that name is registered (${registered.length} ` +
        `operators are: ${registered.sort().join(', ')}).`))
  }

  getPrototypeOf(target){
    return ViewProxy.prototype
  }

  // Open-ended counter — relies on the consumer to break out (typically
  // `.slice()` or destructuring with a fixed length). The reactive view
  // doesn't know its own length without resolving `value` first.
  *iterator(i = 0) {
    while (true) {
      yield this[i++]
    }
  }
}

function create(views, name, res) {
  views.set(name, new WeakRef(res))
  return res
}

// Dispatch on the shape of the call:
//   connect([])              → ArrSink, push events into the array
//   connect(obj, 'prop')     → PropSink, mirror value to obj[prop]
//   connect(obj, fn)         → FunctionSink, call fn(change) per event
//   connect(sink)            → bare attach (sink must implement the verbs)
// All paths return the first arg so the caller can chain or assert against it.
function connect(p, a, b) {
  if (isArray(a)) {
    const sink = new ArrSink(p, a)
    p.sinks.add(new WeakRef(sink))
    return a
  }

  if (typeof a === 'object' && typeof b === 'string') {
    const sink = new PropSink(p, a, b)
    p.sinks.add(new WeakRef(sink))
    return a
  }

  if (typeof a === 'object' && typeof b === 'function') {
    const sink = new FunctionSink(p, a, b)
    p.sinks.add(new WeakRef(sink))
    return a
  }

  // A bare function is never a valid sink: it has none of the BU1/BI0/BR1/…
  // verbs the protocol calls, so the bare-attach fallback below would defer a
  // cryptic "a.BI0 is not a function" to the first event (and silently emit
  // nothing until then). Fail fast at connect() time and point at the
  // supported two-arg form — there is intentionally no single-arg connect(fn).
  if (typeof a === 'function') throw new Error(
    "connect(fn) isn't supported: a bare function can't act as a sink. Use " +
    "connect(anchor, fn) to receive change records (the anchor object keeps " +
    "the subscription alive past GC), connect([]) to collect events into an " +
    "array, or connect(obj, 'prop') to mirror the value onto a property.")

  p.sinks.add(new WeakRef(a))
  return a
}

// Snapshot helpers for `proxy.first()` / `proxy.last()` — pick the source's
// current first/last key at call time. Arrays use index 0 / length-1; objects
// walk enumerable keys in iteration order. Empty sources collapse to '0' so
// the caller still gets a (degenerate) ViewProxy with undefined value rather
// than null, keeping the chainable API uniform.
function firstKey(v) {
  if (v == null || typeof v !== 'object') return '0'
  if (isArray(v)) return '0'
  for (const k in v) return k
  return '0'
}
function lastKey(v) {
  if (v == null || typeof v !== 'object') return '0'
  if (isArray(v)) return String(Math.max(0, v.length - 1))
  let last = '0'
  for (const k in v) last = k
  return last
}

// `proxy.raf()` returns a coalescing writer: each call records the latest
// pending value and arms a single requestAnimationFrame; subsequent calls
// before the frame fires overwrite the pending value, so a burst of writes
// commits exactly once per frame. `writer.flush()` commits immediately and
// cancels the pending frame — for `pointerup` handlers that need the final
// brush position to land without an extra frame's latency.
//
// `globalThis.requestAnimationFrame` is looked up per-call (not captured at
// module load) so test environments that polyfill rAF after import still
// work; falls back to `setTimeout(cb, 16)` in plain Node.
function raf(p) {
  let pending
  let scheduled = false
  const schedule = (cb) => typeof globalThis.requestAnimationFrame === 'function'
    ? globalThis.requestAnimationFrame(cb)
    : setTimeout(cb, 16)
  const writer = (v) => {
    pending = v
    if (scheduled) return
    scheduled = true
    schedule(() => {
      if (!scheduled) return
      scheduled = false
      p.res.update(pending, p.key)
    })
  }
  writer.flush = () => {
    if (!scheduled) return
    scheduled = false
    p.res.update(pending, p.key)
  }
  return writer
}
