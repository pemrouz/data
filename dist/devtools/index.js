var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// utils.ts
var isArray, noop;
var init_utils = __esm({
  "utils.ts"() {
    ({ isArray } = Array);
    noop = () => {
    };
  }
});

// core.ts
function iter2(arr, fn) {
  for (let i = 0; i < arr.length; i++) fn(arr[i++], arr[i]);
}
function iter3(arr, fn) {
  for (let i = 0; i < arr.length; i++) fn(arr[i++], arr[i++], arr[i]);
}
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
var value, view, Symbols, sclone, Operators, $, _devtoolsRoots, _devtoolsInternalRoots, Value, Operator, View, Sink, LinkedView, ArrSink, lifetimes, PropSink, FunctionSink, ViewProxy;
var init_core = __esm({
  "core.ts"() {
    init_utils();
    value = /* @__PURE__ */ Symbol("value");
    view = /* @__PURE__ */ Symbol("view");
    Symbols = { value, view };
    sclone = (d) => d === void 0 ? void 0 : d[view] ? d[view].value : structuredClone(d);
    Operators = {};
    $ = (v) => new ViewProxy(View.value(v));
    $.random = (o) => crypto.randomUUID();
    _devtoolsRoots = /* @__PURE__ */ new Set();
    _devtoolsInternalRoots = /* @__PURE__ */ new WeakSet();
    Value = class {
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
    Operator = class extends Value {
    };
    View = class _View {
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
    Sink = class {
    };
    LinkedView = class extends View {
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
    ArrSink = class {
      constructor(p, arr) {
        this.p = p;
        this.arr = arr;
        const refs = lifetimes.get(arr) ?? /* @__PURE__ */ new Set();
        refs.add(this);
        lifetimes.set(arr, refs);
        this.update([], p.value);
      }
      update = (key, value2) => this.arr.push({ type: "update", key, value: sclone(value2) });
      remove = (key, value2) => this.arr.push({ type: "remove", key, value: sclone(value2) });
      insert = (key, value2, at) => this.arr.push({ type: "insert", key, value: sclone(value2), at });
      XU0(value2) {
        this.update([], value2);
      }
      BU1(U1) {
        iter2(U1, (name, value2) => this.update([name], value2));
      }
      BU2(U2) {
        iter2(U2, (key, value2) => this.update(key, value2));
      }
      BI0(I0) {
        iter2(I0, (at, value2) => this.insert([], value2, at));
      }
      BI2(I0) {
        iter3(I0, (key, value2, at) => this.insert(key, value2, at));
      }
      XR0(value2) {
        this.remove([], value2);
      }
      BR1(R1) {
        iter2(R1, (name, value2) => this.remove([name], value2));
      }
      BR2(R2) {
        iter2(R2, (key, value2) => this.remove(key, value2));
      }
      move = (from, to) => this.arr.push({ type: "move", from, to });
      BMV1(M1) {
        iter2(M1, (from, to) => this.move(+from, +to));
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
    lifetimes = /* @__PURE__ */ new WeakMap();
    PropSink = class extends Sink {
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
    FunctionSink = class extends Sink {
      constructor(p, obj, fn) {
        super();
        this.fn = fn;
        const refs = lifetimes.get(obj) ?? /* @__PURE__ */ new Set();
        refs.add(this);
        lifetimes.set(obj, refs);
        fn({ type: "update", key: [], value: sclone(p.value) });
      }
      XU0(value2) {
        this.fn({ type: "update", key: [], value: sclone(value2) });
      }
      XR0(value2) {
        this.fn({ type: "remove", key: [], value: sclone(value2) });
      }
      BU1(U1) {
        iter2(U1, (name, value2) => this.fn({ type: "update", key: [name], value: sclone(value2) }));
      }
      BU2(U2) {
        iter2(U2, (key, value2) => this.fn({ type: "update", key, value: sclone(value2) }));
      }
      BI0(I0) {
        iter2(I0, (at, value2) => this.fn({ type: "insert", key: [], value: sclone(value2), at }));
      }
      BI2(I2) {
        iter3(I2, (key, value2, at) => this.fn({ type: "insert", key, value: sclone(value2), at }));
      }
      BR1(R1) {
        iter2(R1, (name, value2) => this.fn({ type: "remove", key: [name], value: sclone(value2) }));
      }
      BR2(R2) {
        iter2(R2, (key, value2) => this.fn({ type: "remove", key, value: sclone(value2) }));
      }
      BMV1(M1) {
        iter2(M1, (from, to) => this.fn({ type: "move", from: +from, to: +to }));
      }
    };
    ViewProxy = class _ViewProxy {
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
        if (type === "patch") {
          const { res, key } = p;
          const pairs = args[0];
          if (!key.length) return res.BU1(pairs);
          const U2 = [];
          for (let i = 0; i < pairs.length; i += 2) U2.push([...key, pairs[i]], pairs[i + 1]);
          return res.BU2(U2);
        }
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
  }
});

// devtools/walk.ts
function* iterRoots(opts) {
  const includeInternal = opts && opts.internal;
  for (const ref of _devtoolsRoots) {
    const v = ref.deref();
    if (!v) {
      _devtoolsRoots.delete(ref);
      continue;
    }
    if (!includeInternal && _devtoolsInternalRoots.has(v)) continue;
    yield v;
  }
}
function classify(sink) {
  if (sink instanceof Operator) return "operator";
  if (sink && typeof sink === "object") {
    if ("parent" in sink && sink.constructor?.name === "DOMSink") return "dom";
    const n = sink.constructor?.name;
    if (n === "ArrSink" || n === "PropSink" || n === "FunctionSink") return "connect";
  }
  return "sink";
}
function summarize(value2) {
  if (value2 === null || value2 === void 0) return value2;
  const t = typeof value2;
  if (t === "string") return value2.length > 80 ? value2.slice(0, 77) + "..." : value2;
  if (t === "number" || t === "boolean" || t === "bigint" || t === "symbol") return value2;
  if (Array.isArray(value2)) return `Array(${value2.length})`;
  if (t === "function") return `Function(${value2.name || "anonymous"})`;
  if (t === "object") return `{ keys: ${Object.keys(value2).length} }`;
  return String(value2);
}
function ancestorOf(child, root, maxDepth = 32) {
  if (!child || !root) return false;
  if (child === root) return true;
  let n = child, d = 0;
  while (n && d < maxDepth) {
    if (n === root) return true;
    n = n.p;
    d++;
  }
  return false;
}
function walk(view2, opts) {
  opts = opts || {};
  return walkImpl(view2, opts.seen || /* @__PURE__ */ new WeakSet(), opts);
}
function walkImpl(view2, seen, opts) {
  if (seen.has(view2)) {
    return { key: [...view2.key], kind: "cycle", children: [], sinks: [] };
  }
  seen.add(view2);
  if ("src" in view2 && view2.src && view2.src !== view2) {
    return {
      key: [...view2.key],
      name: view2.name,
      kind: "linked-alias",
      aliasOf: view2.src.key ? [...view2.src.key] : [],
      children: [],
      sinks: []
    };
  }
  const node = {
    key: [...view2.key],
    name: view2.name,
    kind: view2.p ? "child" : "root",
    value: summarize(view2.value),
    children: [],
    sinks: []
  };
  view2.each?.((_name, child) => {
    const c = walkImpl(child, seen, opts);
    if (c.picked || c.pickedAncestor) node.pickedAncestor = true;
    node.children.push(c);
  });
  view2.sink?.((s) => {
    if (s instanceof Operator) {
      const opNode = walkImpl(s.view, seen, opts);
      opNode.kind = "operator";
      opNode.ctor = s.constructor.name;
      if (opts.pickedSink === s) opNode.picked = true;
      if (opNode.picked || opNode.pickedAncestor) node.pickedAncestor = true;
      node.sinks.push(opNode);
    } else {
      const sinkNode = {
        key: [...view2.key],
        kind: classify(s),
        ctor: s.constructor?.name || "anonymous",
        children: [],
        sinks: []
      };
      if (opts.pickedSink === s) {
        sinkNode.picked = true;
        node.pickedAncestor = true;
      }
      node.sinks.push(sinkNode);
    }
  });
  return node;
}
var init_walk = __esm({
  "devtools/walk.ts"() {
    init_core();
  }
});

// devtools/panel/index.ts
var panel_exports = {};
__export(panel_exports, {
  getShell: () => getShell,
  mount: () => mount,
  unmount: () => unmount
});
function mount(rootProxy) {
  if (typeof document === "undefined") return null;
  if (current) return current;
  if (!rootProxy) {
    const first = iterRoots().next().value;
    if (first) rootProxy = new ViewProxy(first);
  }
  if (rootProxy) {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    current = mountPanel({ rootProxy });
    return current;
  }
  if (!pollTimer) {
    let tries = 0;
    const tick = () => {
      pollTimer = null;
      if (current) return;
      const r = iterRoots().next().value;
      if (r) {
        current = mountPanel({ rootProxy: new ViewProxy(r) });
        return;
      }
      if (++tries < 100) pollTimer = setTimeout(tick, 50);
    };
    pollTimer = setTimeout(tick, 0);
  }
  return null;
}
function unmount() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  if (!current) return;
  try {
    current.destroy();
  } catch {
  }
  current = null;
}
function getShell() {
  return current;
}
function mountPanel({ rootProxy }) {
  const host = document.createElement("div");
  host.className = "__ripple_panel_host";
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: "closed" });
  root.appendChild(makeStyle());
  const dock = el("aside", "dock");
  root.appendChild(dock);
  const DOCK_WIDTH_KEY = "data-devtools-dock-width";
  const DOCK_MIN = 320;
  const dockMax = () => Math.max(DOCK_MIN, window.innerWidth - 60);
  const savedWidth = (() => {
    const raw = parseInt(localStorage.getItem(DOCK_WIDTH_KEY) || "", 10);
    return Number.isFinite(raw) ? Math.max(DOCK_MIN, Math.min(dockMax(), raw)) : null;
  })();
  if (savedWidth != null) dock.style.width = savedWidth + "px";
  const dockResize = el("div", "dock-resize");
  dockResize.title = "drag to resize the dock";
  dock.appendChild(dockResize);
  let dockResizeDrag = null;
  dockResize.addEventListener("pointerdown", (e) => {
    dockResizeDrag = { startX: e.clientX, startW: dock.getBoundingClientRect().width };
    try {
      dockResize.setPointerCapture(e.pointerId);
    } catch {
    }
    dockResize.classList.add("dragging");
    e.preventDefault();
  });
  dockResize.addEventListener("pointermove", (e) => {
    if (!dockResizeDrag) return;
    const dx = e.clientX - dockResizeDrag.startX;
    const w = Math.max(DOCK_MIN, Math.min(dockMax(), dockResizeDrag.startW - dx));
    dock.style.width = w + "px";
  });
  const endDockResize = (e) => {
    if (!dockResizeDrag) return;
    dockResizeDrag = null;
    dockResize.classList.remove("dragging");
    try {
      dockResize.releasePointerCapture(e.pointerId);
    } catch {
    }
    localStorage.setItem(DOCK_WIDTH_KEY, String(Math.round(dock.getBoundingClientRect().width)));
  };
  dockResize.addEventListener("pointerup", endDockResize);
  dockResize.addEventListener("pointercancel", endDockResize);
  const header = el("div", "dock-header");
  header.append(
    el("span", "brand", { text: "data devtools" }),
    (() => {
      const tools = el("div", "tools");
      const hover = mkBtn("\u2299", "arm Alt-hover (or hold Alt)");
      const pick = mkBtn("\u25CE", "pick a DOM element to find its view");
      const close = mkBtn("\u2715", "close panel");
      tools.append(hover, pick, close);
      hover.addEventListener("click", () => altHover.toggleArm());
      pick.addEventListener("click", () => domPicker.toggleArm());
      close.addEventListener("click", () => destroy());
      tools.dataset.role = "tools";
      return tools;
    })()
  );
  dock.appendChild(header);
  const toolbar2 = el("div", "dock-toolbar2");
  const layoutLabel = el("span", "layout-pick-label", { text: "layout:" });
  const seg = el("div", "seg");
  const treeBtn = el("button", "", { text: "Tree" });
  const dagBtn = el("button", "active", { text: "DAG" });
  seg.append(treeBtn, dagBtn);
  toolbar2.append(layoutLabel, seg);
  dock.appendChild(toolbar2);
  let layout = "dag";
  const setLayout = (next) => {
    layout = next;
    treeBtn.classList.toggle("active", next === "tree");
    dagBtn.classList.toggle("active", next === "dag");
    dagView = { scale: null, tx: null, ty: null };
    rerenderGraph();
  };
  treeBtn.addEventListener("click", () => setLayout("tree"));
  dagBtn.addEventListener("click", () => setLayout("dag"));
  const dockBody = el("div", "dock-body");
  dock.appendChild(dockBody);
  const graphPane = el("div", "graph-pane");
  dockBody.appendChild(graphPane);
  let selectedView = null;
  let focusedPath = null;
  let hideSinks = true;
  let heatmapMode = false;
  let dagView = { scale: null, tx: null, ty: null };
  const heat = /* @__PURE__ */ new Map();
  let heatDispose = null;
  let heatTick = null;
  const startHeatmap = () => {
    if (heatDispose) return;
    heatDispose = $.trace(rootProxy, {
      log: false,
      onEvent: (e) => {
        const k = (e.key || []).join(".") || "<root>";
        heat.set(k, performance.now());
        if (e.key && e.key.length) {
          for (let i = e.key.length - 1; i >= 0; i--) {
            const ak = e.key.slice(0, i).join(".") || "<root>";
            if (!heat.has(ak) || heat.get(ak) < performance.now() - 100) heat.set(ak, performance.now());
          }
        }
        scheduleRewalk();
      }
    });
    heatTick = setInterval(() => {
      if (layout === "dag") rerenderGraph();
    }, 500);
  };
  const stopHeatmap = () => {
    if (heatDispose) {
      heatDispose();
      heatDispose = null;
    }
    if (heatTick) {
      clearInterval(heatTick);
      heatTick = null;
    }
    heat.clear();
  };
  let rwQueued = false;
  const scheduleRewalk = () => {
    if (rwQueued) return;
    rwQueued = true;
    requestAnimationFrame(() => {
      rwQueued = false;
      rerenderGraph();
      refreshInspector();
    });
  };
  const TERMINAL_KINDS = /* @__PURE__ */ new Set(["dom", "connect", "linked-alias"]);
  const summarizeValue = (v) => {
    if (v === null || v === void 0) return v;
    const t = typeof v;
    if (t === "string") return v.length > 80 ? v.slice(0, 77) + "\u2026" : v;
    if (Array.isArray(v)) return `Array(${v.length})`;
    if (t === "object") return `{ keys: ${Object.keys(v).length} }`;
    return String(v);
  };
  const classifyLocal = (s) => {
    const n = s?.constructor?.name;
    if (n === "DOMSink") return "dom";
    if (n === "ArrSink" || n === "PropSink" || n === "FunctionSink") return "connect";
    return "sink";
  };
  function walkGraph(rootProxy2) {
    const rv = rootProxy2?.[view];
    if (!rv) return null;
    const seen = /* @__PURE__ */ new WeakSet();
    const walk2 = (v, parent) => {
      if (seen.has(v)) {
        return { key: [...v.key], kind: "cycle", children: [], sinks: [], _view: v, _parent: parent };
      }
      seen.add(v);
      if ("src" in v && v.src && v.src !== v) {
        return {
          key: [...v.key],
          name: v.name,
          kind: "linked-alias",
          aliasOf: v.src.key ? [...v.src.key] : [],
          children: [],
          sinks: [],
          _view: v,
          _parent: parent
        };
      }
      const node = {
        key: [...v.key],
        name: v.name,
        kind: v.p ? "child" : "root",
        value: summarizeValue(v.value),
        children: [],
        sinks: [],
        _view: v,
        _parent: parent
      };
      v.each?.((_n, child) => node.children.push(walk2(child, node)));
      v.sink?.((s) => {
        if (s && typeof s === "object" && s.view) {
          const opNode = walk2(s.view, node);
          opNode.kind = "operator";
          opNode.ctor = s.constructor.name;
          node.sinks.push(opNode);
        } else if (s && typeof s === "object") {
          node.sinks.push({
            key: [...v.key],
            kind: classifyLocal(s),
            ctor: s.constructor?.name || "anonymous",
            children: [],
            sinks: [],
            _sink: s,
            _parent: node
          });
        }
      });
      return node;
    };
    return walk2(rv, null);
  }
  function buildChain(node) {
    const segments = [];
    let cur = node;
    while (cur) {
      segments.unshift(cur);
      cur = cur._parent;
    }
    if (segments.length === 0) return "?";
    let s = "";
    for (let i = 0; i < segments.length; i++) {
      const seg2 = segments[i];
      if (i === 0) s += seg2.name || "root";
      else if (seg2.kind === "operator") s += `.${methodOfCtor(seg2.ctor)}()`;
      else if (seg2.kind === "child") s += `.${seg2.name ?? "?"}`;
      else if (seg2.kind === "linked-alias") s += `~>${(seg2.aliasOf || []).join(".") || "root"}`;
      else if (seg2.kind === "cycle") s += "\u21BB";
      else s += `[${seg2.kind}]`;
    }
    return s;
  }
  function formatLiveValue(v, maxLen = 220) {
    if (v === void 0) return "undefined";
    if (v === null) return "null";
    const t = typeof v;
    if (t === "string") {
      const trimmed = v.length > maxLen ? v.slice(0, maxLen) + "\u2026" : v;
      return JSON.stringify(trimmed);
    }
    if (t === "number" || t === "bigint" || t === "boolean") return String(v);
    if (Array.isArray(v)) {
      if (v.length === 0) return "[]";
      const previews = v.slice(0, 4).map((x) => "  " + formatLiveValue(x, 60));
      return `Array(${v.length}) [
${previews.join(",\n")}${v.length > 4 ? ",\n  \u2026" : ""}
]`;
    }
    if (t === "object") {
      const keys = Object.keys(v);
      if (keys.length === 0) return "{}";
      const previews = keys.slice(0, 4).map((k) => `  ${k}: ${formatLiveValue(v[k], 60)}`);
      return `{
${previews.join(",\n")}${keys.length > 4 ? ",\n  \u2026" : ""}
}`;
    }
    return String(v);
  }
  function valueTypeLabel(v) {
    if (v === void 0) return "undefined";
    if (v === null) return "null";
    if (Array.isArray(v)) return `Array(${v.length})`;
    const t = typeof v;
    if (t === "object") return `Object \xB7 ${Object.keys(v).length} key${Object.keys(v).length === 1 ? "" : "s"}`;
    return t[0].toUpperCase() + t.slice(1);
  }
  function propSinkDomTarget(s) {
    if (!s || s.constructor?.name !== "PropSink") return null;
    const obj = s.obj;
    if (!obj) return null;
    if (obj.parent && obj.parent.nodeType) {
      const ctor = obj.constructor?.name || "";
      let label;
      switch (ctor) {
        case "Text":
          label = "textContent";
          break;
        case "Attr":
          label = `[${obj.name}]`;
          break;
        case "Class":
          label = `.${obj.name}`;
          break;
        case "ID":
          label = "#id";
          break;
        case "Style":
          label = `style.${obj.name}`;
          break;
        default:
          label = `${ctor || "prop"}.${s.prop}`;
      }
      return { el: obj.parent, kind: ctor.toLowerCase() || "prop", label };
    }
    if (obj.nodeType) return { el: obj, kind: "prop", label: `.${s.prop}` };
    return null;
  }
  function collectBindings(liveView) {
    const dom = [];
    const others = [];
    if (!liveView) return { dom, others };
    const seen = /* @__PURE__ */ new WeakSet();
    const recurse = (v, viaLabel) => {
      if (!v || seen.has(v)) return;
      seen.add(v);
      v.sink?.((s) => {
        if (!s || typeof s !== "object") return;
        if (s.constructor?.name === "DOMSink" && s.parent?.classList) {
          dom.push({ el: s.parent, via: viaLabel, kind: "iteration", label: "children iteration" });
          return;
        }
        const propTarget = propSinkDomTarget(s);
        if (propTarget) {
          dom.push({ el: propTarget.el, via: viaLabel, kind: propTarget.kind, label: propTarget.label });
          return;
        }
        if (s.view) {
          const ctor = s.constructor?.name || "op";
          const lbl = viaLabel ? `${viaLabel} \u2192 ${ctor}` : ctor;
          recurse(s.view, lbl);
          return;
        }
        const n = s.constructor?.name;
        if (n === "ArrSink" || n === "PropSink" || n === "FunctionSink") {
          others.push({ kind: "connect", ctor: n, via: viaLabel });
        }
      });
    };
    recurse(liveView, "");
    return { dom, others };
  }
  const rerenderGraph = () => {
    graphPane.innerHTML = "";
    const tree = walkGraph(rootProxy);
    if (!tree) return;
    if (layout === "tree") graphPane.appendChild(renderTree(tree));
    else graphPane.appendChild(renderDag(tree));
  };
  const isTerm = (n) => TERMINAL_KINDS.has(n.kind);
  const termCountDeep = (n) => {
    let c = 0;
    const stack = [n];
    while (stack.length) {
      const x = stack.pop();
      for (const s of x.sinks || []) {
        if (isTerm(s)) c++;
        else stack.push(s);
      }
    }
    return c;
  };
  function renderTree(node, depth2 = 0) {
    const sinksAll = node.sinks || [];
    const visibleSinks = hideSinks ? sinksAll.filter((s) => !TERMINAL_KINDS.has(s.kind)) : sinksAll;
    let hiddenTerm = 0;
    if (hideSinks) {
      for (const s of sinksAll) {
        if (TERMINAL_KINDS.has(s.kind)) {
          hiddenTerm++;
          hiddenTerm += termCountDeep(s);
        }
      }
    }
    const wrap = el("div", "tnode" + (depth2 === 0 ? " root" : ""));
    const row = el("div", "tnode-row");
    row._view = node._view;
    if (selectedView && selectedView === node._view) row.classList.add("selected");
    const hasKids = visibleSinks.length > 0;
    if (hasKids) row.append(el("span", "caret", { text: "\u25BE" }));
    row.append(
      el("span", `kind kind-${node.kind}`, { text: shortKind(node) }),
      el("span", "name", { text: nodeLabel(node) })
    );
    if (hiddenTerm > 0) {
      const chip = el("span", "tnode-chip", { text: `\u2192${hiddenTerm}` });
      chip.title = `${hiddenTerm} DOM/connect sink(s) \u2014 click the node, then look at the Bound DOM section in the inspector to see which elements they drive`;
      row.append(chip);
    }
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      selectedView = node._view;
      openInspector(node);
      markSelection();
    });
    wrap.append(row);
    if (hasKids) {
      const kids = el("div", "tnode-kids");
      for (const s of visibleSinks) kids.appendChild(renderTree(s, depth2 + 1));
      wrap.append(kids);
    }
    return wrap;
  }
  function renderDag(tree) {
    const nodes = [];
    const edges = [];
    const sinkChips = /* @__PURE__ */ new Map();
    const visit = (n, depth2, path) => {
      if (n.kind === "cycle") return null;
      const id = nodes.length;
      nodes.push({ ...n, _depth: depth2, _path: path });
      let hidden = 0;
      let sinkIdx = 0;
      for (const s of n.sinks || []) {
        if (s.kind === "cycle") continue;
        if (hideSinks && TERMINAL_KINDS.has(s.kind)) {
          hidden++;
          hidden += termCountDeep(s);
          continue;
        }
        const childId = visit(s, depth2 + 1, path ? `${path}/${sinkIdx}` : `${sinkIdx}`);
        if (childId != null) edges.push([id, childId]);
        sinkIdx++;
      }
      if (hidden > 0) sinkChips.set(id, hidden);
      return id;
    };
    visit(tree, 0, "");
    if (nodes.length === 0) return el("div", "dag-empty", { text: "no operators on this root" });
    const byDepth = [];
    nodes.forEach((n, i) => {
      (byDepth[n._depth] ||= []).push(i);
    });
    const W = 100, H = 30, GX = 22, GY = 32, P = 16;
    const pos = [];
    byDepth.forEach((row, d) => {
      row.forEach((i, c) => {
        pos[i] = { x: P + c * (W + GX), y: P + d * (H + GY) };
      });
    });
    const cols = byDepth.reduce((m, r) => Math.max(m, (r || []).length), 0);
    const numRows = byDepth.length;
    const contentW = P * 2 + cols * W + Math.max(0, cols - 1) * GX;
    const contentH = P * 2 + numRows * H + Math.max(0, numRows - 1) * GY;
    let focusSet = null;
    if (focusedPath != null) {
      focusSet = /* @__PURE__ */ new Set();
      nodes.forEach((n, i) => {
        if (n._path === focusedPath) focusSet.add(i);
        else if (n._path === "") focusSet.add(i);
        else if ((focusedPath + "/").startsWith(n._path + "/")) focusSet.add(i);
        else if (n._path.startsWith(focusedPath + "/")) focusSet.add(i);
      });
    }
    const outer = el("div", "dag-outer");
    const canvas = el("div", "dag-canvas");
    Object.assign(canvas.style, { width: `${contentW}px`, height: `${contentH}px` });
    outer.appendChild(canvas);
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", contentW);
    svg.setAttribute("height", contentH);
    svg.setAttribute("class", "dag-edges");
    for (const [a, b] of edges) {
      const A = pos[a], B = pos[b];
      if (!A || !B) continue;
      const x1 = A.x + W / 2, y1 = A.y + H, x2 = B.x + W / 2, y2 = B.y, cy = (y1 + y2) / 2;
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", `M ${x1} ${y1} C ${x1} ${cy}, ${x2} ${cy}, ${x2} ${y2}`);
      if (focusSet && !(focusSet.has(a) && focusSet.has(b))) p.setAttribute("opacity", "0.08");
      svg.appendChild(p);
    }
    canvas.append(svg);
    const HEAT_WINDOW = 5e3;
    nodes.forEach((n, i) => {
      const p = pos[i] || { x: 0, y: 0 };
      const dimmed = focusSet && !focusSet.has(i);
      const isFocus = n._path === focusedPath;
      const isSelected = selectedView && selectedView === n._view;
      const cls = `dnode kind-${n.kind}` + (isSelected ? " selected" : "") + (dimmed ? " dimmed" : "") + (isFocus ? " focus-root" : "");
      const node = el("div", cls);
      node._view = n._view;
      Object.assign(node.style, { left: `${p.x}px`, top: `${p.y}px`, width: `${W}px`, height: `${H}px` });
      if (heatmapMode) {
        const t = heat.get(nodeKeyOf(n));
        const age = t ? performance.now() - t : Infinity;
        if (age > HEAT_WINDOW) node.style.opacity = "0.4";
        else {
          const h = 1 - age / HEAT_WINDOW;
          node.style.boxShadow = `0 0 ${Math.round(2 + 12 * h)}px rgba(155,227,168,${0.25 + 0.55 * h})`;
          node.style.borderColor = "#9be3a8";
        }
      }
      node.append(
        el("div", "dnode-label", { text: nodeLabel(n) }),
        el("div", "dnode-sub", { text: shortKind(n) })
      );
      const chipCount = sinkChips.get(i);
      if (chipCount) {
        const chip = el("span", "dnode-chip", { text: `\u2192${chipCount}` });
        chip.title = `${chipCount} DOM/connect sink(s). Click the node \u2014 the inspector's "Bound DOM" section shows each one.`;
        node.append(chip);
      }
      node.title = `${nodeLabel(n)} \xB7 ${n.kind}${n.ctor ? " \xB7 " + n.ctor : ""}
shift-click to focus`;
      node.addEventListener("click", (e) => {
        e.stopPropagation();
        if (e.shiftKey) {
          focusedPath = focusedPath === n._path ? null : n._path;
          rerenderGraph();
          return;
        }
        selectedView = n._view;
        openInspector(n);
        markSelection();
      });
      canvas.append(node);
    });
    const tools = el("div", "dag-tools");
    const mkTool = (txt, title, fn) => {
      const b = el("button", "", { text: txt });
      b.title = title;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        fn();
      });
      return b;
    };
    const mkCheck = (label, checked, title, fn) => {
      const w = el("label", "dag-check");
      w.title = title;
      const cb = el("input", "", { attrs: { type: "checkbox" } });
      cb.checked = checked;
      cb.addEventListener("change", (e) => {
        e.stopPropagation();
        fn(cb.checked);
      });
      w.append(cb, document.createTextNode(" " + label));
      return w;
    };
    tools.append(
      mkCheck("sinks", !hideSinks, "show terminal sinks as nodes (off = collapsed to \u2192N chip)", (v) => {
        hideSinks = !v;
        rerenderGraph();
      }),
      mkCheck("\u{1F525}", heatmapMode, "colour nodes by recent activity", (v) => {
        heatmapMode = v;
        if (heatmapMode) startHeatmap();
        else stopHeatmap();
        rerenderGraph();
      }),
      el("span", "dag-sep")
    );
    if (focusedPath != null) {
      const focusedNode = nodes.find((n) => n._path === focusedPath);
      const lbl = focusedNode ? nodeLabel(focusedNode) : focusedPath;
      const bc = el("span", "dag-focus");
      bc.append(
        el("span", "", { text: "focus: " }),
        el("span", "dag-focus-key", { text: lbl.length > 22 ? lbl.slice(0, 20) + "\u2026" : lbl })
      );
      const clear = mkTool("\u2715", "clear focus", () => {
        focusedPath = null;
        rerenderGraph();
      });
      clear.classList.add("dag-focus-clear");
      bc.append(clear);
      tools.append(bc, el("span", "dag-sep"));
    }
    const scaleLbl = el("span", "dag-scale", { text: "100%" });
    tools.append(
      mkTool("\u26F6", "fit to view", () => fit()),
      mkTool("1:1", "reset to 100%", () => {
        scale = 1;
        tx = 0;
        ty = 0;
        apply();
      }),
      mkTool("+", "zoom in", () => zoomAt(0.5, 0.5, 1.25)),
      mkTool("\u2212", "zoom out", () => zoomAt(0.5, 0.5, 0.8)),
      scaleLbl
    );
    outer.appendChild(tools);
    let scale = dagView.scale ?? 1;
    let tx = dagView.tx ?? 0;
    let ty = dagView.ty ?? 0;
    const apply = () => {
      canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
      scaleLbl.textContent = `${Math.round(scale * 100)}%`;
      dagView.scale = scale;
      dagView.tx = tx;
      dagView.ty = ty;
    };
    const fit = () => {
      const r = outer.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const sx = (r.width - 24) / contentW;
      const sy = (r.height - 24) / contentH;
      scale = Math.min(sx, sy, 1);
      tx = (r.width - contentW * scale) / 2;
      ty = (r.height - contentH * scale) / 2;
      apply();
    };
    const zoomAt = (relX, relY, factor) => {
      const r = outer.getBoundingClientRect();
      const cx = r.width * relX;
      const cy = r.height * relY;
      const ns = Math.max(0.15, Math.min(4, scale * factor));
      tx = cx - (cx - tx) * (ns / scale);
      ty = cy - (cy - ty) * (ns / scale);
      scale = ns;
      apply();
    };
    let dragging = false, lastX = 0, lastY = 0, downAt = null;
    outer.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".dnode") || e.target.closest(".dag-tools")) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      downAt = { x: e.clientX, y: e.clientY };
      outer.setPointerCapture(e.pointerId);
      outer.classList.add("panning");
    });
    outer.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      tx += e.clientX - lastX;
      ty += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      apply();
    });
    const endPan = (e) => {
      if (!dragging) return;
      dragging = false;
      try {
        outer.releasePointerCapture(e.pointerId);
      } catch {
      }
      outer.classList.remove("panning");
    };
    outer.addEventListener("pointerup", endPan);
    outer.addEventListener("pointercancel", endPan);
    outer.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = outer.getBoundingClientRect();
      const factor = e.deltaY > 0 ? 0.88 : 1.14;
      zoomAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, factor);
    }, { passive: false });
    outer.addEventListener("click", (e) => {
      if (e.target.closest(".dnode") || e.target.closest(".dag-tools")) return;
      const moved = downAt && Math.abs(e.clientX - downAt.x) + Math.abs(e.clientY - downAt.y) > 4;
      if (moved) return;
      if (focusedPath != null) {
        focusedPath = null;
        rerenderGraph();
      }
    });
    if (dagView.scale == null) requestAnimationFrame(fit);
    else apply();
    return outer;
  }
  function markSelection() {
    for (const r of root.querySelectorAll(".tnode-row")) {
      r.classList.toggle("selected", selectedView != null && r._view === selectedView);
    }
    for (const r of root.querySelectorAll(".dnode")) {
      r.classList.toggle("selected", selectedView != null && r._view === selectedView);
    }
  }
  const EVENTS_MAX = 500;
  const eventsRing = [];
  const ringState = { offset: 0 };
  const lastEventByKey = /* @__PURE__ */ new Map();
  const evSubscribers = /* @__PURE__ */ new Set();
  const traceDispose = $.trace(rootProxy, {
    log: false,
    onEvent: (e) => {
      const t = performance.now();
      const k = (e.key || []).join(".") || "<root>";
      const ev = { t, verb: e.verb, key: k };
      eventsRing.push(ev);
      if (eventsRing.length > EVENTS_MAX) {
        eventsRing.shift();
        ringState.offset++;
      }
      lastEventByKey.set(k, t);
      for (const fn of evSubscribers) {
        try {
          fn(ev);
        } catch {
        }
      }
      scheduleRewalk();
    }
  });
  function eventsForKey(key, windowMs = 6e4) {
    const cutoff = performance.now() - windowMs;
    const out = [];
    for (let i = eventsRing.length - 1; i >= 0; i--) {
      const e = eventsRing[i];
      if (e.t < cutoff) break;
      if (e.key === key) out.push(e);
    }
    return out;
  }
  rerenderGraph();
  const splitter = el("div", "splitter");
  splitter.title = "drag to resize";
  dockBody.append(splitter);
  const insp = el("section", "inspector", { hidden: true });
  dockBody.append(insp);
  let dragSplitter = null;
  splitter.addEventListener("pointerdown", (e) => {
    if (insp.hidden) return;
    dragSplitter = { startX: e.clientX, startW: insp.getBoundingClientRect().width };
    splitter.setPointerCapture(e.pointerId);
    splitter.classList.add("dragging");
    e.preventDefault();
  });
  splitter.addEventListener("pointermove", (e) => {
    if (!dragSplitter) return;
    const dx = e.clientX - dragSplitter.startX;
    const w = Math.max(200, Math.min(700, dragSplitter.startW - dx));
    insp.style.width = w + "px";
  });
  const endDrag = (e) => {
    if (!dragSplitter) return;
    dragSplitter = null;
    splitter.classList.remove("dragging");
    try {
      splitter.releasePointerCapture(e.pointerId);
    } catch {
    }
  };
  splitter.addEventListener("pointerup", endDrag);
  splitter.addEventListener("pointercancel", endDrag);
  insp.append(
    (() => {
      const h = el("header", "insp-header");
      const t = el("span", "insp-title", { text: "" });
      const x = mkBtn("Close \u2715", "close (Esc)");
      x.classList.add("close-btn");
      x.addEventListener("click", closeInspector);
      h.append(t, x);
      h.dataset.role = "header";
      return h;
    })()
  );
  const inspTabs = el("nav", "insp-tabs");
  const inspBody = el("div", "insp-body");
  insp.append(inspTabs, inspBody);
  let activeTab = "inspect";
  for (const name of TABS) {
    const b = el("button", name === activeTab ? "active" : "", { text: name });
    b.addEventListener("click", () => {
      activeTab = name;
      renderInspectorBody();
      markTabs();
    });
    inspTabs.append(b);
  }
  function markTabs() {
    inspTabs.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.textContent === activeTab));
  }
  let currentInspectNode = null;
  let traceForInsp = null;
  let profileHandle = null;
  let profileTimer = null;
  let evTickTimer = null;
  function openInspector(node) {
    currentInspectNode = node;
    insp.hidden = false;
    dock.classList.add("with-inspector");
    insp.querySelector(".insp-title").textContent = nodeLabel(node) + "  \xB7 " + node.kind;
    renderInspectorBody();
  }
  function closeInspector() {
    insp.hidden = true;
    dock.classList.remove("with-inspector");
    selectedView = null;
    markSelection();
    currentInspectNode = null;
    if (traceForInsp) {
      traceForInsp();
      traceForInsp = null;
    }
    if (profileHandle) {
      profileHandle.stop();
      profileHandle = null;
    }
    if (profileTimer) {
      clearInterval(profileTimer);
      profileTimer = null;
    }
    if (evTickTimer) {
      clearInterval(evTickTimer);
      evTickTimer = null;
    }
  }
  function refreshInspector() {
    if (insp.hidden || !currentInspectNode) return;
    if (activeTab !== "inspect") return;
    renderInspectorBody();
  }
  function renderInspectorBody() {
    inspBody.innerHTML = "";
    if (!currentInspectNode) return;
    if (activeTab === "inspect") return renderInspectTab();
    if (activeTab === "events") return renderEventsTab();
    if (activeTab === "profile") return renderProfileTab();
  }
  function renderInspectTab() {
    if (traceForInsp) {
      traceForInsp();
      traceForInsp = null;
    }
    if (profileHandle) {
      profileHandle.stop();
      profileHandle = null;
    }
    if (profileTimer) {
      clearInterval(profileTimer);
      profileTimer = null;
    }
    if (evTickTimer) {
      clearInterval(evTickTimer);
      evTickTimer = null;
    }
    const n = currentInspectNode;
    const liveView = n._view;
    const liveValue = liveView?.value;
    const nodeKey = nodeKeyOf(n);
    const mkCard = (cls, title, populate) => {
      const card = el("div", `insp-card insp-card-${cls}`);
      card.append(el("div", "card-title", { text: title }));
      const body = el("div", "card-body");
      populate(body);
      card.append(body);
      return card;
    };
    inspBody.append(mkCard("identity", "IDENTITY", (body) => {
      body.append(
        el("div", "card-headline", { text: buildChain(n) }),
        el("div", "card-sub", { text: `${n.ctor || n.kind}${n.ctor ? " \xB7 " + n.kind : ""}` })
      );
    }));
    inspBody.append(mkCard("value", "CURRENT VALUE", (body) => {
      body.append(el("pre", "card-value", { text: formatLiveValue(liveValue) }));
      const lastT = lastEventByKey.get(nodeKey);
      const ageSec = lastT ? (performance.now() - lastT) / 1e3 : null;
      const stab = ageSec == null ? "no events recorded" : ageSec < 1 ? `just updated` : ageSec < 60 ? `stable for ${ageSec.toFixed(1)}s` : ageSec < 3600 ? `stable for ${Math.round(ageSec / 60)}m` : "stable >1h";
      body.append(el("div", "card-sub", { text: `${valueTypeLabel(liveValue)} \xB7 ${stab}` }));
    }));
    inspBody.append(mkCard("connections", "CONNECTIONS", (body) => {
      const parent = n._parent;
      const inRow = el("div", "conn-row");
      inRow.append(
        el("span", "conn-dir", { text: "\u2191 in" }),
        el("span", "conn-detail", { text: parent ? buildChain(parent) : "(this is a root)" })
      );
      body.append(inRow);
      const bindings2 = collectBindings(liveView);
      const opSinks = (n.sinks || []).filter((s) => s.kind === "operator").length;
      const outRow = el("div", "conn-row");
      outRow.append(
        el("span", "conn-dir", { text: "\u2193 out" }),
        el("span", "conn-detail", {
          text: `${bindings2.dom.length} DOM binding${bindings2.dom.length === 1 ? "" : "s"} \xB7 ${opSinks} operator sink${opSinks === 1 ? "" : "s"}` + (bindings2.others.length ? ` \xB7 ${bindings2.others.length} other` : "")
        })
      );
      body.append(outRow);
    }));
    inspBody.append(mkCard("activity", "ACTIVITY", (body) => {
      const recent = eventsForKey(nodeKey, 6e4);
      body.append(el("div", "card-stat", { text: `${recent.length} event${recent.length === 1 ? "" : "s"} in last 60s` }));
      if (recent.length > 0) {
        const verbCounts = {};
        for (const e of recent) verbCounts[e.verb] = (verbCounts[e.verb] || 0) + 1;
        const verbsLine = el("div", "card-verbs");
        for (const [v, c] of Object.entries(verbCounts).sort((a, b) => b[1] - a[1]).slice(0, 6)) {
          const klass = v.startsWith("XU") || v.startsWith("BU") ? "update" : v.startsWith("BI") ? "insert" : v.startsWith("XR") || v.startsWith("BR") ? "remove" : v.startsWith("BMV") ? "move" : "";
          verbsLine.append(el("span", `verb-pill ${klass}`, { text: `${v}\xD7${c}` }));
        }
        body.append(verbsLine);
        const last = recent[0];
        const ago = ((performance.now() - last.t) / 1e3).toFixed(1);
        body.append(el("div", "card-sub", { text: `most recent: ${last.verb} \xB7 ${ago}s ago` }));
      } else {
        body.append(el("div", "card-sub", { text: "no recent events on this key" }));
      }
    }));
    const bindings = collectBindings(liveView);
    const total = bindings.dom.length + bindings.others.length;
    const section = el("div", "bound-section");
    const head = el("div", "bound-head");
    head.append(
      el("span", "bound-title", { text: "Bound DOM" }),
      el("span", "bound-count", { text: total === 0 ? "(none)" : `(${bindings.dom.length} dom${bindings.others.length ? ` \xB7 ${bindings.others.length} other` : ""})` })
    );
    if (bindings.dom.length > 0) {
      const allBtn = el("button", "bound-all", { text: "flash all" });
      allBtn.addEventListener("click", () => flashElements(bindings.dom.map((b) => b.el), 1500));
      head.append(allBtn);
    }
    section.append(head);
    if (!liveView) {
      const note = el("div", "bound-note", { text: "No live view found for this graph node. Try clicking a node that has a known kind/ctor." });
      section.append(note);
    } else if (total === 0) {
      const note = el("div", "bound-note", { text: "No DOM elements are bound to this view yet." });
      section.append(note);
    } else {
      const list = el("ul", "bound-list");
      const MAX = 12;
      for (const { el: target, via, kind, label } of bindings.dom.slice(0, MAX)) {
        const row = el("li", "bound-row");
        const left = el("div", "bound-left");
        const tagLine = el("div", "bound-tagline");
        tagLine.append(
          el("span", "bound-tag", { text: tagDescriptor(target) }),
          el("span", "bound-prop", { text: " \xB7 " + (label || kind || "") })
        );
        left.append(
          tagLine,
          el("span", "bound-snippet", { text: textSnippet(target) })
        );
        if (via) {
          left.append(el("div", "bound-via", { text: `via ${via}` }));
        }
        const right = el("div", "bound-right");
        const flashBtn = el("button", "", { text: "flash" });
        flashBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          flashElements([target], 1200);
        });
        const scrollBtn = el("button", "", { text: "scroll" });
        scrollBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          try {
            target.scrollIntoView({ block: "center", behavior: "smooth" });
          } catch {
          }
          flashElements([target], 1500);
        });
        right.append(flashBtn, scrollBtn);
        row.append(left, right);
        list.append(row);
      }
      if (bindings.dom.length > MAX) {
        list.append(el("li", "bound-more", { text: `\u2026 and ${bindings.dom.length - MAX} more` }));
      }
      for (const o of bindings.others.slice(0, 5)) {
        const row = el("li", "bound-row bound-other");
        row.append(
          el("span", "bound-tag", { text: `[${o.ctor}]` }),
          el("span", "bound-snippet", { text: `non-DOM sink${o.via ? " \xB7 via " + o.via : ""}` })
        );
        list.append(row);
      }
      section.append(list);
    }
    inspBody.append(section);
  }
  function tagDescriptor(el2) {
    let s = el2.tagName ? el2.tagName.toLowerCase() : "?";
    if (el2.id) s += "#" + el2.id;
    const cls = el2.className && typeof el2.className === "string" ? el2.className.trim().split(/\s+/) : [];
    if (cls.length) s += "." + cls.slice(0, 2).join(".");
    if (cls.length > 2) s += `.+${cls.length - 2}`;
    return s;
  }
  function textSnippet(el2) {
    let t = el2.textContent || "";
    t = t.trim().replace(/\s+/g, " ");
    if (!t) {
      if (el2.value != null) t = String(el2.value);
      else t = "(empty)";
    }
    return t.length > 38 ? `"${t.slice(0, 36)}\u2026"` : `"${t}"`;
  }
  const flashStates = /* @__PURE__ */ new WeakMap();
  function flashElements(els, ms = 1200) {
    for (const el2 of els) {
      let state = flashStates.get(el2);
      if (!state) {
        state = {
          origOutline: el2.style.outline || "",
          origOutlineOffset: el2.style.outlineOffset || "",
          gen: 0
        };
        flashStates.set(el2, state);
      }
      state.gen++;
      const myGen = state.gen;
      el2.style.outline = "2px solid #9be3a8";
      el2.style.outlineOffset = "2px";
      setTimeout(() => {
        const cur = flashStates.get(el2);
        if (!cur || cur.gen !== myGen) return;
        el2.style.outline = cur.origOutline;
        el2.style.outlineOffset = cur.origOutlineOffset;
        flashStates.delete(el2);
      }, ms);
    }
  }
  function renderEventsTab() {
    if (profileHandle) {
      profileHandle.stop();
      profileHandle = null;
    }
    if (profileTimer) {
      clearInterval(profileTimer);
      profileTimer = null;
    }
    const n = currentInspectNode;
    const liveView = n?._view;
    if (!liveView) {
      inspBody.append(el("p", "muted", { text: "No live view bound \u2014 pick a node from the graph." }));
      return;
    }
    const v0 = liveView.value;
    const t0 = typeof v0;
    const isScalar = v0 === null || v0 === void 0 || t0 === "number" || t0 === "string" || t0 === "boolean";
    const isNumeric = t0 === "number" || t0 === "boolean";
    const lvk = liveView.key.join(".") || "<root>";
    const matches = (k) => {
      if (k === lvk) return true;
      if (lvk === "<root>") return true;
      return k.startsWith(lvk + ".");
    };
    const ctrls = el("div", "ev-controls");
    let paused = false;
    const playBtn = mkBtn("\u23F8 pause", "pause/resume capture");
    const clearBtn = el("button", "", { text: "clear" });
    const debugBadge = el("span", "ev-debug", { text: "0 events" });
    ctrls.append(playBtn, clearBtn, debugBadge);
    inspBody.append(ctrls);
    const body = el("div", "ev-body");
    inspBody.append(body);
    let totalSeen = 0;
    const samples = [];
    const eventsBuf = [];
    if (isScalar) samples.push({ t: performance.now(), v: v0, verb: "init" });
    debugBadge.textContent = `key=${liveView.key && liveView.key.length ? liveView.key.join(".") : "<root>"} \xB7 ctor=${liveView.res?.constructor?.name || "?"} \xB7 0 events`;
    let consumedAbsIdx = ringState.offset + eventsRing.length;
    const drainRing = () => {
      let added = 0;
      const totalPushed = ringState.offset + eventsRing.length;
      if (consumedAbsIdx < ringState.offset) consumedAbsIdx = ringState.offset;
      for (; consumedAbsIdx < totalPushed; consumedAbsIdx++) {
        const ev = eventsRing[consumedAbsIdx - ringState.offset];
        if (!matches(ev.key)) continue;
        added++;
        if (isScalar) {
          samples.push({ t: ev.t, v: liveView.value, verb: ev.verb });
          if (samples.length > 500) samples.shift();
        } else {
          eventsBuf.push({ t: ev.t, verb: ev.verb, key: ev.key, payload: void 0 });
          if (eventsBuf.length > 500) eventsBuf.shift();
        }
      }
      return added;
    };
    consumedAbsIdx = ringState.offset;
    drainRing();
    playBtn.addEventListener("click", () => {
      paused = !paused;
      playBtn.textContent = paused ? "\u25B6 resume" : "\u23F8 pause";
    });
    clearBtn.addEventListener("click", () => {
      samples.length = 0;
      eventsBuf.length = 0;
      if (isScalar) samples.push({ t: performance.now(), v: liveView.value, verb: "init" });
      totalSeen = 0;
      debugBadge.textContent = "0 events";
      rerender();
    });
    let renderQ = false;
    const rerender = () => {
      if (renderQ) return;
      renderQ = true;
      requestAnimationFrame(() => {
        renderQ = false;
        body.innerHTML = "";
        if (isScalar) renderScalarTimeline(body, liveView, samples, isNumeric);
        else renderCollectionActivity(body, liveView, eventsBuf);
      });
    };
    rerender();
    if (evTickTimer) clearInterval(evTickTimer);
    evTickTimer = setInterval(() => {
      const added = drainRing();
      if (added > 0) {
        totalSeen += added;
        debugBadge.textContent = `key=${lvk} \xB7 ctor=${liveView.res?.constructor?.name || "?"} \xB7 ${totalSeen} events`;
      }
      rerender();
    }, 1e3);
    if (traceForInsp) traceForInsp();
    debugBadge.title = `key=${lvk} \xB7 subscribers=${evSubscribers.size + 1}`;
    const onEv = () => {
      const added = drainRing();
      if (!added) return;
      if (paused) return;
      totalSeen += added;
      debugBadge.textContent = `key=${lvk} \xB7 ctor=${liveView.res?.constructor?.name || "?"} \xB7 ${totalSeen} events`;
      rerender();
    };
    evSubscribers.add(onEv);
    traceForInsp = () => {
      evSubscribers.delete(onEv);
    };
  }
  function renderScalarTimeline(body, liveView, samples, isNumeric) {
    const NS = "http://www.w3.org/2000/svg";
    const W = 320, H = 84, PL = 36, PR = 8, PT = 10, PB = 18;
    const now = performance.now();
    const tMin = now - 6e4;
    const c1 = el("div", "ev-card");
    const hdr = el("div", "ev-card-title");
    hdr.append(
      el("span", "", { text: "VALUE OVER TIME \xB7 LAST 60s" }),
      el("span", "ev-card-current", { text: `now: ${formatValue(liveView.value)}` })
    );
    c1.append(hdr);
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.classList.add("ev-spark");
    const win = samples.filter((s) => s.t >= tMin);
    if (!isNumeric || win.length < 2) {
      const tx = document.createElementNS(NS, "text");
      tx.setAttribute("x", W / 2);
      tx.setAttribute("y", H / 2 + 4);
      tx.setAttribute("text-anchor", "middle");
      tx.setAttribute("class", "ev-spark-empty");
      tx.textContent = !isNumeric ? "non-numeric value \u2014 see changes below" : "watching for changes\u2026";
      svg.appendChild(tx);
    } else {
      const nums = win.map((s) => Number(s.v));
      let vMin = Math.min(...nums), vMax = Math.max(...nums);
      if (vMin === vMax) {
        vMin -= 1;
        vMax += 1;
      }
      const xOf = (t) => PL + (Math.max(t, tMin) - tMin) / 6e4 * (W - PL - PR);
      const yOf = (v) => H - PB - (Number(v) - vMin) / (vMax - vMin) * (H - PT - PB);
      for (const { y, label } of [
        { y: yOf(vMax), label: formatValue(vMax) },
        { y: yOf(vMin), label: formatValue(vMin) }
      ]) {
        const ln = document.createElementNS(NS, "line");
        ln.setAttribute("x1", PL);
        ln.setAttribute("x2", W - PR);
        ln.setAttribute("y1", y);
        ln.setAttribute("y2", y);
        ln.setAttribute("class", "ev-spark-grid");
        svg.appendChild(ln);
        const tx = document.createElementNS(NS, "text");
        tx.setAttribute("x", PL - 4);
        tx.setAttribute("y", y + 3);
        tx.setAttribute("text-anchor", "end");
        tx.setAttribute("class", "ev-spark-axis");
        tx.textContent = label;
        svg.appendChild(tx);
      }
      let d = "";
      for (let i = 0; i < win.length; i++) {
        const s = win[i];
        const x = xOf(s.t), y = yOf(s.v);
        if (i === 0) d += `M ${x} ${y}`;
        else {
          const prev = win[i - 1];
          d += ` L ${x} ${yOf(prev.v)} L ${x} ${y}`;
        }
      }
      const last = win[win.length - 1];
      d += ` L ${xOf(now)} ${yOf(last.v)}`;
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", d);
      path.setAttribute("class", "ev-spark-line");
      svg.appendChild(path);
      const dot = document.createElementNS(NS, "circle");
      dot.setAttribute("cx", xOf(now));
      dot.setAttribute("cy", yOf(last.v));
      dot.setAttribute("r", 3);
      dot.setAttribute("class", "ev-spark-dot");
      svg.appendChild(dot);
    }
    for (const [x, anchor, label] of [
      [PL, "start", "60s ago"],
      [W - PR, "end", "now"]
    ]) {
      const tx = document.createElementNS(NS, "text");
      tx.setAttribute("x", x);
      tx.setAttribute("y", H - 4);
      tx.setAttribute("text-anchor", anchor);
      tx.setAttribute("class", "ev-spark-axis");
      tx.textContent = label;
      svg.appendChild(tx);
    }
    c1.append(svg);
    body.append(c1);
    const c2 = el("div", "ev-card");
    c2.append(el("div", "ev-card-title", { text: "LAST CHANGES" }));
    const real = samples.filter((s) => s.verb !== "init");
    if (!real.length) {
      const empty = el("p", "muted ev-empty", { text: "No changes yet \u2014 interact with the demo and they'll appear here." });
      c2.append(empty);
    } else {
      const ol = el("ol", "ev-trans");
      const rev = real.slice().reverse();
      for (let i = 0; i < rev.length && i < 12; i++) {
        const s = rev[i];
        const idx = samples.indexOf(s);
        const prev = idx > 0 ? samples[idx - 1] : null;
        const li = el("li", "");
        li.append(
          el("span", "ev-trans-time", { text: timeAgo(s.t) }),
          el("span", "ev-trans-delta", { text: `${prev ? formatValue(prev.v) : "\u2014"}  \u2192  ${formatValue(s.v)}` }),
          el("span", `verb-pill ${verbClass(s.verb)}`, { text: friendlyVerb(s.verb) })
        );
        ol.append(li);
      }
      c2.append(ol);
    }
    body.append(c2);
  }
  function renderCollectionActivity(body, liveView, eventsBuf) {
    const now = performance.now();
    const cutoff = now - 6e4;
    const win = eventsBuf.filter((e) => e.t >= cutoff);
    let nIns = 0, nRem = 0, nUpd = 0, nMov = 0;
    const perRow = /* @__PURE__ */ new Map();
    for (const e of win) {
      const c = verbClass(e.verb);
      if (c === "insert") nIns++;
      else if (c === "remove") nRem++;
      else if (c === "update") nUpd++;
      else if (c === "move") nMov++;
      const r = perRow.get(e.key) || { key: e.key, ins: 0, rem: 0, upd: 0, mov: 0, last: 0 };
      if (c === "insert") r.ins++;
      else if (c === "remove") r.rem++;
      else if (c === "update") r.upd++;
      else if (c === "move") r.mov++;
      if (e.t > r.last) r.last = e.t;
      perRow.set(e.key, r);
    }
    const c1 = el("div", "ev-card");
    c1.append(el("div", "ev-card-title", { text: "ACTIVITY \xB7 LAST 60s" }));
    const summary = el("div", "ev-summary");
    if (!nIns && !nRem && !nUpd && !nMov) {
      summary.append(el("span", "muted", { text: "No activity in the last 60s." }));
    } else {
      summary.append(
        el("span", "ev-stat ev-stat-insert", { text: `+${nIns} inserts` }),
        el("span", "ev-stat ev-stat-remove", { text: `\u2212${nRem} removes` }),
        el("span", "ev-stat ev-stat-update", { text: `${nUpd} updates` })
      );
      if (nMov) summary.append(el("span", "ev-stat ev-stat-move", { text: `${nMov} moves` }));
    }
    c1.append(summary);
    body.append(c1);
    const rows = [...perRow.values()].sort((a, b) => b.ins + b.rem + b.upd + b.mov - (a.ins + a.rem + a.upd + a.mov));
    if (rows.length) {
      const c2 = el("div", "ev-card");
      c2.append(el("div", "ev-card-title", { text: "PER-ROW HEAT \xB7 TOP 8" }));
      const max = rows[0].ins + rows[0].rem + rows[0].upd + rows[0].mov;
      const ul = el("ul", "ev-heat");
      for (const r of rows.slice(0, 8)) {
        const total = r.ins + r.rem + r.upd + r.mov;
        const bar = el("div", "ev-heat-bar");
        const seg2 = (cls, n) => {
          if (!n) return;
          const s = el("span", `ev-heat-seg ${cls}`);
          s.style.width = `${n / max * 100}%`;
          bar.append(s);
        };
        seg2("update", r.upd);
        seg2("insert", r.ins);
        seg2("remove", r.rem);
        seg2("move", r.mov);
        const li = el("li", "");
        li.append(
          el("span", "ev-heat-key", { text: r.key }),
          bar,
          el("span", "ev-heat-count", { text: String(total) })
        );
        ul.append(li);
      }
      c2.append(ul);
      body.append(c2);
    }
    if (win.length) {
      const c3 = el("div", "ev-card");
      c3.append(el("div", "ev-card-title", { text: "RECENT CHANGES" }));
      const ol = el("ol", "ev-recent");
      const rev = win.slice(-20).reverse();
      for (const e of rev) {
        const cls = verbClass(e.verb);
        const li = el("li", "");
        li.append(
          el("span", "ev-trans-time", { text: timeAgo(e.t) }),
          el("span", `verb-pill ${cls}`, { text: friendlyVerb(e.verb) }),
          el("span", "ev-recent-key", { text: e.key }),
          el("span", "ev-recent-payload", { text: e.payload === void 0 ? "" : formatValue(e.payload) })
        );
        ol.append(li);
      }
      c3.append(ol);
      body.append(c3);
    }
  }
  function renderProfileTab() {
    if (traceForInsp) {
      traceForInsp();
      traceForInsp = null;
    }
    if (evTickTimer) {
      clearInterval(evTickTimer);
      evTickTimer = null;
    }
    const ctrls = el("div", "ev-controls");
    let running = false;
    const playBtn = mkBtn("\u25B6 start", "start/stop profile");
    const status = el("span", "muted", { text: "idle" });
    ctrls.append(playBtn, status);
    inspBody.append(ctrls);
    const tableWrap = el("div", "prof-wrap");
    inspBody.append(tableWrap);
    const refresh = () => {
      if (!profileHandle) return;
      const r = profileHandle.report();
      tableWrap.innerHTML = "";
      const tbl = el("table", "prof");
      const thead = el("thead", "");
      thead.innerHTML = "<tr><th>operator</th><th>calls</th><th>totalMs</th><th>avgMs</th></tr>";
      tbl.append(thead);
      const tbody = el("tbody", "");
      for (const row of r.byOperator || []) {
        const tr = el("tr", "");
        tr.append(
          el("td", "", { text: row.ctor || row.operator || "?" }),
          el("td", "", { text: String(row.calls ?? 0) }),
          el("td", "", { text: (row.totalMs ?? 0).toFixed(2) }),
          el("td", "", { text: ((row.totalMs || 0) / Math.max(1, row.calls || 1)).toFixed(3) })
        );
        tbody.append(tr);
      }
      tbl.append(tbody);
      tableWrap.append(tbl);
      status.textContent = `events: ${r.totalEvents} \xB7 totalMs: ${(r.totalMs || 0).toFixed(2)}`;
    };
    playBtn.addEventListener("click", () => {
      running = !running;
      if (running) {
        profileHandle = $.profile(rootProxy);
        playBtn.textContent = "\u23F8 stop";
        status.textContent = "recording\u2026";
        profileTimer = setInterval(refresh, 500);
      } else {
        if (profileHandle) profileHandle.stop();
        profileHandle = null;
        if (profileTimer) clearInterval(profileTimer);
        profileTimer = null;
        playBtn.textContent = "\u25B6 start";
        status.textContent = "stopped";
      }
    });
  }
  const altHover = createAltHover(root, host);
  const domPicker = createDomPicker(root, (el2) => {
    const proxy = $.fromDOM(el2);
    if (!proxy) return;
    const liveView = proxy[view];
    let match = findNodeByView(walkGraph(rootProxy), liveView);
    if (!match) {
      match = {
        key: liveView.key ? [...liveView.key] : [],
        name: liveView.name,
        kind: liveView.p ? "child" : "root",
        ctor: liveView.constructor?.name,
        value: liveView.value,
        children: [],
        sinks: [],
        _view: liveView,
        _parent: null
      };
    }
    selectedView = liveView;
    openInspector(match);
    markSelection();
  });
  const onKey = (e) => {
    if (e.key === "Escape") {
      if (!insp.hidden) closeInspector();
      altHover.unpin();
    }
  };
  document.addEventListener("keydown", onKey);
  function destroy() {
    if (traceDispose) traceDispose();
    if (traceForInsp) traceForInsp();
    if (profileHandle) profileHandle.stop();
    if (profileTimer) clearInterval(profileTimer);
    if (evTickTimer) clearInterval(evTickTimer);
    stopHeatmap();
    altHover.destroy();
    domPicker.destroy();
    document.removeEventListener("keydown", onKey);
    host.remove();
  }
  return { destroy, root, host, dock };
}
function el(tag, cls, opts = {}) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (opts.text != null) e.textContent = opts.text;
  if (opts.hidden) e.hidden = true;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) e.setAttribute(k, v);
  return e;
}
function mkBtn(text, title) {
  const b = el("button", "", { text });
  if (title) b.title = title;
  return b;
}
function nodeKeyOf(node) {
  return node.key && node.key.length ? node.key.join(".") : node.name || "<root>";
}
function nodeLabel(n) {
  if (n.kind === "operator") return `.${methodOfCtor(n.ctor)}()`;
  if (n.kind === "root") return "<root>";
  if (n.kind === "child") return n.name ?? "?";
  return n.ctor ?? n.kind;
}
function shortKind(n) {
  return n.ctor || n.kind || "?";
}
function formatValue(v) {
  if (v === void 0) return "undefined";
  if (v === null) return "null";
  if (Array.isArray(v)) return `Array(${v.length})`;
  if (typeof v === "object") {
    const keys = Object.keys(v);
    if (!keys.length) return "{}";
    return `{ ${keys.slice(0, 3).join(", ")}${keys.length > 3 ? ", \u2026" : ""} }`;
  }
  if (typeof v === "string") return v.length > 40 ? `"${v.slice(0, 40)}\u2026"` : `"${v}"`;
  return String(v);
}
function verbClass(v) {
  if (!v) return "";
  if (v.startsWith("XU") || v.startsWith("BU")) return "update";
  if (v.startsWith("BI")) return "insert";
  if (v.startsWith("XR") || v.startsWith("BR")) return "remove";
  if (v.startsWith("BMV")) return "move";
  return "";
}
function friendlyVerb(v) {
  if (!v || v === "init") return "";
  if (v.startsWith("XU") || v.startsWith("BU")) return "updated";
  if (v.startsWith("BI")) return "inserted";
  if (v.startsWith("XR") || v.startsWith("BR")) return "removed";
  if (v.startsWith("BMV")) return "moved";
  return v;
}
function timeAgo(t) {
  const dt = Math.max(0, (performance.now() - t) / 1e3);
  if (dt < 1) return "just now";
  if (dt < 60) return `${Math.floor(dt)}s ago`;
  if (dt < 3600) return `${Math.floor(dt / 60)}m ago`;
  return `${Math.floor(dt / 3600)}h ago`;
}
function findNodeByView(node, liveView) {
  if (!node) return null;
  if (node._view === liveView) return node;
  for (const c of node.children || []) {
    const f = findNodeByView(c, liveView);
    if (f) return f;
  }
  for (const s of node.sinks || []) {
    const f = findNodeByView(s, liveView);
    if (f) return f;
  }
  return null;
}
function createAltHover(panelRoot, panelHost) {
  let altHeld = false, armed = false, pinned = false;
  const layer = document.createElement("div");
  layer.className = "__rp_alt_layer";
  document.body.appendChild(layer);
  const popover = document.createElement("div");
  popover.className = "__rp_alt_pop";
  popover.hidden = true;
  document.body.appendChild(popover);
  const layerStyle = document.createElement("style");
  layerStyle.textContent = `
    .__rp_alt_layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483600; }
    .__rp_alt_pop {
      position: fixed; min-width: 240px; max-width: 320px;
      background: #1a1a1a; color: #e6e6e6; border: 1px solid #9be3a8;
      border-radius: 4px; padding: 8px 10px; z-index: 2147483646;
      font: 11px/1.5 ui-monospace, Menlo, monospace;
      box-shadow: 0 4px 16px rgba(0,0,0,.55); pointer-events: none;
    }
    .__rp_alt_pop.pinned { border-color: #9bb3e3; pointer-events: auto; }
    .__rp_alt_pop .h {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      color: #9bb3e3; font-weight: 600; margin-bottom: 4px; word-break: break-all;
    }
    .__rp_alt_pop .h .x {
      background: transparent; color: #888; border: 1px solid #2a2a2a;
      border-radius: 3px; padding: 1px 6px; cursor: pointer; font: inherit; font-size: 11px;
    }
    .__rp_alt_pop .h .x:hover { color: #e6e6e6; border-color: #9be3a8; }
    .__rp_alt_pop dl { display: grid; grid-template-columns: 50px 1fr; gap: 2px 8px; margin: 0 0 4px; }
    .__rp_alt_pop dt { color: #888; }
    .__rp_alt_pop dd { margin: 0; color: #ddd; }
    .__rp_alt_pop .hint { color: #666; font-size: 10px; }
    .__rp_alt_badge {
      position: absolute;
      font: 10px/1 ui-monospace, monospace;
      background: #9be3a8; color: #0f0f0f;
      padding: 2px 5px; border-radius: 2px;
      pointer-events: none; white-space: nowrap;
      box-shadow: 0 2px 6px rgba(0,0,0,.5);
    }
    .__rp_alt_outline { outline: 1px dashed #9be3a8; outline-offset: 1px; }
    .__rp_alt_hovered { outline: 2px solid #9be3a8 !important; outline-offset: 1px; }
  `;
  document.head.appendChild(layerStyle);
  function findReactiveAncestor(el2) {
    while (el2) {
      if (el2 === panelHost) return null;
      if (el2.__ripple_sink) return el2;
      el2 = el2.parentElement;
    }
    return null;
  }
  function gatherTargets() {
    const out = [];
    document.querySelectorAll("*").forEach((el2) => {
      if (el2.__ripple_sink && el2 !== panelHost && !panelHost.contains(el2)) out.push(el2);
    });
    return out;
  }
  function renderBadges() {
    layer.innerHTML = "";
    for (const el2 of gatherTargets()) {
      el2.classList.add("__rp_alt_outline");
      const r = el2.getBoundingClientRect();
      if (r.width === 0) continue;
      const proxy = $.fromDOM(el2);
      if (!proxy) continue;
      const v = proxy[view];
      const ctor = v?.constructor?.name || "View";
      const badge = document.createElement("div");
      badge.className = "__rp_alt_badge";
      const k = v?.key && v.key.length ? v.key.join(".") : "<root>";
      badge.textContent = `${k} \xB7 ${ctor}`;
      badge.style.left = `${r.right - 6}px`;
      badge.style.top = `${r.top - 8}px`;
      badge.style.transform = "translate(-100%, 0)";
      layer.appendChild(badge);
    }
  }
  function clear() {
    layer.innerHTML = "";
    document.querySelectorAll(".__rp_alt_outline").forEach((e) => e.classList.remove("__rp_alt_outline"));
    document.querySelectorAll(".__rp_alt_hovered").forEach((e) => e.classList.remove("__rp_alt_hovered"));
    if (!pinned) popover.hidden = true;
  }
  function isActive() {
    return altHeld || armed;
  }
  function unpinAndHide() {
    pinned = false;
    popover.classList.remove("pinned");
    popover.hidden = true;
  }
  function updatePopover(el2, x, y) {
    if (pinned) return;
    const proxy = $.fromDOM(el2);
    if (!proxy) {
      popover.hidden = true;
      return;
    }
    const v = proxy[view];
    const ctor = v?.constructor?.name || "View";
    const k = v?.key && v.key.length ? v.key.join(".") : "<root>";
    let sinkCount = 0;
    v?.sink?.(() => {
      sinkCount++;
    });
    popover.innerHTML = `
      <div class="h">
        <span>${k}</span>
        <button class="x" type="button" title="close (Esc)">\u2715</button>
      </div>
      <dl>
        <dt>ctor</dt><dd>${ctor}</dd>
        <dt>sinks</dt><dd>${sinkCount}</dd>
        <dt>value</dt><dd>${formatValue(v?.value)}</dd>
      </dl>
      <div class="hint">click to pin \xB7 click \u2715 or Esc to close \xB7 Alt-release clears</div>
    `;
    const closeBtn = popover.querySelector(".x");
    if (closeBtn) closeBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      unpinAndHide();
    });
    popover.hidden = false;
    const W = popover.offsetWidth || 280, H = popover.offsetHeight || 100;
    const px = x + 16 + W > innerWidth ? x - W - 16 : x + 16;
    const py = y + 16 + H > innerHeight ? y - H - 16 : y + 16;
    popover.style.left = `${Math.max(8, px)}px`;
    popover.style.top = `${Math.max(8, py)}px`;
  }
  const isAltKey = (e) => e.key === "Alt" || e.code === "AltLeft" || e.code === "AltRight";
  const onKeydown = (e) => {
    if (isAltKey(e) && !altHeld) {
      altHeld = true;
      if (!pinned) renderBadges();
      e.preventDefault();
    }
  };
  const onKeyup = (e) => {
    if (isAltKey(e)) {
      altHeld = false;
      if (!armed) clear();
      e.preventDefault();
    }
  };
  const onMove = (e) => {
    if (e.altKey !== altHeld) {
      altHeld = e.altKey;
      if (altHeld && !pinned) renderBadges();
      else if (!altHeld && !armed) clear();
    }
    if (!isActive()) return;
    const t = findReactiveAncestor(e.target);
    document.querySelectorAll(".__rp_alt_hovered").forEach((x) => x.classList.remove("__rp_alt_hovered"));
    if (t) {
      t.classList.add("__rp_alt_hovered");
      updatePopover(t, e.clientX, e.clientY);
    } else {
      if (!pinned) popover.hidden = true;
    }
  };
  const onBlur = () => {
    altHeld = false;
    if (!armed) clear();
  };
  const onClick = (e) => {
    if (!isActive()) return;
    const t = findReactiveAncestor(e.target);
    if (!t) return;
    if (pinned) {
      pinned = false;
      popover.classList.remove("pinned");
      popover.hidden = true;
      return;
    }
    pinned = true;
    popover.classList.add("pinned");
    e.stopPropagation();
    e.preventDefault();
  };
  document.addEventListener("keydown", onKeydown);
  document.addEventListener("keyup", onKeyup);
  document.addEventListener("mousemove", onMove);
  document.addEventListener("click", onClick, true);
  window.addEventListener("blur", onBlur);
  let raf2 = null;
  const refresh = () => {
    if (raf2) return;
    raf2 = requestAnimationFrame(() => {
      raf2 = null;
      if (isActive()) renderBadges();
    });
  };
  window.addEventListener("scroll", refresh, true);
  window.addEventListener("resize", refresh);
  return {
    toggleArm() {
      armed = !armed;
      if (armed) renderBadges();
      else if (!altHeld) clear();
    },
    unpin() {
      unpinAndHide();
    },
    destroy() {
      clear();
      layer.remove();
      popover.remove();
      layerStyle.remove();
      document.removeEventListener("keydown", onKeydown);
      document.removeEventListener("keyup", onKeyup);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("blur", onBlur);
    }
  };
}
function createDomPicker(panelRoot, onPick) {
  let armed = false;
  const onClick = (e) => {
    if (!armed) return;
    e.preventDefault();
    e.stopPropagation();
    armed = false;
    document.body.style.cursor = "";
    onPick(e.target);
  };
  document.addEventListener("click", onClick, true);
  return {
    toggleArm() {
      armed = !armed;
      document.body.style.cursor = armed ? "crosshair" : "";
    },
    destroy() {
      document.removeEventListener("click", onClick, true);
    }
  };
}
function makeStyle() {
  const s = document.createElement("style");
  s.textContent = `
:host { all: initial; }
.dock {
  position: fixed; top: 0; right: 0; bottom: 0; width: 480px;
  background: #1a1a1a; color: #e6e6e6;
  border-left: 1px solid #2a2a2a;
  font: 12px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI";
  display: flex; flex-direction: column;
  z-index: 2147483646;
}
.dock.with-inspector { width: 840px; }
/* Outer resize handle: a thin strip on the left edge. Inline width on .dock
   (set by the drag handler) overrides both the default 480px and the
   .with-inspector 840px \u2014 so once the user has resized, their choice
   persists across inspector open/close. No width transition on .dock: a
   .18s ease-out used to animate the auto-widen, but it also fired after
   each drag-end (committing the new inline width counted as a transition
   from the CSS-rule width), so the dock visibly snapped back partway after
   release. Keeping resize crisp matters more than animating one open. */
.dock-resize {
  position: absolute; top: 0; bottom: 0; left: -3px; width: 7px;
  cursor: col-resize; z-index: 5;
  background: transparent;
  transition: background .12s;
}
.dock-resize:hover,
.dock-resize.dragging { background: rgba(155, 227, 168, 0.35); }
.dock-body {
  flex: 1; min-height: 0;
  display: flex; flex-direction: row;
}
.dock-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; border-bottom: 1px solid #2a2a2a;
  font-weight: 600;
}
.brand { color: #9be3a8; letter-spacing: .03em; }
.tools { display: flex; gap: 4px; }
.tools button {
  width: 28px; height: 26px; background: transparent; color: #888;
  border: 1px solid transparent; border-radius: 4px; cursor: pointer;
  font: inherit;
}
.tools button:hover { color: #e6e6e6; background: #222; border-color: #2a2a2a; }
.dock-toolbar2 {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 12px; background: #222; border-bottom: 1px solid #2a2a2a;
}
.layout-pick-label { color: #888; font-size: 11px; }
.seg {
  margin-left: auto;
  display: inline-flex; gap: 0;
  border: 1px solid #2a2a2a; border-radius: 4px; overflow: hidden;
}
.seg button {
  background: transparent; color: #888; border: none;
  padding: 3px 12px; cursor: pointer; font: inherit; font-size: 11px;
}
.seg button:hover { color: #e6e6e6; }
.seg button.active { background: #1a1a1a; color: #9be3a8; }


.graph-pane { flex: 1; min-width: 0; overflow: auto; padding: 8px 4px; }
.tnode { padding-left: 0; }
.tnode-row {
  display: flex; align-items: center; gap: 8px;
  padding: 3px 8px; border-radius: 4px; cursor: pointer; user-select: none;
}
.tnode-row:hover { background: #222; }
.tnode-row.selected {
  background: #2d3a2d;
  box-shadow: inset 2px 0 0 #9be3a8;
}
.tnode-row.selected .name { color: #9be3a8; font-weight: 600; }
.tnode-row .caret { color: #888; width: 10px; }
.tnode-row .kind {
  font-size: 10px; padding: 1px 6px; border-radius: 2px;
  background: #2a2a2a; color: #888;
}
.tnode-row .kind-root     { background: #2d3a2d; color: #9be3a8; }
.tnode-row .kind-operator { background: #2d3447; color: #9bb3e3; }
.tnode-row .kind-child    { background: #2a2a2a; color: #ccc; }
.tnode-row .kind-dom      { background: #3a2d2d; color: #e39b9b; }
.tnode-row .kind-connect  { background: #3a3727; color: #e3c98e; }
.tnode-row .name { color: #ddd; }
.tnode-row.selected .name { color: #9be3a8; font-weight: 600; }
.tnode-row .sinks { margin-left: auto; color: #666; font-variant-numeric: tabular-nums; }
.tnode-chip {
  margin-left: auto;
  background: #5e7593; color: #0f0f0f;
  border-radius: 8px; padding: 0 6px;
  font: 10px ui-monospace, monospace; line-height: 14px;
}
.tnode-cluster-meta {
  margin-left: auto; color: #cce3a8;
  font: 10px ui-monospace, monospace;
}
.tnode-kids { padding-left: 16px; border-left: 1px dotted #2a2a2a; margin-left: 8px; }

/* dag \u2014 pan + zoom viewport */
.dag-outer {
  position: relative;
  width: 100%; height: 100%;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  background:
    /* faint dot grid so it's obvious you can pan */
    radial-gradient(circle, #2a2a2a 1px, transparent 1px) 0 0 / 24px 24px,
    #141414;
}
.dag-outer.panning { cursor: grabbing; }
.dag-canvas {
  position: absolute; left: 0; top: 0;
  transform-origin: 0 0;
  will-change: transform;
}
.dag-tools {
  position: absolute; top: 8px; right: 8px;
  display: flex; flex-wrap: wrap; gap: 4px; align-items: center;
  background: rgba(26,26,26,.92);
  border: 1px solid #2a2a2a; border-radius: 4px;
  padding: 3px 6px;
  z-index: 2;
  font: 11px ui-monospace, monospace;
  max-width: calc(100% - 16px);
}
.dag-tools button {
  background: transparent; color: #aaa;
  border: none; border-radius: 3px;
  min-width: 24px; height: 22px; cursor: pointer;
  font: inherit; padding: 0 4px;
}
.dag-tools button:hover { background: #222; color: #9be3a8; }
.dag-scale { color: #888; padding: 0 6px 0 4px; min-width: 38px; text-align: right; font-variant-numeric: tabular-nums; }
.dag-check {
  display: inline-flex; align-items: center; gap: 3px;
  color: #aaa; cursor: pointer; padding: 0 4px; user-select: none;
  white-space: nowrap;
}
.dag-check:hover { color: #9be3a8; }
.dag-check input { accent-color: #9be3a8; margin: 0; cursor: pointer; }
.dag-sep { display: inline-block; width: 1px; height: 14px; background: #2a2a2a; margin: 0 2px; }
.dag-focus {
  display: inline-flex; align-items: center; gap: 4px;
  color: #9be3a8; max-width: 240px; overflow: hidden;
  padding: 0 4px;
}
.dag-focus-key { color: #ddd; font-family: ui-monospace, monospace; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dag-focus-clear { color: #9be3a8 !important; }

.dag-edges { position: absolute; left: 0; top: 0; pointer-events: none; }
.dag-edges path { stroke: #5e7593; stroke-width: 1.2; fill: none; opacity: .8; }
.dnode {
  position: absolute; box-sizing: border-box;
  border: 1px solid #2a2a2a; border-radius: 3px;
  background: #1f1f1f; padding: 2px 4px; cursor: pointer;
  display: flex; flex-direction: column; justify-content: center;
  font-size: 10px; line-height: 1.1;
  /* No overflow:hidden \u2014 the \u2192N chip is positioned outside the node bounds
     and was being clipped. The .dnode-label and .dnode-sub children each
     have their own overflow:hidden+ellipsis for text truncation. */
}
.dnode-label { color: #e6e6e6; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; font-size: 10px; }
.dnode-sub   { color: #888; font-size: 9px; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
.dnode.kind-root { background: #2d3a2d; border-color: #3a4f3a; }
.dnode.kind-root .dnode-label { color: #9be3a8; }
.dnode.kind-operator { background: #2d3447; border-color: #3a4760; }
.dnode.kind-operator .dnode-label { color: #9bb3e3; }
.dnode.kind-dom { background: #3a2d2d; border-color: #4d3a3a; }
.dnode.kind-dom .dnode-label { color: #e39b9b; }
.dnode.selected {
  box-shadow: 0 0 0 2px #9be3a8, 0 0 14px rgba(155,227,168,.55);
  z-index: 3;
  border-color: #9be3a8;
}
.dnode:hover { filter: brightness(1.3); z-index: 1; }
.dnode.dimmed { opacity: 0.12; }
.dnode.dimmed:hover { opacity: 0.4; }
.dnode.focus-root {
  box-shadow: 0 0 0 2px #9be3a8, 0 0 18px rgba(155,227,168,.55);
  z-index: 2;
}
.dnode.kind-cluster {
  background: repeating-linear-gradient(135deg, #1f2329, #1f2329 4px, #232730 4px, #232730 8px);
  border: 1px dashed #4a5b3a;
}
.dnode.kind-cluster .dnode-label { color: #cce3a8; }
.dnode.kind-cluster .dnode-sub   { color: #888; font-style: italic; }
.dnode-chip {
  position: absolute; right: -6px; top: -7px;
  background: #5e7593; color: #0f0f0f;
  border-radius: 8px; padding: 1px 5px;
  font: 9px ui-monospace, monospace;
  pointer-events: none;
  box-shadow: 0 1px 3px rgba(0,0,0,.5);
}
/* When focus is active, edges also dim \u2014 done with opacity on the SVG */
.dag-canvas .dag-edges path { transition: opacity .15s; }

/* inspector \u2014 side-by-side column inside the dock-body flex row */
.inspector {
  width: 360px; flex-shrink: 0;
  background: #161616;
  display: flex; flex-direction: column;
  min-width: 0; min-height: 0;
  animation: slideIn .18s ease-out;
}
.inspector[hidden] { display: none; }

/* Vertical splitter between graph pane and inspector. Hidden until the
   inspector is open. Slightly wider hover/active hit-area than the visible
   1px line so dragging doesn't require pixel precision. */
.splitter { display: none; }
.dock.with-inspector .splitter {
  display: block;
  flex-shrink: 0;
  width: 5px;
  background: #2a2a2a;
  cursor: col-resize;
  transition: background .12s;
}
.dock.with-inspector .splitter:hover,
.dock.with-inspector .splitter.dragging { background: #9be3a8; }
@keyframes slideIn { from { transform: translateX(8px); opacity: 0; } to { transform: none; opacity: 1; } }
.insp-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; border-bottom: 1px solid #2a2a2a;
  gap: 8px;
}
.insp-title {
  color: #9be3a8; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
}
.insp-header .close-btn {
  background: #2d3a2d; color: #9be3a8;
  border: 1px solid #3a4f3a; border-radius: 4px;
  padding: 4px 10px; cursor: pointer; font: inherit;
  flex-shrink: 0;
}
.insp-header .close-btn:hover { background: #3a4f3a; color: #e6e6e6; }
.insp-tabs { display: flex; border-bottom: 1px solid #2a2a2a; }
.insp-tabs button {
  flex: 1; background: transparent; color: #888; border: none;
  padding: 7px 4px; cursor: pointer; font-size: 11px;
  border-bottom: 2px solid transparent; text-transform: capitalize;
  font-family: inherit;
}
.insp-tabs button:hover { color: #e6e6e6; }
.insp-tabs button.active { color: #9be3a8; border-bottom-color: #9be3a8; }
.insp-body { flex: 1; overflow: auto; padding: 10px 12px; }
dl.kv { display: grid; grid-template-columns: 80px 1fr; gap: 6px 12px; margin: 0 0 12px; }
dl.kv dt { color: #888; }
dl.kv dd { margin: 0; word-break: break-word; color: #ddd; }
.actions button {
  background: #222; color: #ddd; border: 1px solid #2a2a2a;
  padding: 5px 10px; border-radius: 4px; cursor: pointer; font: inherit;
}
.actions button:hover { border-color: #9be3a8; color: #9be3a8; }

/* \u2500\u2500\u2500 Inspect tab \u2014 card stack \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.insp-card {
  background: #131313; border: 1px solid #2a2a2a; border-radius: 6px;
  margin: 0 0 10px;
  overflow: hidden;
}
.insp-card .card-title {
  padding: 6px 10px;
  background: #181818;
  border-bottom: 1px solid #2a2a2a;
  color: #888; font-size: 10px;
  text-transform: uppercase; letter-spacing: .08em;
}
.insp-card .card-body { padding: 10px 12px; }

.insp-card-identity { border-color: #3a4f3a; }
.insp-card-identity .card-title { background: #1f2a20; color: #9be3a8; }
.insp-card-identity .card-headline {
  color: #9be3a8;
  font: 13px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 600;
  word-break: break-all;
}
.insp-card-identity .card-sub {
  color: #888; font-size: 11px; margin-top: 4px;
}

.insp-card-value pre.card-value {
  margin: 0;
  font: 12px/1.4 ui-monospace, monospace;
  color: #e6e6e6;
  background: #1a1a1a;
  border: 1px solid #2a2a2a; border-radius: 4px;
  padding: 8px 10px;
  max-height: 200px; overflow: auto;
  white-space: pre;
  tab-size: 2;
}
.insp-card-value .card-sub {
  color: #888; font-size: 11px; margin-top: 6px;
}

.insp-card-connections .conn-row {
  display: flex; align-items: center; gap: 10px;
  padding: 4px 0; font-size: 12px;
}
.insp-card-connections .conn-dir {
  color: #9bb3e3; font: 11px ui-monospace, monospace;
  width: 44px; flex-shrink: 0;
}
.insp-card-connections .conn-detail {
  color: #ddd; font: 11px ui-monospace, monospace; word-break: break-all;
}

.insp-card-activity .card-stat {
  color: #e6e6e6; font-size: 12px; margin-bottom: 6px;
  font-variant-numeric: tabular-nums;
}
.insp-card-activity .card-verbs {
  display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px;
}
.insp-card-activity .verb-pill {
  background: #2a2a2a; color: #888;
  font: 10px ui-monospace, monospace;
  padding: 1px 6px; border-radius: 8px;
}
.insp-card-activity .verb-pill.update { background: #2d3447; color: #9bb3e3; }
.insp-card-activity .verb-pill.insert { background: #2d3a2d; color: #9be3a8; }
.insp-card-activity .verb-pill.remove { background: #3a2d2d; color: #e39b9b; }
.insp-card-activity .verb-pill.move   { background: #3a3727; color: #e3c98e; }
.insp-card-activity .card-sub {
  color: #888; font-size: 11px;
}

/* \u2500\u2500\u2500 Bound DOM section inside the Inspect tab \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.bound-section {
  margin: 0 0 14px;
  border: 1px solid #2a2a2a; border-radius: 6px;
  background: #131313;
}
.bound-head {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid #2a2a2a;
}
.bound-title {
  color: #9bb3e3; font-weight: 600; font-size: 11px;
  text-transform: uppercase; letter-spacing: .06em;
}
.bound-count { color: #888; font-size: 11px; flex: 1; }
.bound-all {
  background: #2d3a2d; color: #9be3a8;
  border: 1px solid #3a4f3a; border-radius: 3px;
  padding: 3px 8px; cursor: pointer; font: inherit; font-size: 11px;
}
.bound-all:hover { background: #3a4f3a; color: #e6e6e6; }
.bound-note {
  padding: 10px 12px; color: #888; font-style: italic; font-size: 11px;
}
.bound-list {
  list-style: none; padding: 4px 0; margin: 0;
  max-height: 280px; overflow: auto;
}
.bound-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px dashed #2a2a2a;
}
.bound-row:last-child { border-bottom: none; }
.bound-row:hover { background: #1f1f1f; }
.bound-left { flex: 1; min-width: 0; }
.bound-tagline { display: block; margin-bottom: 2px; }
.bound-tag {
  display: inline-block;
  font: 11px ui-monospace, monospace;
  color: #9be3a8;
}
.bound-prop {
  color: #9bb3e3; font: 10px ui-monospace, monospace;
}
.bound-snippet {
  color: #aaa; font-size: 11px;
  word-break: break-word;
}
.bound-via {
  color: #5e7593; font-size: 10px; font-family: ui-monospace, monospace;
  margin-top: 2px;
}
.bound-right { display: flex; gap: 4px; flex-shrink: 0; }
.bound-right button {
  background: #1a1a1a; color: #ccc;
  border: 1px solid #2a2a2a; border-radius: 3px;
  padding: 3px 8px; cursor: pointer; font: inherit; font-size: 10px;
}
.bound-right button:hover { border-color: #9be3a8; color: #9be3a8; }
.bound-other { opacity: 0.7; }
.bound-other .bound-tag { color: #e3c98e; }
.bound-more {
  padding: 6px 10px; color: #666; font-style: italic; font-size: 11px;
}
.__ripple_highlight { outline: 2px solid #9be3a8 !important; outline-offset: 2px; }
.ev-controls { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
.ev-controls button {
  background: #222; color: #ddd; border: 1px solid #2a2a2a;
  padding: 4px 10px; border-radius: 4px; cursor: pointer; font: inherit; font-size: 11px;
}
.ev-controls button:hover { border-color: #9be3a8; color: #9be3a8; }
.ev-debug {
  margin-left: auto; color: #888;
  font: 10px ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 240px;
}

/* \u2500\u2500\u2500 value timeline + collection activity (Events tab) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.ev-body { display: flex; flex-direction: column; gap: 0; }
.ev-card {
  background: #131313; border: 1px solid #2a2a2a; border-radius: 6px;
  margin: 0 0 10px;
  overflow: hidden;
}
.ev-card-title {
  padding: 6px 10px;
  background: #181818;
  border-bottom: 1px solid #2a2a2a;
  color: #888; text-transform: uppercase; font-size: 10px; letter-spacing: .08em;
  display: flex; align-items: center; justify-content: space-between;
}
.ev-card-current {
  color: #9be3a8; text-transform: none; letter-spacing: 0;
  font-size: 11px; font-family: ui-monospace, monospace;
}
.ev-empty { padding: 10px 12px; margin: 0; }

/* Sparkline */
.ev-spark { display: block; width: 100%; padding: 4px 8px 0; }
.ev-spark-grid  { stroke: #2a2a2a; stroke-dasharray: 2 3; }
.ev-spark-axis  { fill: #666; font: 9px ui-monospace, monospace; }
.ev-spark-line  { fill: none; stroke: #9be3a8; stroke-width: 1.5; stroke-linejoin: round; }
.ev-spark-dot   { fill: #9be3a8; }
.ev-spark-empty { fill: #666; font: 11px ui-sans-serif, system-ui; }

/* Transition / recent lists */
.ev-trans, .ev-recent { list-style: none; padding: 4px 10px 8px; margin: 0; }
.ev-trans li, .ev-recent li {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 0;
  border-bottom: 1px solid #1f1f1f;
  font-size: 11px;
}
.ev-trans li:last-child, .ev-recent li:last-child { border-bottom: none; }
.ev-trans-time { color: #666; width: 64px; flex-shrink: 0; font-variant-numeric: tabular-nums; }
.ev-trans-delta {
  flex: 1; color: #ddd; font-family: ui-monospace, monospace;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ev-recent-key {
  color: #ddd; font-family: ui-monospace, monospace; flex: 1;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ev-recent-payload {
  color: #888; font-family: ui-monospace, monospace; max-width: 140px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* Reusable verb pill (used here AND inside the Inspect-tab activity card) */
.verb-pill {
  font-size: 9px; text-transform: uppercase; letter-spacing: .04em;
  padding: 2px 6px; border-radius: 3px;
  background: #232323; color: #888;
  flex-shrink: 0;
}
.verb-pill.update { background: #2d3447; color: #9bb3e3; }
.verb-pill.insert { background: #2d3a2d; color: #9be3a8; }
.verb-pill.remove { background: #3a2d2d; color: #e39b9b; }
.verb-pill.move   { background: #3a3727; color: #e3c98e; }

/* Collection activity summary */
.ev-summary {
  padding: 10px 12px;
  display: flex; gap: 14px; flex-wrap: wrap;
  font-size: 12px; font-variant-numeric: tabular-nums;
}
.ev-stat-insert { color: #9be3a8; }
.ev-stat-remove { color: #e39b9b; }
.ev-stat-update { color: #9bb3e3; }
.ev-stat-move   { color: #e3c98e; }

/* Per-row heat bars */
.ev-heat { list-style: none; padding: 6px 10px 8px; margin: 0; }
.ev-heat li {
  display: flex; align-items: center; gap: 8px;
  padding: 3px 0; font-size: 11px;
}
.ev-heat-key {
  color: #ddd; width: 70px; flex-shrink: 0;
  font-family: ui-monospace, monospace;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ev-heat-bar {
  flex: 1; display: flex; height: 8px;
  background: #1f1f1f; border-radius: 2px; overflow: hidden;
}
.ev-heat-seg { display: block; height: 100%; }
.ev-heat-seg.update { background: #9bb3e3; }
.ev-heat-seg.insert { background: #9be3a8; }
.ev-heat-seg.remove { background: #e39b9b; }
.ev-heat-seg.move   { background: #e3c98e; }
.ev-heat-count {
  color: #888; width: 24px; text-align: right;
  flex-shrink: 0; font-variant-numeric: tabular-nums;
}
.prof-wrap { max-height: calc(100% - 40px); overflow: auto; }
table.prof { width: 100%; border-collapse: collapse; font-size: 11px; }
table.prof th, table.prof td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #2a2a2a; }
table.prof th { color: #888; font-weight: 500; background: #181818; position: sticky; top: 0; }
table.prof td:nth-child(n+2), table.prof th:nth-child(n+2) { text-align: right; font-variant-numeric: tabular-nums; }
.muted { color: #888; }
  `;
  return s;
}
var TABS, current, pollTimer, METHOD_OF, methodOfCtor;
var init_panel = __esm({
  "devtools/panel/index.ts"() {
    init_core();
    init_walk();
    TABS = ["inspect", "events", "profile"];
    current = null;
    pollTimer = null;
    METHOD_OF = {
      FilterValue: "filter",
      FilterStringValue: "filter",
      FilterObjectValue: "filter",
      FilterColumnValue: "filter",
      BetweenValue: "between",
      LengthValue: "length",
      LengthFnValue: "length",
      ZAColumnValue: "za",
      ZANumberValue: "za",
      AZColumnValue: "az",
      AZNumberValue: "az",
      LimitValue: "limit",
      ToValue: "to",
      MapValue: "map",
      GroupValue: "group",
      IntersectValue: "intersect",
      UnionValue: "union",
      ExceptValue: "except",
      SumValue: "sum",
      AvgValue: "avg",
      MaxValue: "max",
      MinValue: "min",
      SomeValue: "some",
      EveryValue: "every",
      TapValue: "tap",
      DistinctValue: "distinct",
      ReduceValue: "reduce",
      KeysValue: "keys",
      ValuesValue: "values",
      ReverseValue: "reverse"
    };
    methodOfCtor = (ctor) => METHOD_OF[ctor] || (ctor || "").replace(/Value$/, "").toLowerCase();
  }
});

