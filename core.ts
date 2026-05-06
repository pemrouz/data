// @ts-nocheck
import { iter, isArray, noop } from './utils.ts'

// `value` and `view` are Symbol keys deliberately not exported as plain
// properties to keep the proxy's user-facing namespace clean: any string-named
// access on a ViewProxy creates a child view, so internal state has to live on
// a Symbol to avoid colliding with user data. `reactive` is a global symbol so
// foreign code (e.g. render templates from a separately-bundled copy) can ask
// "is this a reactive value?" without needing access to this module's exports.
export const value = Symbol('value')
export const reactive = Symbol.for('reactive')
export const view = Symbol('view')
const Symbols = { value, view }
const isObject = v => v.constructor === Object
// Sinks emit value snapshots through their callback; cloning here means the
// consumer can mutate freely without ever leaking back into the live tree.
// `d[view] ? d[view].value` short-circuits the structuredClone for nested
// proxies — those carry the live ref and would throw on clone otherwise.
const sclone = d =>
  d === undefined ? undefined
: d[view] ? d[view].value
: structuredClone(d)

// Operator dispatch table populated by index.ts at module load. Stored on a
// shared object so that adding an operator is a one-line registration rather
// than a switch in ViewProxy.apply.
export const Operators: Record<string, (...args: any[]) => any> = {}

export const $ = <T>(v: T) => new ViewProxy(View.value(v)) as Data<T>
export default $
// Overridable for deterministic IDs in tests — see core.test.ts:7.
$.random = (o) => crypto.randomUUID() as string | number

// Operator dedup: if a sink with the same class + matching args is already
// attached to this source, reuse it instead of building a parallel pipeline.
// Only operators that implement `matches()` participate; everything else gets
// a fresh instance per call. Reusing matters most for `between`/`sort` where
// the same brush bound may be subscribed to from multiple chart components.
export function createOperator(source, OperatorClass, ...args) {
  const p = source[view]
  let op = p.some_sink(sink => sink instanceof OperatorClass && sink.matches?.(...args))
  if (!op) {
    op = new OperatorClass(p, ...args)
    p.sinks.add(new WeakRef(op))
  }
  return new ViewProxy(op.view)
}

