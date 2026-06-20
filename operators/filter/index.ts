// @ts-nocheck
import { isArray } from '../../utils.ts'
import { createOperator, ViewProxy, value } from '../../core.ts'
import { RowOperator } from '../../row.ts'

// Walks a key path against a (possibly nested) row. Returns undefined if any
// segment is missing. NB: must not be written as `while (p.length) r = r?.[p.shift()]`
// — once `r` is nullish, optional chaining short-circuits past the `p.shift()`,
// `p` never drains, and the loop spins forever.
function get(k, r){
  for (const seg of k) {
    if (r == null) return undefined
    r = r[seg]
  }
  return r
}

function otof(k, v, fns) {
  if (typeof v !== 'object')
    fns.push((r, i) => get(k, r) === v)
  else
    for (const i in v) {
      otof(k.concat(i), v[i], fns)
    }
  return fns
}

// Recursive deep-equality for the object-shape filter form: every leaf in
// `expected` must match the corresponding leaf in `actual`. Doesn't recurse
// into `actual`'s extra keys — the row is allowed to have more fields than
// the predicate cares about. A leaf that is a reactive ViewProxy is compared
// against its LIVE snapshot (`expected[value]`) — checked BEFORE the
// `typeof !== 'object'` branch because a ViewProxy is itself a callable
// (typeof 'function'), so an un-special-cased leaf would reference-compare the
// proxy object and never match (the documented filter('foo', $(5)) trap).
function match(actual, expected) {
  if (expected instanceof ViewProxy)
    return actual === expected[value]
  if (typeof expected !== 'object')
    return actual === expected
  else
    return Object
      .entries(expected)
      .every(([k, v]) => match(actual?.[k], v))
}

// Collect every reactive (ViewProxy) leaf in an object-form filter template, so
// FilterObjectValue can subscribe to each and rebuild when any changes.
function reactiveLeaves(obj, out = []) {
  for (const k in obj) {
    const v = obj[k]
    if (v instanceof ViewProxy) out.push(v)              // a ViewProxy is typeof 'function', not 'object'
    else if (v && typeof v === 'object') reactiveLeaves(v, out)
  }
  return out
}

// FilterValue is the function-predicate form. RowOperator drives the per-row
// classification — we just have to return the row (kept) or undefined
// (dropped) from `process`. The Filter*Value subclasses wrap convenience
// argument shapes (`filter('key', val)`, `filter({k:v})`, etc.) into the
// underlying predicate function.
export class FilterValue extends RowOperator {
  constructor(p, fn){
    super()
    this.p = p
    this.fn = fn
    this.XU0(this.p.value)
  }

  process(value, name, old_val) {
    return this.fn(value, name, old_val) ? value : undefined
  }

  // Connect target for a reactive value arg (FilterString/ColumnValue). The
  // predicate reads a mutable `_cell.v` (set up in the subclass BEFORE super(),
  // since `this` isn't available to close over there yet), so updating the cell
  // and re-running XU0 re-classifies every row against the new value. The
  // value-equality guard makes the construction-time connect seed a no-op (the
  // initial XU0 already used the snapshot) and skips a redundant rebuild when a
  // bound re-emits the same value. A non-reactive filter has no `_cell`, so this
  // is inert for the fn / truthy forms.
  set val(v) {
    if (this._cell && v !== this._cell.v) { this._cell.v = v; this.XU0(this.p.value) }
  }
}

// `filter({a: 1})` form — match-by-template against arbitrary nesting. Any leaf
// may be a reactive ViewProxy (`filter({region: $(cur)})`): each is subscribed
// and a change rebuilds the view. `match` reads each reactive leaf's live value.
export class FilterObjectValue extends FilterValue {
  constructor(p, obj) {
    super(p, r => match(r, obj))
    const reactives = reactiveLeaves(obj)
    if (reactives.length) {
      this._anchor = {}                                  // lifetime handle for the FunctionSinks
      const rebuild = () => { if (this._live) this.XU0(this.p.value) }
      for (const vp of reactives) vp.connect(this._anchor, rebuild)
      this._live = true                                  // the connect seeds above ran with _live unset (no-op)
    }
  }
}

// `filter('key')` (truthy) and `filter('key', val)` (equality on top-level key).
// `val` may be a reactive ViewProxy — the equality re-selects when it changes.
// `r?.` (not `r.`): the protocol legitimately hands process() an undefined row —
// clearing a key (`src.k = undefined` is a BU1 leave) and the sparse-view XU0
// walk both do — and an unguarded deref threw mid-cascade. The other argument
// shapes (FilterColumnValue, FilterObjectValue) already guard.
export class FilterStringValue extends FilterValue {
  constructor(p, name, arg) {
    if (arg instanceof ViewProxy) {
      // The predicate must read the LIVE value, but `this` isn't available
      // before super(); close over a mutable cell instead, then connect after.
      const cell = { v: arg[value] }
      super(p, r => r?.[name] === cell.v)
      this._cell = cell
      arg.connect(this, 'val')                           // fires `set val` now (no-op) + on every change
    } else {
      super(p, arg === undefined
        ? r => !!r?.[name]
        : r => r?.[name] === arg
      )
    }
  }
}

// `filter(['a', 'b'], val)` — equality at a nested path. The lone string
// case routes to FilterStringValue above; this one is for arrays of segments.
// `val` may be a reactive ViewProxy, same as the string form.
export class FilterColumnValue extends FilterValue {
  constructor(p, name, arg) {
    const key = [].concat(name)
    if (arg instanceof ViewProxy) {
      const cell = { v: arg[value] }
      super(p, r => get(key, r) === cell.v)
      this._cell = cell
      arg.connect(this, 'val')
    } else {
      super(p, arg === undefined
        ? r => !!get(key, r)
        : r => get(key, r) === arg
      )
    }
  }
}

export const filter = (source, a, b) => {
  const Class = typeof a === 'function' ? FilterValue
              : typeof a === 'string'   ? FilterStringValue
              : isArray(a)              ? FilterColumnValue
              : FilterObjectValue
  return createOperator(source, Class, a, b)
}