// devtools/index.ts
init_core();
init_walk();

// devtools/instrument.ts
init_core();

// devtools/events.ts
init_walk();
var VERBS = [
  "XU0",
  "XR0",
  "BU1",
  "BU2",
  "BI0",
  "BI0A",
  "BI2",
  "BR1",
  "BR1A",
  "BR2",
  "BMV1"
];
var traceTargets = /* @__PURE__ */ new Map();
var profilers = /* @__PURE__ */ new Map();
var cascadeRecorders = /* @__PURE__ */ new Map();
var nextId = 1;
function nextTraceId() {
  return nextId++;
}
var depth = 0;
function dispatchTrace(view2, verb, payload) {
  if (!traceTargets.size) return;
  for (const t of traceTargets.values()) {
    if (t.root && !ancestorOf(view2, t.root)) continue;
    if (t.verbs && !t.verbs.has(verb)) continue;
    const ev = {
      t: typeof performance !== "undefined" ? performance.now() : Date.now(),
      verb,
      key: [...view2.key],
      payload: summarize(payload)
    };
    if (t.onEvent) t.onEvent(ev);
    if (t.log !== false && typeof console !== "undefined") {
      console.log(`[trace] ${verb} ${ev.key.join(".") || "<root>"}`, ev.payload);
    }
  }
}
function enterProfile() {
  depth++;
}
function exitProfile(view2, verb, dt) {
  depth--;
  if (!profilers.size) return;
  for (const p of profilers.values()) {
    if (p.root && !ancestorOf(view2, p.root)) continue;
    const acc = p.acc;
    acc.events++;
    acc.byVerb[verb] = (acc.byVerb[verb] || 0) + 1;
    const opCtor = view2.res?.constructor?.name || "View";
    const opKey = view2.key.join(".");
    const bucketKey = `${opCtor}@${opKey}`;
    let bucket = acc.byOp.get(bucketKey);
    if (!bucket) {
      bucket = { ctor: opCtor, key: [...view2.key], count: 0, totalMs: 0 };
      acc.byOp.set(bucketKey, bucket);
    }
    bucket.count++;
    if (depth === 0) {
      bucket.totalMs += dt;
      acc.ms += dt;
    }
  }
}
function snapshotValue(view2) {
  const v = view2?.value;
  if (v === void 0 || v === null) return v;
  try {
    return structuredClone(v);
  } catch {
  }
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
  }
  return v;
}
function enterCascadeFrame(view2, verb) {
  if (!cascadeRecorders.size) return;
  const t = performance.now();
  for (const r of cascadeRecorders.values()) {
    if (!r.current && r.root && !ancestorOf(view2, r.root)) continue;
    if (r.current && r.pendingClose) {
      r.pendingClose = false;
    }
    if (!r.current) {
      r.current = {
        id: r.nextCascadeId++,
        startedAt: t,
        totalMs: 0,
        frames: [],
        // state snapshot is populated only if the recorder was started
        // with captureState:true, and only at cascade close (Value's
        // verbs mutate the underlying value *before* dispatching to
        // patched View verbs, so a snapshot at enter would already
        // reflect the mutation — capturing at close gives the true
        // post-cascade state, which is what replay scrubbers need).
        state: void 0
      };
      r.cascadeStartT = t;
      r.stack = [];
      r.rootView = view2;
    }
    const i = r.current.frames.length;
    const parent = r.stack.length ? r.stack[r.stack.length - 1] : -1;
    r.current.frames.push({
      i,
      parent,
      ctor: view2.res?.constructor?.name || "View",
      key: [...view2.key],
      verb,
      startMs: t - r.cascadeStartT,
      endMs: -1
    });
    r.stack.push(i);
  }
}
function exitCascadeFrame(view2, verb) {
  if (!cascadeRecorders.size) return;
  const t = performance.now();
  for (const r of cascadeRecorders.values()) {
    if (!r.current || !r.stack.length) continue;
    const i = r.stack.pop();
    const f = r.current.frames[i];
    f.endMs = t - r.cascadeStartT;
    if (r.stack.length === 0) {
      if (f.endMs > r.current.totalMs) r.current.totalMs = f.endMs;
      r.pendingClose = true;
      queueMicrotask(() => flushPendingClose(r));
    }
  }
}
function flushPendingClose(r) {
  if (!r.pendingClose || !r.current) return;
  r.pendingClose = false;
  if (r.opts?.captureState) {
    r.current.state = snapshotValue(r.rootView);
  }
  r.cascades.push(r.current);
  const cap = r.opts?.maxCascades ?? 200;
  if (r.cascades.length > cap) r.cascades.splice(0, r.cascades.length - cap);
  r.current = null;
  r.stack = null;
  r.rootView = null;
}
function newProfileAcc() {
  return { events: 0, ms: 0, byOp: /* @__PURE__ */ new Map(), byVerb: {} };
}
function finalize(acc) {
  const byOperator = [...acc.byOp.values()].map((b) => ({ ...b, avgMs: b.count ? b.totalMs / b.count : 0 })).sort((a, b) => b.totalMs - a.totalMs);
  return {
    totalEvents: acc.events,
    totalMs: acc.ms,
    byOperator,
    byVerb: { ...acc.byVerb }
  };
}