type Prettify<T> = { [K in keyof T]: T[K] } & {};
type RowOf<T> = T extends Record<any, infer R> ? R : never
type Data<T = any> = { [k in keyof T]: Data<T[k]> } & {
  [value]?: T;
  connect([]): [];
  connect({}): {};
  connect(Function): Function
  update(value: T): undefined
  update(value, key: string[]): undefined
  insert(value: RowOf<T>): undefined
  insert(value, key: string[]): undefined
  remove(key?: string[]): undefined
  filter(arg: object): Data<T>
  filter(key: string, value: any): Data<T>
  filter(fn: (row: RowOf<T>) => boolean): Data<T>
  between(key: string, [lo, hi]: [number, number]): Data<T>
  to<R>(fn: (value: T) => R): Data<R>
  map<R>(fn: (row: RowOf<T>) => R): Data<Record<string, R>>
  length(): Data<number>
  length<R>(fn: (row: RowOf<T>) => R): Data<Record<R, number>>
  za(column: string, max?: number): Data<T>
  za(max?: number): Data<T>
  az(column: string, max?: number): Data<T>
  az(max?: number): Data<T>
  top(max?: number): Data<T>
  limit(max: number): Data<T>
  intersect(...sources: Data[]): Data<T>
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
    key.length === 0 ? this.XU0(value)
  : key.length === 1 ? this.BU1([key[0], value])
                     : this.BU2([key, value])
  }

  insert(value, key, at){
    if (value instanceof ViewProxy) throw new Error('cannot set value to another data, use a linked value instead')
    // `at` is normalized to a string so downstream code can use `name in obj`
    // checks uniformly (numeric keys on plain objects coerce to strings anyway).
    at = at === undefined ? at : `${at}`
    key.length === 0 ? this.BI0([at, value])
                     : this.BI2([key, value, at])
  }

  remove(key){
    key.length === 0 ? this.XR0()
  : key.length === 1 ? this.BR1([key[0]])
                     : this.BR2([key])
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
  BR1A(R1){
    const NR1 = []
    for (let i = 0; i < R1.length; i++) {
      const name = R1[i]
      const value = this.view.value?.[name]
      this.view.value.splice(name, 1)
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
  BU1(U1) {
    const NU1 = []
    const NI0 = []
    if (typeof this.view.value !== 'object') this.view.value = {}
    for (let i = 0; i < U1.length; i++) {
      const name = U1[i++]
      const value = U1[i]
      if (this.view.value?.[name] === value) continue
      this.view.value?.[name] === undefined
        ? NI0.push(name, value)
        : NU1.push(name, value)
      this.view.value[name] = value
    }
    this.view.BU1(NU1)
    this.view.BI0(NI0)
  }

  // Deep update along a key path. We auto-create intermediate objects so a
  // user can write `proxy.a.b.c = 1` without first ensuring `a.b` exists; the
  // alternative would force callers to reproduce immutable-update boilerplate
  // for what's logically one assignment. `key.slice().reverse()` then `pop()`
  // is just a cheap way to walk the path forward without mutating the caller's
  // key array.
  BU2(U2){
    if (typeof this.view.value !== 'object') this.view.value = {}
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
    }
    this.view.BU2(U2)
  }

  // BI0: object insert. If `at` is omitted we mint a random key — this lets
  // `arr.insert(row)` work without the caller managing IDs. Routes to BI0A
  // for arrays so insert-at-position carries shift semantics.
  BI0(I0){
    if (isArray(this.view.value)) return this.BI0A(I0)
    if (typeof this.view.value !== 'object') this.view.value = {}
    for (let i = 0; i < I0.length; i++) {
      const at = I0[i++] ??= ''+$.random(this.view.value)
      const value = I0[i]
      if (this.view.value?.[at] === value) continue
      this.view.value[at] = value
    }
    this.view.BI0(I0)
  }

  // BI0A: array insert-at-position. Undefined `at` means "push to end" and
  // we record the resulting index back into I0 so downstream sinks know
  // where the row landed. Defined `at` means splice — surviving elements at
  // that position and beyond shift up.
  BI0A(I0){
    for (let i = 0; i < I0.length; i+=2) {
      const at = I0[i]
      const value = I0[i+1]
      if (at === undefined)
        I0[i] = ''+(this.view.value.push(value)-1)
      else
        this.view.value.splice(at, 0, value)
    }
    this.view.BI0(I0)
  }

  // Move-at-depth-1 verb. Each [from, to] pair moves the element at
  // index `from` to index `to`; rows in between rotate by one. Cheaper
  // than emulating the rotation as N value-update events because sinks
  // that care about identity (DOMSink uses insertBefore on the same
  // <li>) keep the existing entity rather than tearing down + rebuilding.
  BMV1(M1) {
    for (let i = 0; i < M1.length; i += 2) {
      const from = +M1[i]
      const to = +M1[i + 1]
      const [v] = this.view.value.splice(from, 1)
      this.view.value.splice(to, 0, v)
    }
    this.view.BMV1(M1)
  }

  BI2(I2){
    if (typeof this.view.value !== 'object') this.view.value = {}
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
    this.res = res
    this.key = []
    this.sinks = new Set
    this.views = new Map
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
      let offset = Infinity
      for (let i = 0; i < R1.length; i+=2) {
        if (R1[i] < offset) offset = R1[i]
        if (!offset) break
      }
      this.V1(offset)
    }
    for (const x of this.sinks) {
      const sink = x.deref()
      if (!sink) { this.sinks.delete(sink); continue }
      arr && sink.BR1A && sink.BR1A !== Value.prototype.BR1A
        ? sink.BR1A(R1, this)
        : sink.BR1(R1, this)
    }
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
      let offset = Infinity
      for (let i = 0; i < I0.length; i+=2) {
        if (I0[i] < offset) offset = I0[i]
      }
      this.V1(offset)
    }
    this.sink(sink => (sink.BI0A && sink.BI0A !== Value.prototype.BI0A)
      ? sink.BI0A(I0, this)
      : sink.BI0(I0, this))
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
    for (const x of this.sinks) {
      const sink = x.deref()
      if (!sink) { this.sinks.delete(sink); continue }
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
      if (!sink) { this.sinks.delete(sink); continue }
      if (n = fn(x)) return n
    }
  }

  sink(fn){
    for (const x of this.sinks) {
      const sink = x.deref?.()
      if (!sink) { this.sinks.delete(sink); continue }
      fn(sink)
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
    if (type === 'connect') return connect(p, ...args)
    const OperatorClass = Operators[type]?.(...args)
    if (OperatorClass) {
      // Same dedup logic as createOperator, inline because we already have p.
      let sink = p.some_sink(sink => {
        if (sink instanceof OperatorClass)
          return sink.matches?.(...args)
      })
      if (!sink) {
        p.sinks.add(new WeakRef(sink = new OperatorClass(p, ...args)))
      }
      return new ViewProxy(sink.view)
    }

    const [value, at] = args
    if (type === 'remove') return this.view.res.remove(p.key)
    if (type === 'update') return this.view.res.update(value, p.key)
    if (type === 'insert') return this.view.res.insert(value, p.key, at)
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

  p.sinks.add(new WeakRef(a))
  return a
}
