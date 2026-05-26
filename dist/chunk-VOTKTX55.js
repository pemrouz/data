// utils.ts
function iter(o, fn) {
  if (isArray(o)) {
    for (let i = 0; i < o.length; i++) fn(i, o[i]);
  } else {
    for (const i in o) fn(i, o[i]);
  }
}
var { isArray } = Array;
var identity = (d) => d;
var noop = () => {
};
var left = (prop) => function bisect(a, v, lo = 0, hi = a.length) {
  while (lo < hi) {
    const mid = lo + hi >>> 1;
    if (prop(a[mid]) < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};
var right = (prop) => function bisect(a, v, lo = 0, hi = a.length) {
  while (lo < hi) {
    const mid = lo + hi >>> 1;
    if (prop(a[mid]) > v) hi = mid;
    else lo = mid + 1;
  }
  return lo;
};
function bisect_right(v, lo = 0, hi = this.sorted.length) {
  while (lo < hi) {
    const mid = lo + hi >>> 1;
    if (this.col(this.p.value[this.sorted[mid]]) < v) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
function bisect_left(v, lo = 0, hi = this.sorted.length) {
  while (lo < hi) {
    const mid = lo + hi >>> 1;
    if (this.col(this.p.value[this.sorted[mid]]) < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
function isEmpty(obj) {
  for (const i in obj)
    return false;
  return true;
}

// core.ts
var value = /* @__PURE__ */ Symbol("value");
var reactive = /* @__PURE__ */ Symbol.for("reactive");
var view = /* @__PURE__ */ Symbol("view");
var Symbols = { value, view };
var sclone = (d) => d === void 0 ? void 0 : d[view] ? d[view].value : structuredClone(d);
var Operators = {};
var $ = (v) => new ViewProxy(View.value(v));
var core_default = $;
$.random = (o) => crypto.randomUUID();
var _devtoolsRoots = /* @__PURE__ */ new Set();
var _devtoolsInternalRoots = /* @__PURE__ */ new WeakSet();
function createOperator(source, OperatorClass, ...args) {
  const p = source[view];
  let op = p.some_sink((sink) => sink instanceof OperatorClass && sink.matches?.(...args) ? sink : void 0);
  if (!op) {
    op = new OperatorClass(p, ...args);
    p.sinks.add(new WeakRef(op));
  }
  return new ViewProxy(op.view);
}
var Value = class {
  constructor() {
    this.view = new View(this);
  }
  // Entry points from ViewProxy.set / .insert(...) / deleteProperty. They
  // dispatch on key-path length to the correct depth-suffixed verb. Setting a
  // proxy to another proxy is forbidden here because the resulting cycle is
  // ambiguous (copy or link?) — the caller must use a linked value instead
  // (see LinkedView).
  update(value2, key) {
    if (value2 instanceof ViewProxy) throw new Error("cannot set value to another data, use a linked value instead");
    key.length === 0 ? this.XU0(value2) : key.length === 1 ? this.BU1([key[0], value2]) : this.BU2([key, value2]);
  }
  insert(value2, key, at) {
    if (value2 instanceof ViewProxy) throw new Error("cannot set value to another data, use a linked value instead");
    at = at === void 0 ? at : `${at}`;
    key.length === 0 ? this.BI0([at, value2]) : this.BI2([key, value2, at]);
  }
  remove(key) {
    key.length === 0 ? this.XR0() : key.length === 1 ? this.BR1([key[0]]) : this.BR2([key]);
  }
  // Idempotent: a Value already at undefined emits nothing. Returns false so
  // callers can short-circuit when nothing happened (used by Sink chains that
  // skip propagation on no-ops).
  XR0() {
    if (this.view.value === void 0) return false;
    const value2 = this.view.value;
    this.view.value = void 0;
    this.view.XR0(value2);
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
  BR1A(R1) {
    const owns = this.view.value !== this.p?.value;
    const NR1 = [];
    for (let i = 0; i < R1.length; i++) {
      const name = R1[i];
      const value2 = this.view.value?.[name];
      if (owns) this.view.value.splice(name, 1);
      NR1.push(name);
      NR1.push(value2);
    }
    this.view.BR1(NR1);
  }
  // BR1: object remove-at-name. Routes to BR1A when the underlying value is
  // an array so we get splice semantics and downstream V1 propagation. Skips
  // already-undefined slots so a remove is a true no-op rather than emitting
  // a phantom event.
  BR1(R1) {
    if (isArray(this.view.value)) return this.BR1A(R1);
    const NR1 = [];
    for (let i = 0; i < R1.length; i++) {
      const name = R1[i];
      const value2 = this.view.value?.[name];
      if (value2 === void 0) continue;
      delete this.view.value[name];
      NR1.push(name);
      NR1.push(value2);
    }
    this.view.BR1(NR1);
  }
  BR2(R2) {
    const NR2 = [];
    loop1: for (let i = 0; i < R2.length; i++) {
      const key = R2[i];
      const [last, ...path] = key.slice().reverse();
      let vo = this.view.value;
      if (typeof vo !== "object") return;
      while (path.length) {
        const n = path.pop();
        if (typeof vo !== "object") continue loop1;
        vo = vo[n];
      }
      if (vo[last] === void 0) continue loop1;
      const value2 = vo[last];
      if (isArray(vo)) {
        vo.splice(last, 1);
      } else {
        delete vo[last];
      }
      NR2.push(key, value2);
    }
    this.view.BR2(NR2);
  }
  // Reference-equality short-circuit: if the caller passed the same object we
  // already hold, skip the entire dispatch. Operators that mutate in place
  // and re-emit (e.g. between, sort) rely on this — they swap the live
  // reference for a copy first to avoid this guard suppressing real changes.
  XU0(value2) {
    if (this.view.value === value2) return;
    this.view.value = value2;
    this.view.XU0();
  }
  // BU1 doubles as an upsert: keys whose previous value was undefined become
  // BI0 events, keys with an existing value become BU1, and identical values
  // are dropped entirely. Splitting the two avoids forcing every BU1 sink to
  // re-derive whether the row is new or a refresh.
  BU1(U1) {
    const NU1 = [];
    const NI0 = [];
    if (typeof this.view.value !== "object") this.view.value = {};
    for (let i = 0; i < U1.length; i++) {
      const name = U1[i++];
      const value2 = U1[i];
      if (this.view.value?.[name] === value2) continue;
      this.view.value?.[name] === void 0 ? NI0.push(name, value2) : NU1.push(name, value2);
      this.view.value[name] = value2;
    }
    this.view.BU1(NU1);
    this.view.BI0(NI0);
  }
  // Deep update along a key path. We auto-create intermediate objects so a
  // user can write `proxy.a.b.c = 1` without first ensuring `a.b` exists; the
  // alternative would force callers to reproduce immutable-update boilerplate
  // for what's logically one assignment. `key.slice().reverse()` then `pop()`
  // is just a cheap way to walk the path forward without mutating the caller's
  // key array.
  BU2(U2) {
    if (typeof this.view.value !== "object") this.view.value = {};
    for (let i = 0; i < U2.length; i++) {
      const key = U2[i++];
      const value2 = U2[i];
      const [last, ...path] = key.slice().reverse();
      let vo = this.view.value;
      while (path.length) {
        const n = path.pop();
        vo = typeof vo[n] === "object" ? vo[n] : vo[n] = {};
      }
      if (vo[last] === value2) continue;
      vo[last] = value2;
    }
    this.view.BU2(U2);
  }
  // BI0: object insert. If `at` is omitted we mint a random key — this lets
  // `arr.insert(row)` work without the caller managing IDs. Routes to BI0A
  // for arrays so insert-at-position carries shift semantics.
  BI0(I0) {
    if (isArray(this.view.value)) return this.BI0A(I0);
    if (typeof this.view.value !== "object") this.view.value = {};
    for (let i = 0; i < I0.length; i++) {
      const at = I0[i++] ??= "" + $.random(this.view.value);
      const value2 = I0[i];
      if (this.view.value?.[at] === value2) continue;
      this.view.value[at] = value2;
    }
    this.view.BI0(I0);
  }
  // BI0A: array insert-at-position. Undefined `at` means "push to end" and
  // we record the resulting index back into I0 so downstream sinks know
  // where the row landed. Defined `at` means splice — surviving elements at
  // that position and beyond shift up.
  //
  // Splice only if this operator owns its view.value (same shared-ref
  // guard as BR1A / BMV1 — see comment on BR1A).
  BI0A(I0) {
    const owns = this.view.value !== this.p?.value;
    for (let i = 0; i < I0.length; i += 2) {
      const at = I0[i];
      const value2 = I0[i + 1];
      if (at === void 0) {
        if (owns) I0[i] = "" + (this.view.value.push(value2) - 1);
        else I0[i] = "" + (this.view.value.length - 1);
      } else if (owns) {
        this.view.value.splice(at, 0, value2);
      }
    }
    this.view.BI0(I0);
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
        const from = +M1[i];
        const to = +M1[i + 1];
        const [v] = this.view.value.splice(from, 1);
        this.view.value.splice(to, 0, v);
      }
    }
    this.view.BMV1(M1);
  }
  BI2(I2) {
    if (typeof this.view.value !== "object") this.view.value = {};
    for (let i = 0; i < I2.length; i++) {
      const key = I2[i++];
      const value2 = I2[i++];
      const path = key.slice().reverse();
      let vo = this.view.value;
      while (path.length) {
        const n = path.pop();
        vo = typeof vo[n] === "object" ? vo[n] : vo[n] = {};
      }
      if (isArray(vo)) {
        if (I2[i] === void 0)
          I2[i] ??= "" + (vo.push(value2) - 1);
        else
          vo.splice(I2[i], 0, value2);
      } else {
        const at = I2[i] ??= "" + $.random(vo);
        vo[at] = value2;
      }
    }
    this.view.BI2(I2);
  }
};
var Operator = class extends Value {
};
var View = class _View {
  constructor(res) {
    this.res = res;
    this.key = [];
    this.sinks = /* @__PURE__ */ new Set();
    this.views = /* @__PURE__ */ new Map();
    this.p = void 0;
    this.name = void 0;
    this.value = void 0;
  }
  // Child views are produced lazily when ViewProxy.get sees a property access.
  // A child stays attached to its parent's key (so writes route correctly) but
  // owns its own value snapshot — kept in sync by the parent's dispatch logic
  // calling child.XU0() / XR0() on every notification that crosses its key.
  static child(p, name) {
    const view2 = new _View(p.res);
    view2.p = p;
    view2.key = [...p.key, name];
    view2.name = name;
    view2.XU0(p.value?.[name]);
    return view2;
  }
  // Two distinct entry points unified behind one factory: $(plain) builds a
  // fresh Value-backed View; $(otherProxy) builds a LinkedView that forwards
  // every read/write to the linked source. The branch matters for set/get
  // semantics — see LinkedView below.
  static value(value2) {
    if (value2 instanceof ViewProxy) {
      return new LinkedView(value2);
    } else {
      const res = new Value();
      res.XU0(value2);
      _devtoolsRoots.add(new WeakRef(res.view));
      return res.view;
    }
  }
  // XR0 cascades a clear: every named child loses its value too, but only if
  // the corresponding key actually disappeared (the second half of the OR
  // covers the case where a child is currently undefined and stays that way —
  // we still want its sinks to know).
  XR0(value2) {
    if (this.p) this.value = void 0;
    this.each((name, child) => {
      if (child.value !== value2?.[name] || child.value !== void 0)
        child.XR0(value2?.[name]);
    });
    this.sink((sink) => sink.XR0(value2, this));
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
    if (!R1.length) return;
    const arr = isArray(this.value);
    if (!arr) {
      for (let i = 0; i < R1.length; i += 2)
        this.get_named(R1[i])?.XR0(R1[i + 1]);
    } else if (this.views.size) {
      let offset = Infinity;
      for (let i = 0; i < R1.length; i += 2) {
        if (R1[i] < offset) offset = R1[i];
        if (!offset) break;
      }
      this.V1(offset);
    }
    for (const x of this.sinks) {
      const sink = x.deref();
      if (!sink) {
        this.sinks.delete(sink);
        continue;
      }
      arr && sink.BR1A && sink.BR1A !== Value.prototype.BR1A ? sink.BR1A(R1, this) : sink.BR1(R1, this);
    }
  }
  BR2(R2) {
    for (let i = 0; i < R2.length; i++) {
      const [name, ...rest] = R2[i++];
      const value2 = R2[i];
      rest.length === 1 ? this.get_named(name)?.BR1([rest[0], value2]) : this.get_named(name)?.BR2([rest, value2]);
    }
    this.sink((sink) => sink.BR2(R2, this));
  }
  // Whole-value replacement. For child views this means: any name still
  // present in the new value gets a refresh (XU0), any name that vanished
  // gets a clear (XR0). The `if (this.p)` re-reads our slice from the parent
  // because XU0 on the parent already mutated `p.value`; we just mirror it.
  XU0() {
    if (this.p) this.value = this.p.value?.[this.name];
    this.each((name, child) => {
      if (this.value?.[name] !== void 0)
        child.XU0();
      else {
        if (child.value !== void 0)
          child.XR0(child.value);
      }
    });
    this.sink((sink) => sink.XU0(this.value, this));
  }
  BU1(U1) {
    if (!U1.length) return;
    if (this.p) this.value = this.p.value?.[this.name];
    for (let i = 0; i < U1.length; i++) this.get_named(U1[i++])?.XU0();
    this.sink((sink) => sink.BU1(U1, this));
  }
  BU2(U2) {
    if (this.p) this.value = this.p.value?.[this.name];
    for (let i = 0; i < U2.length; i++) {
      const [name, ...rest] = U2[i++];
      const value2 = U2[i];
      rest.length === 1 ? this.get_named(name)?.BU1([rest[0], value2]) : this.get_named(name)?.BU2([rest, value2]);
    }
    this.sink((sink) => sink.BU2(U2, this));
  }
  BI0(I0) {
    if (!I0.length) return;
    if (this.p) this.value = this.p.value?.[this.name];
    if (isArray(this.value)) return this.BI0A(I0);
    for (let i = 0; i < I0.length; i++) this.get_named(I0[i++])?.XU0();
    this.sink((sink) => sink.BI0(I0, this));
  }
  // Array insert: every existing index ≥ the smallest insert position has
  // shifted up, so refresh those children once before fanning out to sinks.
  // The prototype check guards against a sink that only inherits the default
  // BI0A from Value being treated as array-aware.
  BI0A(I0) {
    if (this.views.size) {
      let offset = Infinity;
      for (let i = 0; i < I0.length; i += 2) {
        if (I0[i] < offset) offset = I0[i];
      }
      this.V1(offset);
    }
    this.sink((sink) => sink.BI0A && sink.BI0A !== Value.prototype.BI0A ? sink.BI0A(I0, this) : sink.BI0(I0, this));
  }
  BI2(I2) {
    if (this.p) this.value = this.p.value?.[this.name];
    for (let i = 0; i < I2.length; ) {
      const [name, ...rest] = I2[i++];
      const value2 = I2[i++];
      const at = I2[i++];
      rest.length ? this.get_named(name)?.BI2([rest, value2, at]) : this.get_named(name)?.BI0([at, value2]);
    }
    this.sink((sink) => sink.BI2(I2, this));
  }
  // Apply a batched [from, to] rotation to named children whose key falls
  // inside any affected range, refreshing each from the (already moved)
  // parent value. Sinks that don't implement BMV1 fall back to BU1 over the
  // affected positions so they refresh content reactively.
  BMV1(M1) {
    if (!M1.length) return;
    if (this.p) this.value = this.p.value?.[this.name];
    if (this.views.size) {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < M1.length; i += 2) {
        const a = +M1[i], b = +M1[i + 1];
        if (a < lo) lo = a;
        if (b < lo) lo = b;
        if (a > hi) hi = a;
        if (b > hi) hi = b;
      }
      for (let j = lo; j <= hi; j++) {
        const child = this.get_named(`${j}`);
        if (child && child.value !== this.value[j]) child.XU0();
      }
    }
    for (const x of this.sinks) {
      const sink = x.deref();
      if (!sink) {
        this.sinks.delete(sink);
        continue;
      }
      if (sink.BMV1 && sink.BMV1 !== Value.prototype.BMV1) {
        sink.BMV1(M1, this);
      } else {
        const NU1 = [];
        for (let i = 0; i < M1.length; i += 2) {
          const a = +M1[i], b = +M1[i + 1];
          const lo = a < b ? a : b;
          const hi = a < b ? b : a;
          for (let j = lo; j <= hi; j++) NU1.push("" + j, this.value[j]);
        }
        if (NU1.length) sink.BU1(NU1, this);
      }
    }
  }
  // After an array splice every index from `offset` onward may now hold a
  // different element. Walk all named children in that range and refresh
  // those whose snapshot diverged. Off-by-one (`length+1`) intentional: a
  // child created at the now-empty tail needs an XU0 to clear itself.
  V1(offset) {
    for (let i = offset; i < this.value.length + 1; i++) {
      const child = this.get_named(`${i}`);
      if (child && child.value !== this.value[i]) child.XU0();
    }
  }
  // Iteration helpers all double as sweepers: a WeakRef whose target was GC'd
  // is removed from the collection on the fly, so dead subscribers don't
  // accumulate. `sink(fn)` is the standard fan-out; `some_sink(fn)` is the
  // operator-dedup helper used by createOperator and ViewProxy.apply.
  some_sink(fn) {
    let n;
    for (const x of this.sinks) {
      const sink = x.deref?.();
      if (!sink) {
        this.sinks.delete(x);
        continue;
      }
      if (n = fn(sink)) return n;
    }
  }
  sink(fn) {
    for (const x of this.sinks) {
      const sink = x.deref?.();
      if (!sink) {
        this.sinks.delete(x);
        continue;
      }
      fn(sink);
    }
  }
  each(fn) {
    for (const [name, ref] of this.views) {
      const res = ref.deref?.();
      if (!res) {
        this.views.delete(name);
        continue;
      }
      fn(name, res);
    }
  }
  get_or_create_named(name) {
    return this.views.get(name)?.deref?.() ?? create(
      this.views,
      name,
      _View.child(this, name)
    );
  }
  get_named(name) {
    const res = this.views.get(name)?.deref?.();
    if (!res) this.views.delete(name);
    return res;
  }
  disconnect(sink) {
    for (const x of this.sinks) {
      const s = x.deref?.();
      if (s === sink) {
        this.sinks.delete(x);
        break;
      }
      if (!s) {
        this.sinks.delete(x);
        continue;
      }
    }
  }
  connect(sink) {
    this.sinks.add(new WeakRef(sink));
  }
};
var Sink = class {
};
var LinkedView = class extends View {
  constructor(p) {
    super();
    this.src = p[Symbols.view];
    this.update(this.src);
  }
  update(value2, key = []) {
    if (key.length) {
      return this.src.res.update(value2, key);
    }
    if (value2 instanceof ViewProxy) value2 = value2[Symbols.view];
    if (!(value2 instanceof View))
      throw new Error("cannot set linked value to non-reactive source");
    this.src.disconnect(this);
    this.src = value2;
    this.src.connect(this);
    this.XU0();
  }
  insert(...args) {
    return this.src.res.insert(...args);
  }
  remove(...args) {
    return this.src.res.remove(...args);
  }
  // `value` and `res` are read-through to the source — the LinkedView itself
  // never holds data, it's a transparent forwarder.
  get value() {
    return this.src.value;
  }
  set value(v) {
  }
  get res() {
    return this;
  }
  set res(v) {
  }
};
function iter22(arr, fn) {
  for (let i = 0; i < arr.length; i++) fn(arr[i++], arr[i]);
}
function iter3(arr, fn) {
  for (let i = 0; i < arr.length; i++) fn(arr[i++], arr[i++], arr[i]);
}
var ArrSink = class {
  constructor(p, arr) {
    this.p = p;
    this.arr = arr;
    this.update([], p.value);
  }
  update = (key, value2) => this.arr.push({ type: "update", key, value: sclone(value2) });
  remove = (key, value2) => this.arr.push({ type: "remove", key, value: sclone(value2) });
  insert = (key, value2, at) => this.arr.push({ type: "insert", key, value: sclone(value2), at });
  XU0(value2) {
    this.update([], value2);
  }
  BU1(U1) {
    iter22(U1, (name, value2) => this.update([name], value2));
  }
  BU2(U2) {
    iter22(U2, (key, value2) => this.update(key, value2));
  }
  BI0(I0) {
    iter22(I0, (at, value2) => this.insert([], value2, at));
  }
  BI2(I0) {
    iter3(I0, (key, value2, at) => this.insert(key, value2, at));
  }
  XR0(value2) {
    this.remove([], value2);
  }
  BR1(R1) {
    iter22(R1, (name, value2) => this.remove([name], value2));
  }
  BR2(R2) {
    iter22(R2, (key, value2) => this.remove(key, value2));
  }
  move = (from, to) => this.arr.push({ type: "move", from, to });
  BMV1(M1) {
    iter22(M1, (from, to) => this.move(+from, +to));
  }
  R0(value2) {
    this.arr.push({ type: "remove", key: [], value: sclone(value2) });
  }
  R1(name, value2) {
    this.arr.push({ type: "remove", key: [name], value: sclone(value2) });
  }
  R2(key, value2) {
    this.arr.push({ type: "remove", key, value: sclone(value2) });
  }
  U0(value2) {
    this.arr.push({ type: "update", key: [], value: sclone(value2) });
  }
  U1(name, value2) {
    this.arr.push({ type: "update", key: [name], value: sclone(value2) });
  }
  U2(key, value2) {
    this.arr.push({ type: "update", key, value: sclone(value2) });
  }
  I0(value2, at) {
    this.arr.push({ type: "insert", value: sclone(value2), at });
  }
  I1(name, value2, at) {
    this.arr.push({ type: "insert", key: [name], value: sclone(value2), at });
  }
  I2(key, value2, at) {
    this.arr.push({ type: "insert", key, value: sclone(value2), at });
  }
};
var lifetimes = /* @__PURE__ */ new WeakMap();
var PropSink = class extends Sink {
  p;
  obj;
  prop;
  constructor(p, obj, prop) {
    super();
    this.p = p;
    this.obj = obj;
    this.prop = prop;
    this.obj[prop] = p.value;
    const refs = lifetimes.get(obj) ?? /* @__PURE__ */ new Set();
    refs.add(this);
    lifetimes.set(obj, refs);
  }
  XU0(value2) {
    this.obj[this.prop] = value2;
  }
  XR0() {
    this.XU0(this.p.value);
  }
  BU1() {
    this.XU0(this.p.value);
  }
  BR1() {
    this.XU0(this.p.value);
  }
  BI0() {
    this.XU0(this.p.value);
  }
  BU2() {
    this.XU0(this.p.value);
  }
  BR2() {
    this.XU0(this.p.value);
  }
  BI2() {
    this.XU0(this.p.value);
  }
  BMV1() {
    this.XU0(this.p.value);
  }
};
var FunctionSink = class extends Sink {
  constructor(p, obj, fn) {
    super();
    this.fn = fn;
    fn({ type: "update", key: [], value: sclone(p.value) });
  }
  XU0(value2) {
    this.fn({ type: "update", key: [], value: sclone(value2) });
  }
  XR0(value2) {
    this.fn({ type: "remove", key: [], value: sclone(value2) });
  }
  BU1(U1) {
    iter22(U1, (name, value2) => this.fn({ type: "update", key: [name], value: sclone(value2) }));
  }
  BU2(U2) {
    iter22(U2, (key, value2) => this.fn({ type: "update", key, value: sclone(value2) }));
  }
  BI0(I0) {
    iter22(I0, (at, value2) => this.fn({ type: "insert", key: [], value: sclone(value2), at }));
  }
  BI2(I2) {
    iter3(I2, (key, value2, at) => this.fn({ type: "insert", key, value: sclone(value2), at }));
  }
  BR1(R1) {
    iter22(R1, (name, value2) => this.fn({ type: "remove", key: [name], value: sclone(value2) }));
  }
  BR2(R2) {
    iter22(R2, (key, value2) => this.fn({ type: "remove", key, value: sclone(value2) }));
  }
  BMV1(M1) {
    iter22(M1, (from, to) => this.fn({ type: "move", from: +from, to: +to }));
  }
};
var ViewProxy = class _ViewProxy {
  view;
  constructor(view2) {
    this.view = view2;
    return new Proxy(noop, this);
  }
  deleteProperty(target, name) {
    const { res, key } = this.view;
    const path = name === Symbols.value ? key : [...key, "" + name];
    res.remove(path);
    return true;
  }
  set(t, name, value2) {
    const { res, key } = this.view;
    const path = name === Symbols.value ? key : [...key, name];
    res.update(value2, path);
    return true;
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
  get(t, name) {
    if (name === Symbol.toPrimitive) return (hint) => hint ? this.view.value?.toString() : +this.view.value;
    if (name === Symbol.iterator) return this.iterator;
    if (name === Symbols.reactive) return true;
    if (name === Symbols.view) return this.view;
    if (name === Symbols.value) return this.view.value;
    return new _ViewProxy(this.view.get_or_create_named(name));
  }
  // `proxy.filter(fn)` arrives here as: get → child view named "filter" →
  // apply. The child view's `name` tells us which operator to construct.
  // `connect`, `update`, `insert`, `remove` are handled directly without
  // going through the operator dispatch table.
  apply(t, m, args) {
    const { p, name: type } = this.view;
    if (!p) throw new Error("cannot invoke a root value!");
    if (type === "then" && typeof args[0] === "function") {
      const [onFulfilled, onRejected] = args;
      try {
        onFulfilled(p.value);
      } catch (e) {
        if (typeof onRejected === "function") onRejected(e);
      }
      return;
    }
    if (type === "connect") return connect(p, ...args);
    if (type === "raf") return raf(p);
    if (type === "first") return new _ViewProxy(p.get_or_create_named(firstKey(p.value)));
    if (type === "last") return new _ViewProxy(p.get_or_create_named(lastKey(p.value)));
    const OperatorClass = Operators[type]?.(...args);
    if (OperatorClass) {
      let sink = p.some_sink((sink2) => sink2 instanceof OperatorClass && sink2.matches?.(...args) ? sink2 : void 0);
      if (!sink) {
        p.sinks.add(new WeakRef(sink = new OperatorClass(p, ...args)));
      }
      return new _ViewProxy(sink.view);
    }
    const [value2, at] = args;
    if (type === "remove") return this.view.res.remove(p.key);
    if (type === "update") return this.view.res.update(value2, p.key);
    if (type === "insert") return this.view.res.insert(value2, p.key, at);
    throw new Error(`Unknown operator '${type}'. Chainable operators (.filter, .between, .length, etc.) register when you import from 'data' (the default entry) or 'data/full' (adds JSX). You're seeing this because the dispatch table is empty \u2014 likely an import from 'data/lean' (the registration-free core). Switch to 'data', or register the operators you need onto the exported 'Operators' table yourself.`);
  }
  getPrototypeOf(target) {
    return _ViewProxy.prototype;
  }
  // Open-ended counter — relies on the consumer to break out (typically
  // `.slice()` or destructuring with a fixed length). The reactive view
  // doesn't know its own length without resolving `value` first.
  *iterator(i = 0) {
    while (true) {
      yield this[i++];
    }
  }
};
function create(views, name, res) {
  views.set(name, new WeakRef(res));
  return res;
}
function connect(p, a, b) {
  if (isArray(a)) {
    const sink = new ArrSink(p, a);
    p.sinks.add(new WeakRef(sink));
    return a;
  }
  if (typeof a === "object" && typeof b === "string") {
    const sink = new PropSink(p, a, b);
    p.sinks.add(new WeakRef(sink));
    return a;
  }
  if (typeof a === "object" && typeof b === "function") {
    const sink = new FunctionSink(p, a, b);
    p.sinks.add(new WeakRef(sink));
    return a;
  }
  p.sinks.add(new WeakRef(a));
  return a;
}
function firstKey(v) {
  if (v == null || typeof v !== "object") return "0";
  if (isArray(v)) return "0";
  for (const k in v) return k;
  return "0";
}
function lastKey(v) {
  if (v == null || typeof v !== "object") return "0";
  if (isArray(v)) return String(Math.max(0, v.length - 1));
  let last = "0";
  for (const k in v) last = k;
  return last;
}
function raf(p) {
  let pending;
  let scheduled = false;
  const schedule = (cb) => typeof globalThis.requestAnimationFrame === "function" ? globalThis.requestAnimationFrame(cb) : setTimeout(cb, 16);
  const writer = (v) => {
    pending = v;
    if (scheduled) return;
    scheduled = true;
    schedule(() => {
      if (!scheduled) return;
      scheduled = false;
      p.res.update(pending, p.key);
    });
  };
  writer.flush = () => {
    if (!scheduled) return;
    scheduled = false;
    p.res.update(pending, p.key);
  };
  return writer;
}

export { $, Operator, Operators, Sink, View, ViewProxy, _devtoolsInternalRoots, _devtoolsRoots, bisect_left, bisect_right, core_default, createOperator, identity, isArray, isEmpty, iter, left, noop, reactive, right, value, view };
//# sourceMappingURL=chunk-VOTKTX55.js.map
//# sourceMappingURL=chunk-VOTKTX55.js.map