// devtools/instrument.ts
var originals = /* @__PURE__ */ new Map();
var installed = false;
function hasActive() {
  return traceTargets.size > 0 || profilers.size > 0 || cascadeRecorders.size > 0;
}
function ensureInstrumented() {
  if (installed) return;
  for (const verb of VERBS) {
    const orig = View.prototype[verb];
    if (typeof orig !== "function") continue;
    originals.set(verb, orig);
    View.prototype[verb] = function patched(...args) {
      if (!hasActive()) return orig.apply(this, args);
      if (traceTargets.size) dispatchTrace(this, verb, args[0]);
      const profOn = profilers.size > 0;
      const cascOn = cascadeRecorders.size > 0;
      if (!profOn && !cascOn) return orig.apply(this, args);
      if (profOn) enterProfile();
      if (cascOn) enterCascadeFrame(this, verb);
      const t0 = performance.now();
      try {
        return orig.apply(this, args);
      } finally {
        const dt = performance.now() - t0;
        if (cascOn) exitCascadeFrame();
        if (profOn) exitProfile(this, verb, dt);
      }
    };
  }
  installed = true;
}
function restoreInstrumentation() {
  if (!installed) return;
  for (const [verb, orig] of originals) {
    View.prototype[verb] = orig;
  }
  originals.clear();
  installed = false;
}

// devtools/index.ts
init_walk();
$.inspect = function inspect(proxy) {
  const v = proxy?.[view];
  if (!v) throw new Error("$.inspect requires a ViewProxy");
  const children = [];
  v.each?.((name) => children.push({ name }));
  const sinks = [];
  v.sink?.((s) => sinks.push({
    kind: classify(s),
    ctor: s.constructor?.name || "anonymous"
  }));
  const out = {
    key: [...v.key],
    value: v.value,
    parent: v.p ? new ViewProxy(v.p) : null,
    children,
    sinks
  };
  if (typeof console !== "undefined" && console.group) {
    console.group(`View ${v.key.join(".") || "<root>"}`);
    console.log("value", v.value);
    if (children.length) console.table(children);
    if (sinks.length) console.table(sinks);
    console.groupEnd();
  }
  return out;
};
$.graph = function graph(proxy, opts) {
  if (proxy === void 0) {
    const trees = [];
    for (const v2 of iterRoots(opts)) trees.push(walk(v2));
    if (typeof console !== "undefined" && console.dir) {
      console.dir(trees, { depth: null });
    }
    return trees;
  }
  const v = proxy?.[view];
  if (!v) throw new Error("$.graph requires a ViewProxy or no argument");
  const tree = walk(v);
  if (typeof console !== "undefined" && console.dir) {
    console.dir(tree, { depth: null });
  }
  return tree;
};
$.fromDOM = function fromDOM(el2) {
  let n = el2;
  while (n) {
    if (n.__ripple_sink) {
      const v = n.__ripple_sink.p;
      return v ? new ViewProxy(v) : null;
    }
    n = n.parentElement;
  }
  return null;
};
$.highlight = function highlight(proxy, ms = 1e3) {
  const v = proxy?.[view];
  if (!v) throw new Error("$.highlight requires a ViewProxy");
  const targets = [];
  v.sink?.((s) => {
    if (classify(s) === "dom" && s.parent?.classList) targets.push(s.parent);
  });
  for (const el2 of targets) el2.classList?.add("__ripple_highlight");
  if (typeof setTimeout !== "undefined" && targets.length) {
    setTimeout(() => {
      for (const el2 of targets) el2.classList?.remove("__ripple_highlight");
    }, ms);
  }
  return targets.length;
};
$.trace = function trace(proxy, opts = {}) {
  const v = proxy?.[view];
  if (!v) throw new Error("$.trace requires a ViewProxy");
  ensureInstrumented();
  const id = nextTraceId();
  traceTargets.set(id, {
    id,
    root: v,
    verbs: opts.verbs ? new Set(opts.verbs) : null,
    log: opts.log !== false,
    onEvent: opts.onEvent
  });
  return function dispose() {
    traceTargets.delete(id);
  };
};
$.profile = function profile(proxy, opts = {}) {
  ensureInstrumented();
  const v = proxy?.[view] || null;
  const acc = newProfileAcc();
  const id = nextTraceId();
  profilers.set(id, { id, root: v, acc });
  let timer = null;
  if (opts.durationMs) {
    timer = setTimeout(stop, opts.durationMs);
  }
  function stop() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    profilers.delete(id);
    const r = finalize(acc);
    if (typeof console !== "undefined" && console.table && r.byOperator.length) {
      console.table(r.byOperator);
    }
    return r;
  }
  function report() {
    return finalize(acc);
  }
  return { stop, report };
};
$.cascades = function cascades(proxy, opts = {}) {
  ensureInstrumented();
  const v = proxy?.[view] || null;
  const id = nextTraceId();
  const recorder = {
    id,
    root: v,
    opts: {
      maxCascades: opts.maxCascades ?? 200,
      captureState: !!opts.captureState
    },
    cascades: [],
    current: null,
    stack: null,
    cascadeStartT: 0,
    nextCascadeId: 1,
    rootView: null
  };
  cascadeRecorders.set(id, recorder);
  return {
    stop() {
      flushPendingClose(recorder);
      cascadeRecorders.delete(id);
      return recorder.cascades.slice();
    },
    report() {
      flushPendingClose(recorder);
      return recorder.cascades.slice();
    },
    clear() {
      flushPendingClose(recorder);
      recorder.cascades.length = 0;
    }
  };
};
$.devtools = {
  enable: ensureInstrumented,
  disable() {
    traceTargets.clear();
    profilers.clear();
    cascadeRecorders.clear();
    restoreInstrumentation();
  },
  // `panel.open(proxy?)` opens the overlay rooted at `proxy` (or the first
  // live root if omitted). `panel.close()` tears it down. `panel.shell`
  // returns the live panel object — `{ host, root, dock, destroy }` — for
  // tests / advanced scripting that need to reach into the closed shadow.
  panel: {
    open(proxy) {
      return mountPanel2(proxy);
    },
    close() {
      return unmountPanel();
    },
    get shell() {
      return getPanelShell();
    }
  }
};
var mountPanel2 = () => void 0;
var unmountPanel = () => {
};
var getPanelShell = () => null;
if (typeof document !== "undefined") {
  const noPanel = typeof location !== "undefined" && /(?:^|[?&])nopanel(?:[=&]|$)/.test(location.search);
  void Promise.resolve().then(() => (init_panel(), panel_exports)).then((m) => {
    mountPanel2 = m.mount;
    unmountPanel = m.unmount;
    getPanelShell = m.getShell;
    if (!noPanel) m.mount();
  });
}

export { $, ancestorOf, classify, summarize, walk };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map