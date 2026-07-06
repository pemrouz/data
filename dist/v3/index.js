// v3/kernel/store.ts
var Store = class {
  constructor() {
    this.slots = [];
    this.slotKey = [];
    this.keySlot = /* @__PURE__ */ new Map();
    this.nextKey = 0;
    this.holes = 0;
  }
  get size() {
    return this.keySlot.size;
  }
  mintKey() {
    return this.nextKey++;
  }
  has(key) {
    return this.keySlot.has(key);
  }
  get(key) {
    const s = this.keySlot.get(key);
    return s === void 0 ? void 0 : this.slots[s];
  }
  // Single-lookup accessor for the write hot path (has + get in one hash).
  slotOf(key) {
    return this.keySlot.get(key);
  }
  rowAt(slot) {
    return this.slots[slot];
  }
  writeSlot(slot, row) {
    this.slots[slot] = row;
  }
  // Insert or overwrite; returns previous row (undefined if new).
  set(key, row) {
    const s = this.keySlot.get(key);
    if (s !== void 0) {
      const prev = this.slots[s];
      this.slots[s] = row;
      return prev;
    }
    const slot = this.slots.length;
    this.slots.push(row);
    this.slotKey.push(key);
    this.keySlot.set(key, slot);
    if (typeof key === "number" && key >= this.nextKey) this.nextKey = key + 1;
    return void 0;
  }
  del(key) {
    const s = this.keySlot.get(key);
    if (s === void 0) return void 0;
    const prev = this.slots[s];
    this.slots[s] = void 0;
    this.keySlot.delete(key);
    this.holes++;
    if (this.holes > this.slots.length >> 1 && this.slots.length > 16) this.compact();
    return prev;
  }
  compact() {
    const slots = [];
    const slotKey = [];
    for (let i = 0; i < this.slots.length; i++) {
      const k = this.slotKey[i];
      if (this.keySlot.get(k) === i) {
        this.keySlot.set(k, slots.length);
        slots.push(this.slots[i]);
        slotKey.push(k);
      }
    }
    this.slots = slots;
    this.slotKey = slotKey;
    this.holes = 0;
  }
  // Packed iteration in key-insertion order (Map preserves it) — the specified
  // total iteration order for object stores.
  *entries() {
    for (const [k, s] of this.keySlot) yield [k, this.slots[s]];
  }
  *keys() {
    yield* this.keySlot.keys();
  }
  snapshot() {
    const m = /* @__PURE__ */ new Map();
    for (const [k, s] of this.keySlot) m.set(k, this.slots[s]);
    return m;
  }
};

// v3/kernel/scope.ts
var Scope = class _Scope {
  static nextId = 1;
  id;
  disposed = false;
  owned = /* @__PURE__ */ new Set();
  disposers = null;
  constructor(parent) {
    this.id = _Scope.nextId++;
    if (parent) parent.add(this);
  }
  add(child) {
    if (this.disposed) {
      child.dispose();
      return;
    }
    this.owned.add(child);
  }
  delete(child) {
    this.owned?.delete(child);
  }
  onDispose(fn) {
    if (this.disposed) {
      fn();
      return;
    }
    (this.disposers ??= []).push(fn);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const owned = this.owned;
    this.owned = null;
    for (const child of owned) child.dispose();
    const ds = this.disposers;
    this.disposers = null;
    if (ds) for (let i = ds.length - 1; i >= 0; i--) ds[i]();
  }
  [Symbol.dispose]() {
    this.dispose();
  }
};
var current = null;
function currentScope() {
  return current;
}
function runInScope(s, fn) {
  const prev = current;
  current = s;
  try {
    return fn();
  } finally {
    current = prev;
  }
}

// v3/kernel/node.ts
var nextNodeId = 1;
var DataNode = class {
  id;
  kind;
  opName;
  runtime;
  parents;
  height;
  // children/effects are arrays, not Sets: fan-out is small, iteration is the
  // per-commit hot path (no iterator allocation), and removal is rare (dispose).
  children = [];
  effects = [];
  scope;
  disposed = false;
  // per-commit input slots (runtime-managed): in0/inFrom0 cover the
  // single-parent common case with zero allocation; inMore is the rare
  // multi-parent overflow. settledSeq: +seq = settled this commit; -seq =
  // enqueued this commit; 0 = untouched (seq starts at 1).
  in0 = null;
  inFrom0 = null;
  inMore = null;
  settledSeq = 0;
  constructor(runtime2, kind, opName, parents) {
    this.id = nextNodeId++;
    this.kind = kind;
    this.opName = opName;
    this.runtime = runtime2;
    this.parents = parents;
    let h2 = 0;
    for (const p of parents) {
      if (p.height + 1 > h2) h2 = p.height + 1;
      p.children.push(this);
    }
    this.height = h2;
    this.scope = currentScope();
    this.scope?.add(this);
    runtime2.register(this);
  }
  // Accumulate one parent's batch for this commit (runtime calls this).
  ingest(from, batch2) {
    if (this.in0 === null) {
      this.in0 = batch2;
      this.inFrom0 = from;
    } else {
      (this.inMore ??= []).push({ from, batch: batch2 });
    }
  }
  clearInputs() {
    this.in0 = null;
    this.inFrom0 = null;
    if (this.inMore !== null) this.inMore.length = 0;
  }
  // Current order, if this node is ordered (null otherwise).
  currentOrder() {
    return null;
  }
  // ── membership / row lookup protocol ────────────────────────────────────
  // Per-key access for multi-parent operators: set algebra queries its
  // parents per touched key instead of mirroring every parent's rows (the
  // mirrors were the dominant retained memory on wide graphs). Valid
  // whenever the node is settled — during a flush, height order guarantees
  // every parent settled first (and midBatch is false there: the flush runs
  // after batchDepth returns to 0). hasRow is distinct from rowAt because a
  // row's VALUE may legitimately be undefined (v3 has no sparse holes —
  // undefined rows are first-class). These base fallbacks materialize a
  // snapshot per call (O(N), correct for any node, midBatch-safe); every
  // in-tree collection node overrides them with O(1) materialized reads.
  hasRow(key) {
    return this.snapshot().has(key);
  }
  rowAt(key) {
    return this.snapshot().get(key);
  }
  connect(entry) {
    this.effects.push(entry);
    const self = this;
    const handle = {
      dispose() {
        const i = self.effects.indexOf(entry);
        if (i >= 0) self.effects.splice(i, 1);
      }
    };
    currentScope()?.add(handle);
    return handle;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const p of this.parents) {
      const i = p.children.indexOf(this);
      if (i >= 0) p.children.splice(i, 1);
    }
    this.children.length = 0;
    this.effects.length = 0;
    this.scope?.delete(this);
  }
};
function shallowCopy(v) {
  return Array.isArray(v) ? v.slice() : { ...v };
}
function leafAt(v, path) {
  let cur = v;
  for (const p of path) {
    if (cur == null) return void 0;
    cur = cur[p];
  }
  return cur;
}
function pathCopy(row, path, value2) {
  if (path.length === 0) return value2;
  const root = shallowCopy(row);
  let src = row;
  let dst = root;
  for (let i = 0; i < path.length - 1; i++) {
    const p = path[i];
    const next = src == null || src[p] == null ? {} : shallowCopy(src[p]);
    dst[p] = next;
    src = src == null ? void 0 : src[p];
    dst = next;
  }
  dst[path[path.length - 1]] = value2;
  return root;
}
function diffOrder(pre, post) {
  const postSet = new Set(post);
  const preSet = new Set(pre);
  const out = [];
  for (let i = pre.length - 1; i >= 0; i--) {
    if (!postSet.has(pre[i])) out.push({ op: "orderRemove", key: pre[i], index: i });
  }
  for (let i = 0; i < post.length; i++) {
    if (!preSet.has(post[i])) out.push({ op: "orderInsert", key: post[i], index: i });
  }
  return out;
}
var SourceNode = class extends DataNode {
  // runtime dirty-list membership flag
  constructor(runtime2, value2, name = "source") {
    super(runtime2, "source", name, []);
    this.store = new Store();
    this.pending = /* @__PURE__ */ new Map();
    this.preBatchOrder = null;
    this.inDirty = false;
    if (Array.isArray(value2)) {
      this.order = [];
      for (const row of value2) {
        const k = this.store.mintKey();
        this.store.set(k, row);
        this.order.push(k);
      }
    } else {
      this.order = null;
      for (const k of Object.keys(value2)) this.store.set(k, value2[k]);
    }
  }
  currentOrder() {
    return this.order;
  }
  snapshot() {
    return this.store.snapshot();
  }
  get(key) {
    return this.store.get(key);
  }
  // The store applies writes inline (read-your-writes), so it is current
  // even mid-batch — no midBatch branch needed.
  hasRow(key) {
    return this.store.has(key);
  }
  rowAt(key) {
    return this.store.get(key);
  }
  // ── mutation entry points (the runtime write protocol) ────────────────────
  // Hot path allocates no closures: canWriteNow() → inline apply → written().
  // The rare re-entrant path (a write inside an effect) queues a thunk.
  // Write at key(+path). Missing key with empty path = add; missing key with
  // a path is an error (no implicit row creation through a deep write).
  write(key, path, value2, at) {
    const rt = this.runtime;
    if (!rt.canWriteNow()) {
      rt.queueWrite(() => this.write(key, path, value2, at));
      return;
    }
    const slot = this.store.slotOf(key);
    if (slot === void 0) {
      if (path.length > 0)
        throw new Error(`data: deep write at [${String(key)}.${path.join(".")}] \u2014 key ${String(key)} is not live`);
      this.applyAdd(key, value2, at);
      rt.written(this);
      return;
    }
    const prev = this.store.rowAt(slot);
    const before = leafAt(prev, path);
    if (Object.is(before, value2)) return;
    const next = pathCopy(prev, path, value2);
    this.store.writeSlot(slot, next);
    this.recordUpdate(key, next, prev, path);
    rt.written(this);
  }
  insert(row, at) {
    const rt = this.runtime;
    if (!rt.canWriteNow()) {
      rt.queueWrite(() => void this.insert(row, at));
      return -1;
    }
    const key = this.order !== null ? this.store.mintKey() : this.autoObjectKey();
    this.applyAdd(key, row, at);
    rt.written(this);
    return key;
  }
  remove(key) {
    const rt = this.runtime;
    if (!rt.canWriteNow()) {
      rt.queueWrite(() => this.remove(key));
      return;
    }
    if (!this.store.has(key)) return;
    this.applyRemove(key);
    rt.written(this);
  }
  autoObjectKey() {
    let n = this.store.size;
    while (this.store.has(String(n))) n++;
    return String(n);
  }
  // ── consolidation (delta.ts rules, implemented once) ───────────────────────
  applyAdd(key, row, at) {
    this.store.set(key, row);
    const prior = this.pending.get(key);
    if (prior === void 0) {
      this.pending.set(key, { op: "add", key, row });
    } else if (prior.op === "remove") {
      this.pending.set(key, { op: "update", key, row, prev: prior.prev, path: [] });
    } else {
      throw new Error(`data: add for already-live key ${String(key)}`);
    }
    if (this.order !== null) {
      this.snapPreOrder();
      const i = at === void 0 || at < 0 || at > this.order.length ? this.order.length : at;
      this.order.splice(i, 0, key);
    }
  }
  applyRemove(key) {
    const prev = this.store.del(key);
    const prior = this.pending.get(key);
    if (prior === void 0) {
      this.pending.set(key, { op: "remove", key, prev });
    } else if (prior.op === "add") {
      this.pending.delete(key);
    } else if (prior.op === "update") {
      this.pending.set(key, { op: "remove", key, prev: prior.prev });
    } else {
      throw new Error(`data: remove for non-live key ${String(key)}`);
    }
    if (this.order !== null) {
      this.snapPreOrder();
      const i = this.order.indexOf(key);
      if (i >= 0) this.order.splice(i, 1);
    }
  }
  recordUpdate(key, row, prev, path) {
    const prior = this.pending.get(key);
    if (prior === void 0) {
      this.pending.set(key, { op: "update", key, row, prev, path });
    } else if (prior.op === "add") {
      this.pending.set(key, { op: "add", key, row });
    } else if (prior.op === "update") {
      const samePath = prior.path.length === path.length && prior.path.every((p, i) => p === path[i]);
      if (samePath && Object.is(leafAt(prior.prev, path), leafAt(row, path))) {
        this.pending.delete(key);
        return;
      }
      this.pending.set(key, {
        op: "update",
        key,
        row,
        prev: prior.prev,
        path: samePath ? path : []
      });
    }
  }
  snapPreOrder() {
    if (this.preBatchOrder === null && this.order !== null) this.preBatchOrder = this.order.slice();
  }
  settle(seq, origin) {
    if (this.pending.size === 0 && this.preBatchOrder === null) return null;
    let rows;
    if (this.pending.size === 1) {
      rows = [this.pending.values().next().value];
      this.pending.clear();
    } else {
      rows = [...this.pending.values()];
      this.pending = /* @__PURE__ */ new Map();
    }
    let order;
    if (this.preBatchOrder !== null) {
      order = diffOrder(this.preBatchOrder, this.order);
      this.preBatchOrder = null;
      if (order.length === 0) order = void 0;
    }
    if (rows.length === 0 && order === void 0) return null;
    return { seq, origin, rows, order, scalar: void 0 };
  }
};

// v3/ops/registry.ts
var registry = /* @__PURE__ */ new Map();
function defineOperator(def) {
  if (registry.has(def.name)) throw new Error(`data: operator ${def.name} already defined`);
  registry.set(def.name, def);
  return def;
}

// v3/ops/rowops.ts
var FilterNode = class extends DataNode {
  // materialized, updated at settle
  constructor(runtime2, parent, pred, name = "filter") {
    super(runtime2, "operator", name, [parent]);
    this.pred = pred;
    this.view = /* @__PURE__ */ new Map();
    for (const [k, row] of parent.snapshot()) if (pred(row, k)) this.view.set(k, row);
  }
  snapshot() {
    if (this.runtime.midBatch) {
      const m = /* @__PURE__ */ new Map();
      for (const [k, row] of this.parents[0].snapshot()) if (this.pred(row, k)) m.set(k, row);
      return m;
    }
    return new Map(this.view);
  }
  hasRow(key) {
    if (this.runtime.midBatch) return super.hasRow(key);
    return this.view.has(key);
  }
  rowAt(key) {
    if (this.runtime.midBatch) return super.rowAt(key);
    return this.view.get(key);
  }
  settle(seq, origin) {
    const input = this.in0;
    if (input === null) return null;
    const out = [];
    for (const d of input.rows) {
      switch (d.op) {
        case "add":
          if (this.pred(d.row, d.key)) {
            this.view.set(d.key, d.row);
            out.push(d);
          }
          break;
        case "remove":
          if (this.view.has(d.key)) {
            this.view.delete(d.key);
            out.push(d);
          }
          break;
        case "update": {
          const was = this.view.has(d.key);
          const now = this.pred(d.row, d.key);
          if (was && now) {
            this.view.set(d.key, d.row);
            out.push(d);
          } else if (was && !now) {
            this.view.delete(d.key);
            out.push({ op: "remove", key: d.key, prev: d.prev });
          } else if (!was && now) {
            this.view.set(d.key, d.row);
            out.push({ op: "add", key: d.key, row: d.row });
          }
          break;
        }
      }
    }
    return out.length ? { seq, origin, rows: out, order: void 0, scalar: void 0 } : null;
  }
};
var MapNode = class extends DataNode {
  // materialized mapped rows (supplies prev)
  constructor(runtime2, parent, fn) {
    super(runtime2, "operator", "map", [parent]);
    this.fn = fn;
    this.view = /* @__PURE__ */ new Map();
    for (const [k, row] of parent.snapshot()) this.view.set(k, fn(row, k));
  }
  snapshot() {
    if (this.runtime.midBatch) {
      const m = /* @__PURE__ */ new Map();
      for (const [k, row] of this.parents[0].snapshot()) m.set(k, this.fn(row, k));
      return m;
    }
    return new Map(this.view);
  }
  hasRow(key) {
    if (this.runtime.midBatch) return super.hasRow(key);
    return this.view.has(key);
  }
  rowAt(key) {
    if (this.runtime.midBatch) return super.rowAt(key);
    return this.view.get(key);
  }
  settle(seq, origin) {
    const input = this.in0;
    if (input === null) return null;
    const out = [];
    for (const d of input.rows) {
      switch (d.op) {
        case "add": {
          const mapped = this.fn(d.row, d.key);
          this.view.set(d.key, mapped);
          out.push({ op: "add", key: d.key, row: mapped });
          break;
        }
        case "remove": {
          const prev = this.view.get(d.key);
          this.view.delete(d.key);
          out.push({ op: "remove", key: d.key, prev });
          break;
        }
        case "update": {
          const prev = this.view.get(d.key);
          const next = this.fn(d.row, d.key);
          if (Object.is(prev, next)) break;
          this.view.set(d.key, next);
          out.push({ op: "update", key: d.key, row: next, prev, path: [] });
          break;
        }
      }
    }
    return out.length ? { seq, origin, rows: out, order: void 0, scalar: void 0 } : null;
  }
};
function filter(src, pred) {
  return new FilterNode(src.runtime, src, pred);
}
function map(src, fn) {
  return new MapNode(src.runtime, src, fn);
}
var CMP = {
  gt: (a, b) => a > b,
  lt: (a, b) => a < b,
  gte: (a, b) => a >= b,
  lte: (a, b) => a <= b
};
function compare(src, op, col, threshold) {
  const cmp = CMP[op];
  return new FilterNode(src.runtime, src, (row) => cmp(row?.[col], threshold), op);
}
defineOperator({
  name: "filter",
  kind: "row",
  category: "rowop",
  declarative: false,
  create: (src, pred) => filter(src, pred),
  dedupKey: () => null
  // opaque closures never dedup
});
defineOperator({
  name: "map",
  kind: "row",
  category: "rowop",
  declarative: false,
  create: (src, fn) => map(src, fn),
  dedupKey: () => null
});
for (const op of ["gt", "lt", "gte", "lte"]) {
  defineOperator({
    name: op,
    kind: "row",
    category: "rowop",
    declarative: true,
    create: (src, col, threshold) => compare(src, op, col, threshold),
    dedupKey: (col, threshold) => typeof threshold === "object" && threshold !== null ? null : `${op}:${col}:${String(threshold)}`
  });
}

// v3/ops/aggregate.ts
var ScalarNode = class extends DataNode {
  constructor(runtime2, parent, name) {
    super(runtime2, "scalar", name, [parent]);
  }
  snapshot() {
    throw new Error(`data: ${this.opName} is a scalar node \u2014 read value(), not snapshot()`);
  }
  value() {
    if (this.runtime.midBatch) return this.recompute(this.parents[0].snapshot());
    return this.cur;
  }
  settle(seq, origin) {
    const input = this.in0;
    if (input === null) return null;
    for (const d of input.rows) this.applyDelta(d);
    const next = this.read();
    if (Object.is(this.cur, next)) return null;
    const prev = this.cur;
    this.cur = next;
    return { seq, origin, rows: [], order: void 0, scalar: { prev, next } };
  }
};
function proj(col, row) {
  const x = col === void 0 ? row : row?.[col];
  return x === void 0 || x === null ? void 0 : x;
}
var ProjectionAggregate = class extends ScalarNode {
  constructor(runtime2, parent, name, col) {
    super(runtime2, parent, name);
    this.col = col;
    this.tracked = /* @__PURE__ */ new Map();
    for (const [k, row] of parent.snapshot()) {
      const x = proj(col, row);
      if (x !== void 0) {
        this.tracked.set(k, x);
        this.delta(void 0, x);
      }
    }
    this.cur = this.read();
  }
  applyDelta(d) {
    switch (d.op) {
      case "add": {
        const x = proj(this.col, d.row);
        if (x !== void 0) {
          this.tracked.set(d.key, x);
          this.delta(void 0, x);
        }
        break;
      }
      case "remove": {
        const o = this.tracked.get(d.key);
        if (o !== void 0) {
          this.tracked.delete(d.key);
          this.delta(o, void 0);
        }
        break;
      }
      case "update": {
        const o = this.tracked.get(d.key);
        const x = proj(this.col, d.row);
        if (x === void 0) {
          if (o !== void 0) {
            this.tracked.delete(d.key);
            this.delta(o, void 0);
          }
        } else {
          this.tracked.set(d.key, x);
          if (!Object.is(o, x)) this.delta(o, x);
        }
        break;
      }
    }
  }
};
var SumNode = class extends ProjectionAggregate {
  delta(o, n) {
    if (this.total === void 0) this.total = 0;
    if (o !== void 0) this.total -= +o;
    if (n !== void 0) this.total += +n;
  }
  read() {
    return this.total === void 0 ? 0 : this.total;
  }
  recompute(snap) {
    let t = 0;
    for (const row of snap.values()) {
      const x = proj(this.col, row);
      if (x !== void 0) t += +x;
    }
    return t;
  }
};
var AvgNode = class extends ProjectionAggregate {
  delta(o, n) {
    if (this.total === void 0) {
      this.total = 0;
      this.count = 0;
    }
    if (o !== void 0) {
      this.total -= +o;
      this.count--;
    }
    if (n !== void 0) {
      this.total += +n;
      this.count++;
    }
  }
  read() {
    return this.count === void 0 || this.count === 0 ? void 0 : this.total / this.count;
  }
  recompute(snap) {
    let t = 0;
    let c = 0;
    for (const row of snap.values()) {
      const x = proj(this.col, row);
      if (x !== void 0) {
        t += +x;
        c++;
      }
    }
    return c === 0 ? void 0 : t / c;
  }
};
var LengthNode = class extends ScalarNode {
  constructor(runtime2, parent) {
    super(runtime2, parent, "length");
    this.count = parent.snapshot().size;
    this.cur = this.count;
  }
  applyDelta(d) {
    if (d.op === "add") this.count++;
    else if (d.op === "remove") this.count--;
  }
  read() {
    return this.count;
  }
  recompute(snap) {
    return snap.size;
  }
};
function sum(src, col) {
  return new SumNode(src.runtime, src, "sum", col);
}
function avg(src, col) {
  return new AvgNode(src.runtime, src, "avg", col);
}
function length(src) {
  return new LengthNode(src.runtime, src);
}
defineOperator({
  name: "sum",
  kind: "aggregate",
  category: "aggregate-decomposable",
  declarative: true,
  create: (src, col) => sum(src, col),
  dedupKey: (col) => typeof col === "string" || col === void 0 ? `sum:${col ?? ""}` : null
});
defineOperator({
  name: "avg",
  kind: "aggregate",
  category: "aggregate-decomposable",
  declarative: true,
  create: (src, col) => avg(src, col),
  dedupKey: (col) => typeof col === "string" || col === void 0 ? `avg:${col ?? ""}` : null
});
defineOperator({
  name: "length",
  kind: "aggregate",
  category: "aggregate-decomposable",
  declarative: true,
  create: (src) => length(src),
  dedupKey: () => "length"
});

// v3/ops/between.ts
var BKEY = "b";
function lowerBound(vals, x) {
  let lo = 0;
  let hi = vals.length;
  while (lo < hi) {
    const mid = lo + hi >>> 1;
    if (vals[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
function upperBound(vals, x) {
  let lo = 0;
  let hi = vals.length;
  while (lo < hi) {
    const mid = lo + hi >>> 1;
    if (vals[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
var BetweenNode = class extends DataNode {
  constructor(runtime2, parent, boundsSrc, col, lo, hi) {
    super(runtime2, "operator", "between", [parent, boundsSrc]);
    this.col = col;
    this.lo = lo;
    this.hi = hi;
    this.boundsSrc = boundsSrc;
    this.rows = parent.snapshot();
    this.view = /* @__PURE__ */ new Map();
    for (const [k, row] of this.rows) {
      const x = row?.[col];
      if (x != null && x >= lo && x <= hi) this.view.set(k, row);
    }
    this.sVals = [];
    this.sKeys = [];
    this.sortedDirty = true;
    this.loIdx = void 0;
    this.hiIdx = void 0;
  }
  // ── public surface ──────────────────────────────────────────────────────────
  // Re-select incrementally to new bounds — the hot path. Crossed bounds
  // normalize (lo > hi swaps); a missing bound defaults to ±Infinity.
  setBounds(bounds) {
    let a = bounds[0] ?? -Infinity;
    let b = bounds[1] ?? Infinity;
    if (b < a) {
      const t = a;
      a = b;
      b = t;
    }
    const cur = this.boundsSrc.get(BKEY);
    if (cur !== void 0 && Object.is(cur[0], a) && Object.is(cur[1], b)) return;
    this.boundsSrc.write(BKEY, [], [a, b]);
  }
  bounds() {
    return this.boundsSrc.get(BKEY) ?? [this.lo, this.hi];
  }
  snapshot() {
    if (this.runtime.midBatch) {
      const [lo, hi] = this.boundsSrc.get(BKEY) ?? [this.lo, this.hi];
      const m = /* @__PURE__ */ new Map();
      const col = this.col;
      for (const [k, row] of this.parents[0].snapshot()) {
        const x = row?.[col];
        if (x != null && x >= lo && x <= hi) m.set(k, row);
      }
      return m;
    }
    return new Map(this.view);
  }
  hasRow(key) {
    if (this.runtime.midBatch) return super.hasRow(key);
    return this.view.has(key);
  }
  rowAt(key) {
    if (this.runtime.midBatch) return super.rowAt(key);
    return this.view.get(key);
  }
  dispose() {
    super.dispose();
    this.boundsSrc.dispose();
  }
  // ── settle ──────────────────────────────────────────────────────────────────
  settle(seq, origin) {
    let dataBatch = null;
    let boundsBatch = null;
    if (this.in0 !== null) {
      if (this.inFrom0 === this.parents[0]) dataBatch = this.in0;
      else boundsBatch = this.in0;
    }
    if (this.inMore !== null) {
      for (const m of this.inMore) {
        if (m.from === this.parents[0]) dataBatch = m.batch;
        else boundsBatch = m.batch;
      }
    }
    if (dataBatch === null && boundsBatch === null) return null;
    if (dataBatch === null && boundsBatch !== null) {
      const rows2 = [];
      const push = (d) => rows2.push(d);
      for (const d of boundsBatch.rows) {
        if (d.op === "update" || d.op === "add") this.applyBounds(d.row, push);
      }
      if (rows2.length === 0) return null;
      return { seq, origin, rows: rows2, order: void 0, scalar: void 0 };
    }
    const pending = /* @__PURE__ */ new Map();
    const emit = (d) => this.pend(pending, d);
    if (dataBatch !== null) this.applyData(dataBatch.rows, pending);
    if (boundsBatch !== null) {
      for (const d of boundsBatch.rows) {
        if (d.op === "update" || d.op === "add") this.applyBounds(d.row, emit);
      }
    }
    if (pending.size === 0) return null;
    const rows = [...pending.values()];
    return { seq, origin, rows, order: void 0, scalar: void 0 };
  }
  // ── data-delta phase (membership semantics identical to filter) ────────────
  // undefined and null are never in range (matching the aggregate family's
  // projection normalization — and keeping membership consistent with the
  // index, which excludes non-comparable values; raw JS comparison would let
  // null coerce to 0 and slip inside bounds bracketing zero). NaN fails the
  // comparisons naturally.
  inRange(x) {
    return x != null && x >= this.lo && x <= this.hi;
  }
  markDirty() {
    this.sortedDirty = true;
    this.loIdx = void 0;
    this.hiIdx = void 0;
  }
  applyData(deltas, pending) {
    const col = this.col;
    for (const d of deltas) {
      switch (d.op) {
        case "add": {
          this.rows.set(d.key, d.row);
          this.markDirty();
          if (this.inRange(d.row?.[col])) {
            this.view.set(d.key, d.row);
            this.pend(pending, d);
          }
          break;
        }
        case "remove": {
          this.rows.delete(d.key);
          this.markDirty();
          if (this.view.has(d.key)) {
            const prev = this.view.get(d.key);
            this.view.delete(d.key);
            this.pend(pending, { op: "remove", key: d.key, prev });
          }
          break;
        }
        case "update": {
          this.rows.set(d.key, d.row);
          const oldCol = d.prev?.[col];
          const newCol = d.row?.[col];
          if (!Object.is(oldCol, newCol)) this.markDirty();
          const was = this.view.has(d.key);
          const now = this.inRange(newCol);
          if (was && now) {
            this.view.set(d.key, d.row);
            this.pend(pending, d);
          } else if (was && !now) {
            this.view.delete(d.key);
            this.pend(pending, { op: "remove", key: d.key, prev: d.prev });
          } else if (!was && now) {
            this.view.set(d.key, d.row);
            this.pend(pending, { op: "add", key: d.key, row: d.row });
          }
          break;
        }
      }
    }
  }
  // ── the brush walk (v2 `set extent`, Map-world) ─────────────────────────────
  applyBounds(nb, emit) {
    let newLo = nb[0];
    let newHi = nb[1];
    if (newHi < newLo) {
      const t = newLo;
      newLo = newHi;
      newHi = t;
    }
    if (Object.is(newLo, this.lo) && Object.is(newHi, this.hi)) return;
    if (this.sortedDirty) this.resort();
    const vals = this.sVals;
    const keys = this.sKeys;
    this.loIdx ??= lowerBound(vals, this.lo);
    this.hiIdx ??= upperBound(vals, this.hi);
    if (newHi < this.hi) {
      while (this.hiIdx > 0 && vals[this.hiIdx - 1] > newHi) {
        this.hiIdx--;
        const k = keys[this.hiIdx];
        const prev = this.view.get(k);
        if (prev !== void 0) {
          this.view.delete(k);
          emit({ op: "remove", key: k, prev });
        }
      }
      if (this.loIdx > this.hiIdx) this.loIdx = this.hiIdx;
    }
    if (newLo > this.lo) {
      while (this.loIdx < vals.length && vals[this.loIdx] < newLo) {
        const k = keys[this.loIdx];
        this.loIdx++;
        const prev = this.view.get(k);
        if (prev !== void 0) {
          this.view.delete(k);
          emit({ op: "remove", key: k, prev });
        }
      }
      if (this.hiIdx < this.loIdx) this.hiIdx = this.loIdx;
    }
    if (newHi > this.hi) {
      while (this.hiIdx < vals.length && vals[this.hiIdx] <= newHi) {
        const k = keys[this.hiIdx];
        this.hiIdx++;
        if (!this.view.has(k)) {
          const row = this.rows.get(k);
          this.view.set(k, row);
          emit({ op: "add", key: k, row });
        }
      }
    }
    if (newLo < this.lo) {
      while (this.loIdx > 0 && vals[this.loIdx - 1] >= newLo) {
        this.loIdx--;
        const k = keys[this.loIdx];
        if (!this.view.has(k)) {
          const row = this.rows.get(k);
          this.view.set(k, row);
          emit({ op: "add", key: k, row });
        }
      }
    }
    this.lo = newLo;
    this.hi = newHi;
  }
  // Rebuild the sorted index from the row mirror — called lazily by the walk
  // when the dirty flag is set. Amortizes many data mutations into one
  // O(N log N) sort that fires only when the user actually brushes.
  resort() {
    const col = this.col;
    const entries = [];
    for (const [k, row] of this.rows) {
      const x = row?.[col];
      if (x === void 0 || x === null || typeof x === "number" && x !== x) continue;
      entries.push([x, k]);
    }
    entries.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    const n = entries.length;
    const vals = new Array(n);
    const keys = new Array(n);
    for (let i = 0; i < n; i++) {
      vals[i] = entries[i][0];
      keys[i] = entries[i][1];
    }
    this.sVals = vals;
    this.sKeys = keys;
    this.sortedDirty = false;
    this.loIdx = void 0;
    this.hiIdx = void 0;
  }
  // ── per-batch consolidation (delta.ts merge rules, local) ───────────────────
  pend(map2, d) {
    const prior = map2.get(d.key);
    if (prior === void 0) {
      map2.set(d.key, d);
      return;
    }
    if (prior.op === "add") {
      if (d.op === "update") map2.set(d.key, { op: "add", key: d.key, row: d.row });
      else if (d.op === "remove") map2.delete(d.key);
    } else if (prior.op === "update") {
      if (d.op === "update") {
        const samePath = prior.path.length === d.path.length && prior.path.every((p, i) => p === d.path[i]);
        map2.set(d.key, {
          op: "update",
          key: d.key,
          row: d.row,
          prev: prior.prev,
          path: samePath ? d.path : []
        });
      } else if (d.op === "remove") {
        map2.set(d.key, { op: "remove", key: d.key, prev: prior.prev });
      }
    } else {
      if (d.op === "add") map2.set(d.key, { op: "update", key: d.key, row: d.row, prev: prior.prev, path: [] });
    }
  }
};
function between(src, col, bounds = []) {
  let a = bounds[0] ?? -Infinity;
  let b = bounds[1] ?? Infinity;
  if (b < a) {
    const t = a;
    a = b;
    b = t;
  }
  const boundsSrc = new SourceNode(src.runtime, { [BKEY]: [a, b] }, "between:bounds");
  return new BetweenNode(src.runtime, src, boundsSrc, col, a, b);
}
defineOperator({
  name: "between",
  kind: "row",
  category: "rowop",
  declarative: true,
  create: (src, col, bounds) => between(src, col, bounds),
  // Dedup only for static numeric bounds (reactive args key by bound-node
  // identity via the M2 reactive-arg binder; opaque/absent bounds are fresh).
  dedupKey: (col, bounds) => {
    if (typeof col !== "string" || !Array.isArray(bounds)) return null;
    const lo = bounds[0] ?? -Infinity;
    const hi = bounds[1] ?? Infinity;
    return typeof lo === "number" && typeof hi === "number" ? `between:${col}:${lo}:${hi}` : null;
  }
});

// v3/ops/setops.ts
function rootsOf(n, out = /* @__PURE__ */ new Set()) {
  if (n.parents.length === 0) out.add(n);
  else for (const p of n.parents) rootsOf(p, out);
  return out;
}
function pathEq(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
var SetOpNode = class extends DataNode {
  // parents share ≥1 root source
  constructor(runtime2, variant, primary, others) {
    const unique = [primary];
    for (const o of others) if (unique.indexOf(o) < 0) unique.push(o);
    super(runtime2, "operator", variant, unique);
    this.variant = variant;
    this.othersMask = 0;
    for (const o of others) this.othersMask |= 1 << unique.indexOf(o);
    let common = [...rootsOf(unique[0])];
    for (let i = 1; i < unique.length && common.length > 0; i++) {
      const ri = rootsOf(unique[i]);
      common = common.filter((r) => ri.has(r));
    }
    this.sharedProvenance = common.length > 0;
    this.view = /* @__PURE__ */ new Map();
    if (variant === "union") {
      const seen = /* @__PURE__ */ new Set();
      for (const p of unique) {
        for (const k of p.snapshot().keys()) {
          if (seen.has(k)) continue;
          seen.add(k);
          if (this.live(k)) this.view.set(k, this.exposed(k));
        }
      }
    } else {
      for (const k of unique[0].snapshot().keys()) {
        if (this.live(k)) this.view.set(k, this.exposed(k));
      }
    }
  }
  // Liveness by direct parent membership queries (hasRow is O(1) on every
  // in-tree node once the parent has settled — height order guarantees that
  // whenever WE settle). Cross-domain numeric keys (independent array-born
  // stores) never co-match: minted-int equality across unrelated stores is
  // positional coincidence, not identity — see the key-domain header note.
  live(key) {
    const parents = this.parents;
    const numericForeign = typeof key === "number" && !this.sharedProvenance && parents.length > 1;
    switch (this.variant) {
      case "intersect": {
        if (numericForeign) return false;
        for (let i = 0; i < parents.length; i++) if (!parents[i].hasRow(key)) return false;
        return true;
      }
      case "union": {
        for (let i = 0; i < parents.length; i++) if (parents[i].hasRow(key)) return true;
        return false;
      }
      case "except": {
        if (!parents[0].hasRow(key)) return false;
        if (numericForeign) return true;
        for (let i = 0; i < parents.length; i++)
          if ((this.othersMask & 1 << i) !== 0 && parents[i].hasRow(key)) return false;
        return true;
      }
    }
  }
  // The exposed row for a live key. intersect/except: the primary's row.
  // union: first parent (in parent order) HOLDING the key — primary wins
  // (hasRow, not a rowAt !== undefined check: undefined rows are first-class).
  exposed(key) {
    const parents = this.parents;
    if (this.variant === "union") {
      for (let i = 0; i < parents.length; i++)
        if (parents[i].hasRow(key)) return parents[i].rowAt(key);
      return void 0;
    }
    return parents[0].rowAt(key);
  }
  snapshot() {
    if (this.runtime.midBatch) return this.recomputePure();
    return new Map(this.view);
  }
  hasRow(key) {
    if (this.runtime.midBatch) return super.hasRow(key);
    return this.view.has(key);
  }
  rowAt(key) {
    if (this.runtime.midBatch) return super.rowAt(key);
    return this.view.get(key);
  }
  // Flush-on-read: recompute PURE from parents (whose snapshots are
  // themselves mid-batch-consistent), touching none of this node's state.
  recomputePure() {
    const snaps = [];
    for (const p of this.parents) snaps.push(p.snapshot());
    const fullMask = (1 << snaps.length) - 1;
    const masks = /* @__PURE__ */ new Map();
    for (let i = 0; i < snaps.length; i++)
      for (const k of snaps[i].keys()) masks.set(k, (masks.get(k) ?? 0) | 1 << i);
    const out = /* @__PURE__ */ new Map();
    for (const [k, m] of masks) {
      const numericForeign = typeof k === "number" && !this.sharedProvenance && snaps.length > 1;
      let liveNow;
      switch (this.variant) {
        case "intersect":
          liveNow = numericForeign ? false : m === fullMask;
          break;
        case "union":
          liveNow = m !== 0;
          break;
        case "except":
          liveNow = (m & 1) !== 0 && (numericForeign || (m & this.othersMask) === 0);
          break;
      }
      if (!liveNow) continue;
      if (this.variant === "union") {
        for (let i = 0; i < snaps.length; i++)
          if (snaps[i].has(k)) {
            out.set(k, snaps[i].get(k));
            break;
          }
      } else {
        out.set(k, snaps[0].get(k));
      }
    }
    return out;
  }
  settle(seq, origin) {
    if (this.in0 === null) return null;
    const touched = /* @__PURE__ */ new Map();
    this.fold(this.in0, touched);
    if (this.inMore !== null)
      for (const { batch: batch2 } of this.inMore) this.fold(batch2, touched);
    const out = [];
    for (const [k, cand] of touched) {
      const preLive = this.view.has(k);
      const preRow = this.view.get(k);
      const postLive = this.live(k);
      if (!preLive && postLive) {
        const row = this.exposed(k);
        this.view.set(k, row);
        out.push({ op: "add", key: k, row });
      } else if (preLive && !postLive) {
        this.view.delete(k);
        out.push({ op: "remove", key: k, prev: preRow });
      } else if (preLive && postLive) {
        const row = this.exposed(k);
        if (Object.is(preRow, row)) continue;
        this.view.set(k, row);
        let path = cand ?? [];
        if (path.length > 0 && Object.is(leafAt(preRow, path), leafAt(row, path))) path = [];
        out.push({ op: "update", key: k, row, prev: preRow, path });
      }
    }
    return out.length ? { seq, origin, rows: out, order: void 0, scalar: void 0 } : null;
  }
  fold(batch2, touched) {
    for (const d of batch2.rows) {
      if (!touched.has(d.key)) {
        touched.set(d.key, d.op === "update" ? d.path : null);
      } else {
        const prior = touched.get(d.key);
        if (!(d.op === "update" && prior !== null && pathEq(prior, d.path)))
          touched.set(d.key, null);
      }
    }
  }
};
function intersect(primary, ...others) {
  return new SetOpNode(primary.runtime, "intersect", primary, others);
}
function union(primary, ...others) {
  return new SetOpNode(primary.runtime, "union", primary, others);
}
function except(primary, ...others) {
  return new SetOpNode(primary.runtime, "except", primary, others);
}
defineOperator({
  name: "intersect",
  kind: "set",
  category: "rowop",
  declarative: true,
  create: (src, ...others) => intersect(src, ...others),
  dedupKey: () => null
  // dedup by source identity is an API-layer concern
});
defineOperator({
  name: "union",
  kind: "set",
  category: "rowop",
  declarative: true,
  create: (src, ...others) => union(src, ...others),
  dedupKey: () => null
});
defineOperator({
  name: "except",
  kind: "set",
  category: "rowop",
  declarative: true,
  create: (src, ...others) => except(src, ...others),
  dedupKey: () => null
});

// v3/ops/bucket.ts
var BucketNode = class extends DataNode {
  constructor(runtime2, parent, fn, opts, name) {
    super(runtime2, "operator", name, [parent]);
    this.fn = fn;
    this.prune = opts.prune;
    this.counts = opts.counts;
    this.members = /* @__PURE__ */ new Map();
    this.bucketOf = /* @__PURE__ */ new Map();
    this.view = /* @__PURE__ */ new Map();
    for (const [k, row] of parent.snapshot()) this.enter(k, row);
    for (const [bk, mem] of this.members) this.view.set(bk, this.build(mem));
  }
  // ── membership bookkeeping ──────────────────────────────────────────────────
  enter(key, row) {
    const bk = String(this.fn(row, key));
    let mem = this.members.get(bk);
    if (mem === void 0) {
      mem = /* @__PURE__ */ new Map();
      this.members.set(bk, mem);
    }
    mem.set(key, row);
    this.bucketOf.set(key, bk);
    return bk;
  }
  leave(key) {
    const bk = this.bucketOf.get(key);
    this.members.get(bk).delete(key);
    this.bucketOf.delete(key);
    return bk;
  }
  // Fresh bucket value — NEVER mutate a previously emitted object (prev must
  // remain the pre-change object for every downstream consumer). Group bucket
  // properties are emitted in SORTED key order: deterministic and
  // history-independent (v2's bucket order depended on arrival history; a
  // canonical order makes replay/oracle comparison exact byte-for-byte).
  build(mem) {
    if (this.counts) return { value: mem.size };
    const keys = [];
    const byKey = /* @__PURE__ */ new Map();
    for (const [k, v] of mem) {
      const sk = String(k);
      keys.push(sk);
      byKey.set(sk, v);
    }
    keys.sort();
    const o = {};
    for (const sk of keys) o[sk] = byKey.get(sk);
    return o;
  }
  sameBucket(a, b) {
    if (this.counts) return a.value === b.value;
    const ao = a;
    const bo = b;
    const ka = Object.keys(ao);
    if (ka.length !== Object.keys(bo).length) return false;
    for (const k of ka) {
      if (!Object.prototype.hasOwnProperty.call(bo, k) || !Object.is(ao[k], bo[k])) return false;
    }
    return true;
  }
  // ── reads ───────────────────────────────────────────────────────────────────
  snapshot() {
    if (this.runtime.midBatch) {
      const members = /* @__PURE__ */ new Map();
      for (const [k, row] of this.parents[0].snapshot()) {
        const bk = String(this.fn(row, k));
        let mem = members.get(bk);
        if (mem === void 0) {
          mem = /* @__PURE__ */ new Map();
          members.set(bk, mem);
        }
        mem.set(k, row);
      }
      const out = /* @__PURE__ */ new Map();
      for (const [bk, mem] of members) out.set(bk, this.build(mem));
      if (!this.prune) {
        for (const bk of this.view.keys()) if (!out.has(bk)) out.set(bk, this.build(/* @__PURE__ */ new Map()));
      }
      return out;
    }
    return new Map(this.view);
  }
  hasRow(key) {
    if (this.runtime.midBatch) return super.hasRow(key);
    return this.view.has(key);
  }
  rowAt(key) {
    if (this.runtime.midBatch) return super.rowAt(key);
    return this.view.get(key);
  }
  // ── settle ──────────────────────────────────────────────────────────────────
  settle(seq, origin) {
    const input = this.in0;
    if (input === null) return null;
    const touched = /* @__PURE__ */ new Map();
    for (const d of input.rows) {
      switch (d.op) {
        case "add": {
          const bk = this.enter(d.key, d.row);
          if (!touched.has(bk)) touched.set(bk, this.view.get(bk));
          break;
        }
        case "remove": {
          const bk = this.leave(d.key);
          if (!touched.has(bk)) touched.set(bk, this.view.get(bk));
          break;
        }
        case "update": {
          const oldBk = this.bucketOf.get(d.key);
          const newBk = String(this.fn(d.row, d.key));
          if (oldBk === newBk) {
            this.members.get(oldBk).set(d.key, d.row);
            if (!this.counts && !touched.has(oldBk)) touched.set(oldBk, this.view.get(oldBk));
          } else {
            const from = this.leave(d.key);
            const to = this.enter(d.key, d.row);
            if (!touched.has(from)) touched.set(from, this.view.get(from));
            if (!touched.has(to)) touched.set(to, this.view.get(to));
          }
          break;
        }
      }
    }
    if (touched.size === 0) return null;
    const out = [];
    for (const [bk, prev] of touched) {
      const mem = this.members.get(bk);
      const emptied = mem.size === 0;
      if (this.prune && emptied) this.members.delete(bk);
      const liveNow = this.prune ? !emptied : true;
      const wasLive = prev !== void 0;
      if (!liveNow) {
        if (wasLive) {
          this.view.delete(bk);
          out.push({ op: "remove", key: bk, prev });
        }
        continue;
      }
      const next = this.build(mem);
      if (!wasLive) {
        this.view.set(bk, next);
        out.push({ op: "add", key: bk, row: next });
      } else if (!this.sameBucket(prev, next)) {
        this.view.set(bk, next);
        out.push({ op: "update", key: bk, row: next, prev, path: [] });
      }
    }
    return out.length ? { seq, origin, rows: out, order: void 0, scalar: void 0 } : null;
  }
};
function group(src, fn) {
  return new BucketNode(src.runtime, src, fn, { prune: true, counts: false }, "group");
}
function lengthBuckets(src, fn) {
  return new BucketNode(src.runtime, src, fn, { prune: false, counts: true }, "lengthBuckets");
}
defineOperator({
  name: "group",
  kind: "bucket",
  category: "aggregate-decomposable",
  declarative: false,
  create: (src, fn) => group(src, fn),
  // fn-arg rule: an opaque closure has no value identity, so bucket ops never
  // dedup (v2: group/length(fn) create a fresh operator per call; only
  // value-identity args — columns, thresholds, bounds — participate in dedup).
  dedupKey: () => null
});
defineOperator({
  name: "lengthBuckets",
  kind: "bucket",
  category: "aggregate-decomposable",
  declarative: false,
  create: (src, fn) => lengthBuckets(src, fn),
  dedupKey: () => null
  // fn args — see the note on `group` above
});

// v3/ops/ordered.ts
var OrderIndex = class {
  constructor(cmp) {
    this.keys = [];
    this.cmp = cmp;
  }
  get size() {
    return this.keys.length;
  }
  build(keys) {
    this.keys = keys.slice().sort(this.cmp);
  }
  // lower_bound: for an absent key, its unique legal insertion position; for
  // a present key, its exact position (strict total order).
  bisect(key) {
    let lo = 0;
    let hi = this.keys.length;
    while (lo < hi) {
      const mid = lo + hi >>> 1;
      if (this.cmp(this.keys[mid], key) < 0) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  insert(key) {
    const at = this.bisect(key);
    this.keys.splice(at, 0, key);
    return at;
  }
  remove(key) {
    const at = this.rankOf(key);
    if (at >= 0) this.keys.splice(at, 1);
    return at;
  }
  rankOf(key) {
    const at = this.bisect(key);
    return at < this.keys.length && this.keys[at] === key ? at : -1;
  }
  // Batch reconcile — ONE pass over the index: drop every key in `removed`
  // (no comparisons — membership only), then merge the sorted `inserts`.
  // O(N + Δ log Δ), independent of how the removals are distributed. NOTE:
  // sorts `inserts` in place; every insert's row must already be current.
  reconcile(removed, inserts) {
    let base = this.keys;
    if (removed !== null && removed.size > 0) {
      const kept = [];
      for (const k of base) if (!removed.has(k)) kept.push(k);
      base = kept;
    }
    if (inserts.length > 0) {
      if (inserts.length > 1) inserts.sort(this.cmp);
      const merged = new Array(base.length + inserts.length);
      let i = 0;
      let j = 0;
      let o = 0;
      while (i < base.length && j < inserts.length)
        merged[o++] = this.cmp(base[i], inserts[j]) < 0 ? base[i++] : inserts[j++];
      while (i < base.length) merged[o++] = base[i++];
      while (j < inserts.length) merged[o++] = inserts[j++];
      base = merged;
    }
    this.keys = base;
  }
};
var OrderedView = class extends DataNode {
  // membership of MY view (the window)
  constructor(runtime2, parent, name, cmp, n) {
    super(runtime2, "operator", name, [parent]);
    this.userCmp = cmp;
    this.n = n === void 0 ? Infinity : n;
    this.rows = /* @__PURE__ */ new Map();
    this.tie = /* @__PURE__ */ new Map();
    this.tieSeq = 0;
    for (const [k, row] of parent.snapshot()) {
      this.rows.set(k, row);
      this.tie.set(k, this.tieSeq++);
    }
    this.index = new OrderIndex((a, b) => {
      const c = this.userCmp(this.rows.get(a), this.rows.get(b));
      return c !== 0 ? c : this.tie.get(a) - this.tie.get(b);
    });
    this.index.build([...this.rows.keys()]);
    this.window = this.index.keys.slice(0, this.winLen(this.index.keys.length));
    this.winSet = new Set(this.window);
  }
  winLen(size) {
    return this.n === Infinity ? size : this.n < size ? this.n < 0 ? 0 : this.n : size;
  }
  currentOrder() {
    if (this.runtime.midBatch) return this.pureOrder().keys;
    return this.window;
  }
  snapshot() {
    if (this.runtime.midBatch) {
      const { keys, rows } = this.pureOrder();
      const m2 = /* @__PURE__ */ new Map();
      for (const k of keys) m2.set(k, rows.get(k));
      return m2;
    }
    const m = /* @__PURE__ */ new Map();
    for (const k of this.window) m.set(k, this.rows.get(k));
    return m;
  }
  hasRow(key) {
    if (this.runtime.midBatch) return super.hasRow(key);
    return this.winSet.has(key);
  }
  rowAt(key) {
    if (this.runtime.midBatch) return super.rowAt(key);
    return this.winSet.has(key) ? this.rows.get(key) : void 0;
  }
  // Pure recompute from the parent (flush-on-read, SCHEDULE clause 2b): sort
  // the parent's mid-batch snapshot with the same comparator. Keys this view
  // already knows keep their tie seq; unseen keys tie in snapshot order after
  // every known key (matching what settle will assign).
  pureOrder() {
    const snap = this.parents[0].snapshot();
    const tmpTie = /* @__PURE__ */ new Map();
    let next = this.tieSeq;
    for (const k of snap.keys()) {
      const t = this.tie.get(k);
      tmpTie.set(k, t === void 0 ? next++ : t);
    }
    const keys = [...snap.keys()].sort((a, b) => {
      const c = this.userCmp(snap.get(a), snap.get(b));
      return c !== 0 ? c : tmpTie.get(a) - tmpTie.get(b);
    });
    return { keys: keys.slice(0, this.winLen(keys.length)), rows: snap };
  }
  settle(seq, origin) {
    const input = this.in0;
    if (input === null) return null;
    const preWindow = this.window;
    const preSet = this.winSet;
    const dmap = /* @__PURE__ */ new Map();
    const toInsert = [];
    const removedIdx = [];
    const pendingRow = /* @__PURE__ */ new Map();
    const pendingDel = [];
    for (const d of input.rows) {
      dmap.set(d.key, d);
      switch (d.op) {
        case "add":
          this.rows.set(d.key, d.row);
          this.tie.set(d.key, this.tieSeq++);
          toInsert.push(d.key);
          break;
        case "remove":
          removedIdx.push(d.key);
          pendingDel.push(d.key);
          break;
        case "update": {
          if (!this.rows.has(d.key)) {
            this.rows.set(d.key, d.row);
            this.tie.set(d.key, this.tieSeq++);
            toInsert.push(d.key);
            break;
          }
          if (this.userCmp(this.rows.get(d.key), d.row) !== 0) {
            removedIdx.push(d.key);
            pendingRow.set(d.key, d.row);
            toInsert.push(d.key);
          } else {
            this.rows.set(d.key, d.row);
          }
          break;
        }
      }
    }
    if (removedIdx.length + toInsert.length > 32) {
      for (const [k, row] of pendingRow) this.rows.set(k, row);
      this.index.reconcile(removedIdx.length > 0 ? new Set(removedIdx) : null, toInsert);
    } else {
      for (const k of removedIdx) this.index.remove(k);
      for (const [k, row] of pendingRow) this.rows.set(k, row);
      for (const k of toInsert) this.index.insert(k);
    }
    for (const k of pendingDel) {
      this.rows.delete(k);
      this.tie.delete(k);
    }
    const newWindow = this.index.keys.slice(0, this.winLen(this.index.keys.length));
    const newSet = new Set(newWindow);
    const out = [];
    for (const k of preWindow) {
      if (newSet.has(k)) continue;
      const d = dmap.get(k);
      const prev = d !== void 0 && d.op !== "add" ? d.prev : this.rows.get(k);
      out.push({ op: "remove", key: k, prev });
    }
    for (const k of newWindow) {
      if (!preSet.has(k)) {
        out.push({ op: "add", key: k, row: this.rows.get(k) });
      } else {
        const d = dmap.get(k);
        if (d !== void 0 && d.op === "update") out.push(d);
      }
    }
    const orderOut = [];
    for (let i = preWindow.length - 1; i >= 0; i--) {
      if (!newSet.has(preWindow[i])) orderOut.push({ op: "orderRemove", key: preWindow[i], index: i });
    }
    const cur = [];
    for (const k of preWindow) if (newSet.has(k)) cur.push(k);
    const newSurv = [];
    for (const k of newWindow) if (preSet.has(k)) newSurv.push(k);
    for (let i = 0; i < newSurv.length; i++) {
      if (cur[i] === newSurv[i]) continue;
      const j = cur.indexOf(newSurv[i], i);
      orderOut.push({ op: "orderMove", key: newSurv[i], index: i, from: j });
      cur.splice(j, 1);
      cur.splice(i, 0, newSurv[i]);
    }
    for (let i = 0; i < newWindow.length; i++) {
      if (!preSet.has(newWindow[i])) orderOut.push({ op: "orderInsert", key: newWindow[i], index: i });
    }
    this.window = newWindow;
    this.winSet = newSet;
    if (out.length === 0 && orderOut.length === 0) return null;
    return { seq, origin, rows: out, order: orderOut.length > 0 ? orderOut : void 0, scalar: void 0 };
  }
};
function isBad(x) {
  return x === void 0 || x === null || x !== x;
}
function cmpBy(proj2, dir) {
  return (a, b) => {
    const va = proj2(a);
    const vb = proj2(b);
    const ba = isBad(va);
    const bb = isBad(vb);
    if (ba || bb) return ba === bb ? 0 : ba ? 1 : -1;
    return va < vb ? -dir : va > vb ? dir : 0;
  };
}
var colProj = (col) => (row) => row?.[col];
function az(src, by, n) {
  const cmp = typeof by === "string" ? cmpBy(colProj(by), 1) : by;
  return new OrderedView(src.runtime, src, "az", cmp, n);
}
function za(src, by, n) {
  const cmp = typeof by === "string" ? cmpBy(colProj(by), -1) : (a, b) => by(b, a);
  return new OrderedView(src.runtime, src, "za", cmp, n);
}
function top(src, n) {
  return new OrderedView(src.runtime, src, "top", cmpBy((r) => r, -1), n);
}
function limit(src, n) {
  return new OrderedView(src.runtime, src, "limit", () => 0, n);
}
var windowKey = (name, by, n) => typeof by === "string" && (n === void 0 || typeof n === "number") ? `${name}:${by}:${n === void 0 ? "" : n}` : null;
defineOperator({
  name: "az",
  kind: "ordered",
  category: "holistic",
  declarative: true,
  create: (src, by, n) => az(src, by, n),
  dedupKey: (by, n) => windowKey("az", by, n)
});
defineOperator({
  name: "za",
  kind: "ordered",
  category: "holistic",
  declarative: true,
  create: (src, by, n) => za(src, by, n),
  dedupKey: (by, n) => windowKey("za", by, n)
});
defineOperator({
  name: "top",
  kind: "ordered",
  category: "holistic",
  declarative: true,
  create: (src, n) => top(src, n),
  dedupKey: (n) => typeof n === "number" ? `top:${n}` : null
});
defineOperator({
  name: "limit",
  kind: "ordered",
  category: "holistic",
  declarative: true,
  create: (src, n) => limit(src, n),
  dedupKey: (n) => typeof n === "number" ? `limit:${n}` : null
});

// v3/compat/v2-records.ts
var sclone = (v) => v === void 0 ? v : structuredClone(v);
var V2RecordSink = class {
  wantsOrder = true;
  origin = null;
  constructor(node2, out) {
    this.node = node2;
    this.out = out;
    const snap = node2.snapshot();
    const order = node2.currentOrder();
    this.order = order ? [...order] : null;
    this.out({ type: "update", key: [], value: sclone(materialize(snap, this.order)) });
  }
  apply(batch2) {
    const rowsByKey = /* @__PURE__ */ new Map();
    for (const d of batch2.rows) rowsByKey.set(d.key, d);
    if (this.order !== null && batch2.order) {
      for (const od of batch2.order) {
        if (od.op === "orderRemove") {
          const d = rowsByKey.get(od.key);
          this.order.splice(od.index, 1);
          if (d && d.op === "remove") {
            rowsByKey.delete(od.key);
            if (d.prev !== void 0)
              this.out({ type: "remove", key: [String(od.index)], value: sclone(d.prev) });
          }
        } else if (od.op === "orderInsert") {
          const d = rowsByKey.get(od.key);
          this.order.splice(od.index, 0, od.key);
          if (d && d.op === "add") {
            rowsByKey.delete(od.key);
            this.out({ type: "insert", key: [], value: sclone(d.row), at: od.index });
          }
        } else {
          this.out({ type: "move", from: od.from, to: od.index });
          this.order.splice(od.from, 1);
          this.order.splice(od.index, 0, od.key);
        }
      }
    }
    for (const d of rowsByKey.values()) {
      const name = this.order !== null ? String(this.order.indexOf(d.key)) : String(d.key);
      switch (d.op) {
        case "add":
          this.out({ type: "insert", key: [], value: sclone(d.row), at: this.order !== null ? Number(name) : d.key });
          break;
        case "remove":
          if (d.prev !== void 0)
            this.out({ type: "remove", key: [name], value: sclone(d.prev) });
          break;
        case "update": {
          const value2 = d.path.length ? leafAt(d.row, d.path) : d.row;
          this.out({ type: "update", key: [name, ...d.path.map(String)], value: sclone(value2) });
          break;
        }
      }
    }
    if (batch2.scalar) this.out({ type: "update", key: [], value: sclone(batch2.scalar.next) });
  }
};
function materialize(snap, order) {
  if (order) return order.map((k) => snap.get(k));
  const o = {};
  for (const [k, v] of snap) o[String(k)] = v;
  return o;
}

// v3/ops/misc.ts
var TrackedScalarNode = class extends ScalarNode {
  constructor(runtime2, parent, name, col, read) {
    super(runtime2, parent, name);
    this.col = col;
    const base = read ?? (col === void 0 ? (r) => r : (r) => r?.[col]);
    this.projFn = (row) => {
      const x = base(row);
      return x === void 0 || x === null ? void 0 : x;
    };
    this.tracked = /* @__PURE__ */ new Map();
    for (const [k, row] of parent.snapshot()) {
      const x = this.projFn(row);
      if (x !== void 0) {
        this.tracked.set(k, x);
        this.delta(void 0, x);
      }
    }
    this.cur = this.read();
  }
  applyDelta(d) {
    switch (d.op) {
      case "add": {
        const x = this.projFn(d.row);
        if (x !== void 0) {
          this.tracked.set(d.key, x);
          this.delta(void 0, x);
        }
        break;
      }
      case "remove": {
        const o = this.tracked.get(d.key);
        if (o !== void 0) {
          this.tracked.delete(d.key);
          this.delta(o, void 0);
        }
        break;
      }
      case "update": {
        const o = this.tracked.get(d.key);
        const x = this.projFn(d.row);
        if (x === void 0) {
          if (o !== void 0) {
            this.tracked.delete(d.key);
            this.delta(o, void 0);
          }
        } else {
          this.tracked.set(d.key, x);
          if (!Object.is(o, x)) this.delta(o, x);
        }
        break;
      }
    }
  }
};
var MaxNode = class extends TrackedScalarNode {
  constructor(runtime2, parent, col) {
    super(runtime2, parent, "max", col);
  }
  delta(o, n) {
    if (o !== void 0) {
      if (this.tracked.size === 0) {
        this.best = void 0;
        this.stale = false;
      } else if (this.stale !== true && !(o < this.best)) {
        this.stale = true;
      }
    }
    if (n !== void 0 && this.stale !== true) {
      if (this.best === void 0 || n > this.best) this.best = n;
    }
  }
  read() {
    if (this.stale === true) {
      this.stale = false;
      let m;
      for (const v of this.tracked.values()) if (m === void 0 || v > m) m = v;
      this.best = m;
    }
    return this.best;
  }
  recompute(snap) {
    let m;
    for (const row of snap.values()) {
      const x = this.projFn(row);
      if (x === void 0) continue;
      if (m === void 0 || x > m) m = x;
    }
    return m;
  }
};
var MinNode = class extends TrackedScalarNode {
  constructor(runtime2, parent, col) {
    super(runtime2, parent, "min", col);
  }
  delta(o, n) {
    if (o !== void 0) {
      if (this.tracked.size === 0) {
        this.best = void 0;
        this.stale = false;
      } else if (this.stale !== true && !(o > this.best)) {
        this.stale = true;
      }
    }
    if (n !== void 0 && this.stale !== true) {
      if (this.best === void 0 || n < this.best) this.best = n;
    }
  }
  read() {
    if (this.stale === true) {
      this.stale = false;
      let m;
      for (const v of this.tracked.values()) if (m === void 0 || v < m) m = v;
      this.best = m;
    }
    return this.best;
  }
  recompute(snap) {
    let m;
    for (const row of snap.values()) {
      const x = this.projFn(row);
      if (x === void 0) continue;
      if (m === void 0 || x < m) m = x;
    }
    return m;
  }
};
var SomeNode = class extends TrackedScalarNode {
  constructor(runtime2, parent, fn) {
    super(runtime2, parent, "some", void 0, (r) => !!fn(r));
  }
  delta(o, n) {
    let c = this.trueCount ?? 0;
    if (o === true) c--;
    if (n === true) c++;
    this.trueCount = c;
  }
  read() {
    return (this.trueCount ?? 0) > 0;
  }
  recompute(snap) {
    for (const row of snap.values()) if (this.projFn(row) === true) return true;
    return false;
  }
};
var EveryNode = class extends TrackedScalarNode {
  constructor(runtime2, parent, fn) {
    super(runtime2, parent, "every", void 0, (r) => !!fn(r));
  }
  delta(o, n) {
    let c = this.trueCount ?? 0;
    if (o === true) c--;
    if (n === true) c++;
    this.trueCount = c;
  }
  read() {
    return (this.trueCount ?? 0) === this.tracked.size;
  }
  recompute(snap) {
    for (const row of snap.values()) if (this.projFn(row) !== true) return false;
    return true;
  }
};
function assertPlainInit(init) {
  if (init instanceof DataNode)
    throw new Error(
      "data: reduce(): init must be a plain value or a thunk, not a reactive node \u2014 a fold seed is its identity element, not a reactive input. For a reactive base, derive it upstream (filter/gt/between) and fold the derived view."
    );
}
function deepEq(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b;
    return a.length === bb.length && a.every((v, i) => deepEq(v, bb[i]));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!deepEq(a[k], b[k])) return false;
  return true;
}
var ReduceNode = class extends ScalarNode {
  constructor(runtime2, parent, fn, init) {
    super(runtime2, parent, "reduce");
    assertPlainInit(init);
    this.fn = fn;
    this.init = init;
    this.cur = this.recompute(parent.snapshot());
  }
  applyDelta() {
  }
  read() {
    return this.recompute(this.parents[0].snapshot());
  }
  recompute(snap) {
    let acc = this.init !== null && typeof this.init === "object" ? structuredClone(this.init) : this.init;
    const order = this.parents[0].currentOrder();
    if (order !== null) {
      for (const k of order) if (snap.has(k)) acc = this.fn(acc, snap.get(k), k);
    } else {
      for (const [k, row] of snap) acc = this.fn(acc, row, k);
    }
    return acc;
  }
};
var ReduceIncrementalNode = class extends ScalarNode {
  constructor(runtime2, parent, addFn, removeFn, init) {
    super(runtime2, parent, "reduce");
    assertPlainInit(init);
    this.addFn = addFn;
    this.removeFn = removeFn;
    this.init = init;
    let acc = this.seed();
    for (const [k, row] of parent.snapshot()) acc = addFn(acc, row, k);
    this.acc = acc;
    this.cur = this.publishable();
  }
  seed() {
    return typeof this.init === "function" ? this.init() : this.init;
  }
  publishable() {
    return this.acc !== null && typeof this.acc === "object" ? structuredClone(this.acc) : this.acc;
  }
  applyDelta(d) {
    switch (d.op) {
      case "add":
        this.acc = this.addFn(this.acc, d.row, d.key);
        break;
      case "remove":
        this.acc = this.removeFn(this.acc, d.prev, d.key);
        break;
      case "update":
        this.acc = this.addFn(this.removeFn(this.acc, d.prev, d.key), d.row, d.key);
        break;
    }
  }
  read() {
    return this.acc;
  }
  recompute(snap) {
    let acc = this.seed();
    for (const [k, row] of snap) acc = this.addFn(acc, row, k);
    return acc;
  }
  settle(seq, origin) {
    const input = this.in0;
    if (input === null) return null;
    for (const d of input.rows) this.applyDelta(d);
    const next = this.publishable();
    if (deepEq(this.cur, next)) return null;
    const prev = this.cur;
    this.cur = next;
    return { seq, origin, rows: [], order: void 0, scalar: { prev, next } };
  }
};
var DistinctNode = class extends DataNode {
  constructor(runtime2, parent, fn) {
    super(runtime2, "operator", "distinct", [parent]);
    this.fn = fn ?? ((r) => r);
    this.pos = /* @__PURE__ */ new Map();
    this.projOf = /* @__PURE__ */ new Map();
    this.dkOf = /* @__PURE__ */ new Map();
    this.holders = /* @__PURE__ */ new Map();
    this.view = /* @__PURE__ */ new Map();
    this.counter = 0;
    for (const [k, row] of parent.snapshot()) this._admit(k, row);
    for (const dk of this.holders.keys()) this.view.set(dk, this._exposed(dk));
  }
  _admit(k, row) {
    const v = this.fn(row);
    const dk = String(v);
    this.pos.set(k, this.counter++);
    this.projOf.set(k, v);
    this.dkOf.set(k, dk);
    let set = this.holders.get(dk);
    if (set === void 0) this.holders.set(dk, set = /* @__PURE__ */ new Set());
    set.add(k);
    return dk;
  }
  _expel(k) {
    const dk = this.dkOf.get(k);
    const set = this.holders.get(dk);
    set.delete(k);
    if (set.size === 0) this.holders.delete(dk);
    this.pos.delete(k);
    this.projOf.delete(k);
    this.dkOf.delete(k);
    return dk;
  }
  // The representative's projected value: min arrival position wins.
  _exposed(dk) {
    const set = this.holders.get(dk);
    let bestK;
    let bestP = Infinity;
    for (const k of set) {
      const p = this.pos.get(k);
      if (p < bestP) {
        bestP = p;
        bestK = k;
      }
    }
    return this.projOf.get(bestK);
  }
  snapshot() {
    if (this.runtime.midBatch) {
      const m = /* @__PURE__ */ new Map();
      for (const row of this.parents[0].snapshot().values()) {
        const v = this.fn(row);
        const dk = String(v);
        if (!m.has(dk)) m.set(dk, v);
      }
      return m;
    }
    return new Map(this.view);
  }
  settle(seq, origin) {
    const input = this.in0;
    if (input === null) return null;
    const touched = /* @__PURE__ */ new Set();
    for (const d of input.rows) {
      switch (d.op) {
        case "add":
          touched.add(this._admit(d.key, d.row));
          break;
        case "remove":
          touched.add(this._expel(d.key));
          break;
        case "update": {
          const oldDk = this.dkOf.get(d.key);
          const v = this.fn(d.row);
          const dk = String(v);
          touched.add(oldDk);
          if (dk === oldDk) {
            this.projOf.set(d.key, v);
          } else {
            touched.add(dk);
            const set = this.holders.get(oldDk);
            set.delete(d.key);
            if (set.size === 0) this.holders.delete(oldDk);
            this.projOf.set(d.key, v);
            this.dkOf.set(d.key, dk);
            let ns = this.holders.get(dk);
            if (ns === void 0) this.holders.set(dk, ns = /* @__PURE__ */ new Set());
            ns.add(d.key);
          }
          break;
        }
      }
    }
    const out = [];
    for (const dk of touched) {
      const was = this.view.has(dk);
      const prev = this.view.get(dk);
      if (this.holders.has(dk)) {
        const val = this._exposed(dk);
        if (!was) {
          this.view.set(dk, val);
          out.push({ op: "add", key: dk, row: val });
        } else if (!Object.is(prev, val)) {
          this.view.set(dk, val);
          out.push({ op: "update", key: dk, row: val, prev, path: [] });
        }
      } else if (was) {
        this.view.delete(dk);
        out.push({ op: "remove", key: dk, prev });
      }
    }
    return out.length ? { seq, origin, rows: out, order: void 0, scalar: void 0 } : null;
  }
};
function tapHasParam(fn) {
  if (typeof fn !== "function") return false;
  if (fn.length > 0) return true;
  const s = Function.prototype.toString.call(fn);
  if (/^\s*(?:async\s+)?[A-Za-z_$][\w$]*\s*=>/.test(s)) return true;
  const m = s.match(/\(([^)]*)\)/);
  return !!(m && m[1].trim() !== "");
}
var TapNode = class extends DataNode {
  constructor(runtime2, parent, fn) {
    super(runtime2, "operator", "tap", [parent]);
    if (typeof fn !== "function") throw new Error("data: tap(fn) requires a function");
    if (tapHasParam(fn)) {
      this.connect(new V2RecordSink(this, (r) => fn(r)));
    } else {
      fn();
      this.connect({ wantsOrder: false, origin: null, apply: () => fn() });
    }
  }
  snapshot() {
    return this.parents[0].snapshot();
  }
  currentOrder() {
    return this.parents[0].currentOrder();
  }
  settle() {
    return this.in0;
  }
};
var ToValueNode = class extends ScalarNode {
  constructor(runtime2, parent, fn) {
    super(runtime2, parent, "to");
    this.fn = fn;
    this.cur = fn(materialize(parent.snapshot(), parent.currentOrder()), void 0);
  }
  applyDelta() {
  }
  read() {
    const p = this.parents[0];
    return this.fn(materialize(p.snapshot(), p.currentOrder()), this.cur);
  }
  recompute(snap) {
    return this.fn(materialize(snap, this.parents[0].currentOrder()), this.cur);
  }
};
var KeysNode = class extends DataNode {
  constructor(runtime2, parent) {
    super(runtime2, "operator", "keys", [parent]);
    this.view = /* @__PURE__ */ new Map();
    for (const k of parent.snapshot().keys()) this.view.set(k, String(k));
  }
  snapshot() {
    if (this.runtime.midBatch) {
      const m = /* @__PURE__ */ new Map();
      for (const k of this.parents[0].snapshot().keys()) m.set(k, String(k));
      return m;
    }
    return new Map(this.view);
  }
  settle(seq, origin) {
    const input = this.in0;
    if (input === null) return null;
    const out = [];
    for (const d of input.rows) {
      if (d.op === "add") {
        const s = String(d.key);
        this.view.set(d.key, s);
        out.push({ op: "add", key: d.key, row: s });
      } else if (d.op === "remove") {
        const s = this.view.get(d.key);
        this.view.delete(d.key);
        out.push({ op: "remove", key: d.key, prev: s });
      }
    }
    return out.length ? { seq, origin, rows: out, order: void 0, scalar: void 0 } : null;
  }
};
var ValuesNode = class extends DataNode {
  constructor(runtime2, parent) {
    super(runtime2, "operator", "values", [parent]);
  }
  snapshot() {
    return this.parents[0].snapshot();
  }
  settle(seq, origin) {
    const input = this.in0;
    if (input === null) return null;
    const rows = input.rows;
    return rows.length ? { seq, origin, rows, order: void 0, scalar: void 0 } : null;
  }
};
function max(src, col) {
  return new MaxNode(src.runtime, src, col);
}
function min(src, col) {
  return new MinNode(src.runtime, src, col);
}
function some(src, fn) {
  return new SomeNode(src.runtime, src, fn);
}
function every(src, fn) {
  return new EveryNode(src.runtime, src, fn);
}
function reduce(src, fnOrAdd, removeOrInit, init) {
  return typeof removeOrInit === "function" && !(removeOrInit instanceof DataNode) ? new ReduceIncrementalNode(src.runtime, src, fnOrAdd, removeOrInit, init) : new ReduceNode(src.runtime, src, fnOrAdd, removeOrInit);
}
function distinct(src, fn) {
  return new DistinctNode(src.runtime, src, fn);
}
function tap(src, fn) {
  return new TapNode(src.runtime, src, fn);
}
function toValue(src, fn) {
  return new ToValueNode(src.runtime, src, fn);
}
function keysView(src) {
  return new KeysNode(src.runtime, src);
}
function valuesView(src) {
  return new ValuesNode(src.runtime, src);
}
defineOperator({
  name: "max",
  kind: "aggregate",
  category: "holistic",
  declarative: true,
  create: (src, col) => max(src, col),
  dedupKey: (col) => typeof col === "string" || col === void 0 ? `max:${col ?? ""}` : null
});
defineOperator({
  name: "min",
  kind: "aggregate",
  category: "holistic",
  declarative: true,
  create: (src, col) => min(src, col),
  dedupKey: (col) => typeof col === "string" || col === void 0 ? `min:${col ?? ""}` : null
});
defineOperator({
  name: "some",
  kind: "aggregate",
  category: "aggregate-decomposable",
  declarative: false,
  create: (src, fn) => some(src, fn),
  dedupKey: () => null
});
defineOperator({
  name: "every",
  kind: "aggregate",
  category: "aggregate-decomposable",
  declarative: false,
  create: (src, fn) => every(src, fn),
  dedupKey: () => null
});
defineOperator({
  name: "reduce",
  kind: "aggregate",
  category: "holistic",
  declarative: false,
  create: (src, fnOrAdd, removeOrInit, init) => reduce(src, fnOrAdd, removeOrInit, init),
  dedupKey: () => null
});
defineOperator({
  name: "distinct",
  kind: "bucket",
  category: "holistic",
  declarative: false,
  create: (src, fn) => distinct(src, fn),
  dedupKey: (fn) => fn === void 0 ? "distinct" : null
});
defineOperator({
  name: "tap",
  kind: "effect",
  category: "iter",
  declarative: false,
  create: (src, fn) => tap(src, fn),
  dedupKey: () => null
});
defineOperator({
  name: "to",
  kind: "rebuild",
  category: "holistic",
  declarative: false,
  create: (src, fn) => toValue(src, fn),
  dedupKey: () => null
});
defineOperator({
  name: "keys",
  kind: "row",
  category: "iter",
  declarative: true,
  create: (src) => keysView(src),
  dedupKey: () => "keys"
});
defineOperator({
  name: "values",
  kind: "row",
  category: "iter",
  declarative: true,
  create: (src) => valuesView(src),
  dedupKey: () => "values"
});

// v3/kernel/runtime.ts
var REENTRANCY_CAP = 1e3;
var byHeight = (a, b) => a.height - b.height;
var Runtime = class {
  seq = 0;
  batchDepth = 0;
  flushing = false;
  draining = false;
  // executing ONE queued re-entrant write (apply directly)
  dirty = [];
  // array + per-source inDirty flag: no Set hashing/iterator on the hot path
  queue = [];
  // re-entrant writes → next commit(s), FIFO (origin captured at issue time)
  currentOrigin = null;
  defaultOrigin = /* @__PURE__ */ Symbol("user");
  hooks = /* @__PURE__ */ new Set();
  registry = /* @__PURE__ */ new Set();
  // True during the apply phase of an open batch() — derived reads must
  // recompute pure (flush-on-read) rather than trust materialized state.
  get midBatch() {
    return this.batchDepth > 0;
  }
  register(node2) {
    this.registry.add(new WeakRef(node2));
  }
  graph() {
    const out = [];
    for (const ref of this.registry) {
      const n = ref.deref();
      if (n === void 0 || n.disposed) {
        this.registry.delete(ref);
        continue;
      }
      out.push({
        id: n.id,
        kind: n.kind,
        op: n.opName,
        parents: n.parents.map((p) => p.id),
        height: n.height
      });
    }
    return out;
  }
  onCommit(hook) {
    this.hooks.add(hook);
    return { dispose: () => this.hooks.delete(hook) };
  }
  // ── the write protocol (hot path, zero closure allocation) ────────────────
  // A source checks canWriteNow(); if true it applies its mutation inline and
  // calls written(). If false (a write inside an effect), it queues a thunk —
  // the closure allocation is confined to the rare re-entrant path (clause 5).
  canWriteNow() {
    return !this.flushing || this.draining;
  }
  queueWrite(w) {
    this.queue.push({ origin: this.currentOrigin, w });
  }
  written(source) {
    if (!source.inDirty) {
      source.inDirty = true;
      this.dirty.push(source);
    }
    if (this.batchDepth === 0 && !this.flushing) this.flush();
  }
  batch(fn, origin) {
    if (this.flushing && !this.draining) {
      this.queue.push({ origin: this.currentOrigin, w: () => this.batch(fn, origin) });
      return void 0;
    }
    this.batchDepth++;
    const prevOrigin = this.currentOrigin;
    if (origin) this.currentOrigin = origin;
    try {
      return fn();
    } finally {
      this.batchDepth--;
      try {
        if (this.batchDepth === 0 && this.dirty.length > 0 && !this.flushing) this.flush();
      } finally {
        this.currentOrigin = prevOrigin;
      }
    }
  }
  withOrigin(origin, fn) {
    const prev = this.currentOrigin;
    this.currentOrigin = origin;
    try {
      return fn();
    } finally {
      this.currentOrigin = prev;
    }
  }
  flush() {
    this.flushing = true;
    const errors = [];
    try {
      let rounds = 0;
      while (this.dirty.length > 0 || this.queue.length > 0) {
        if (++rounds > REENTRANCY_CAP)
          throw new Error(`data: re-entrant write cascade exceeded ${REENTRANCY_CAP} commits \u2014 cycle?`);
        if (this.dirty.length === 0) {
          const q = this.queue.shift();
          this.draining = true;
          const prevO = this.currentOrigin;
          this.currentOrigin = q.origin;
          try {
            q.w();
          } finally {
            this.currentOrigin = prevO;
            this.draining = false;
          }
          continue;
        }
        this.commitOnce(errors);
      }
    } finally {
      this.flushing = false;
    }
    if (errors.length > 0)
      throw new AggregateError(errors, `data: ${errors.length} effect(s) failed during commit`);
  }
  // Reused per-commit scratch (cleared after each commit; commits never nest).
  _emitN = [];
  _emitB = [];
  _agenda = [];
  commitOnce(errors) {
    const seq = ++this.seq;
    const origin = this.currentOrigin ?? this.defaultOrigin;
    const measure = this.hooks.size > 0;
    const stats = measure ? [] : null;
    const emitN = this._emitN;
    const emitB = this._emitB;
    const agenda = this._agenda;
    const dirty = this.dirty;
    for (let di = 0; di < dirty.length; di++) {
      const s = dirty[di];
      s.inDirty = false;
      const t0 = measure ? performance.now() : 0;
      const batch2 = s.settle(seq, origin);
      if (batch2 === null) continue;
      if (stats) stats.push({ id: s.id, deltas: countDeltas(batch2), ms: performance.now() - t0 });
      emitN.push(s);
      emitB.push(batch2);
      const kids = s.children;
      for (let ki = 0; ki < kids.length; ki++) {
        const c = kids[ki];
        c.ingest(s, batch2);
        if (c.settledSeq !== seq && c.settledSeq !== -seq) {
          c.settledSeq = -seq;
          agenda.push(c);
        }
      }
    }
    dirty.length = 0;
    agenda.sort(byHeight);
    for (let i = 0; i < agenda.length; i++) {
      const n = agenda[i];
      if (n.settledSeq === seq) continue;
      n.settledSeq = seq;
      const t0 = measure ? performance.now() : 0;
      const out = n.settle(seq, origin);
      n.clearInputs();
      if (out === null) continue;
      if (stats) stats.push({ id: n.id, deltas: countDeltas(out), ms: performance.now() - t0 });
      emitN.push(n);
      emitB.push(out);
      const kids = n.children;
      for (let ki = 0; ki < kids.length; ki++) {
        const c = kids[ki];
        c.ingest(n, out);
        if (c.settledSeq !== seq && c.settledSeq !== -seq) {
          c.settledSeq = -seq;
          let j = agenda.length;
          while (j > i + 1 && agenda[j - 1].height > c.height) j--;
          agenda.splice(j, 0, c);
        }
      }
    }
    for (let i = 0; i < emitN.length; i++) {
      const effects = emitN[i].effects;
      if (effects.length === 0) continue;
      const batch2 = emitB[i];
      for (let ei = 0; ei < effects.length; ei++) {
        const entry = effects[ei];
        if (entry.origin !== null && entry.origin === batch2.origin) continue;
        try {
          entry.apply(batch2);
        } catch (e) {
          errors.push(e);
        }
      }
    }
    emitN.length = 0;
    emitB.length = 0;
    agenda.length = 0;
    if (stats) {
      const info = { seq, origin, nodes: stats };
      for (const h2 of this.hooks) {
        try {
          h2(info);
        } catch (e) {
          errors.push(e);
        }
      }
    }
  }
};
function countDeltas(b) {
  return b.rows.length + (b.order?.length ?? 0) + (b.scalar ? 1 : 0);
}

// v3/contract/index.ts
var SCHEMA_VERSION = 3;
var RESERVED = /* @__PURE__ */ new Set([
  // built-ins
  "get",
  "set",
  "update",
  "insert",
  "remove",
  "patch",
  "ingest",
  "connect",
  "snapshot",
  "raf",
  "first",
  "last",
  "mirror",
  "dispose",
  // operators
  "filter",
  "between",
  "gt",
  "lt",
  "gte",
  "lte",
  "az",
  "za",
  "top",
  "limit",
  "page",
  "length",
  "sum",
  "avg",
  "max",
  "min",
  "some",
  "every",
  "intersect",
  "union",
  "except",
  "group",
  "distinct",
  "map",
  "to",
  "reduce",
  "tap",
  "keys",
  "values",
  "reverse",
  "join"
]);

// v3/ops/reactive.ts
var NODE = /* @__PURE__ */ Symbol.for("data.v3.node");
var VALUE = /* @__PURE__ */ Symbol.for("data.v3.value");
var PKEY = "p";
function materializeNode(n) {
  const snap = n.snapshot();
  const order = n.currentOrder();
  if (order !== null) return order.map((k) => snap.get(k));
  const out = {};
  for (const [k, v] of snap) out[String(k)] = v;
  return out;
}
function reactiveArg(arg) {
  if (arg instanceof DataNode) {
    const n = arg;
    return {
      isReactive: true,
      node: n,
      identity: `@${n.id}`,
      // scalar nodes read value(); collection nodes read the materialized
      // whole (a raw-node arg is an internal-composition convenience — the
      // public path is a handle, whose [value] already resolves paths).
      current: () => n.kind === "scalar" ? n.value() : materializeNode(n)
    };
  }
  if (arg !== null && typeof arg === "object") {
    const n = arg[NODE];
    if (n instanceof DataNode) {
      return {
        isReactive: true,
        node: n,
        identity: `@${n.id}:${String(arg)}`,
        current: () => arg[VALUE]
      };
    }
  }
  return { isReactive: false, node: null, identity: null, current: () => arg };
}
function bindParam(owner, arg, onChange) {
  const ra = reactiveArg(arg);
  if (!ra.isReactive) return arg;
  const argNode = ra.node;
  if (argNode.runtime !== owner.runtime)
    throw new Error(
      `data: reactive arg (node #${argNode.id}) belongs to a different runtime than the operator it parameterizes`
    );
  const current2 = ra.current;
  const handle = argNode.connect({
    wantsOrder: false,
    origin: null,
    apply() {
      onChange(current2());
    }
  });
  const ownerDispose = owner.dispose.bind(owner);
  owner.dispose = function() {
    handle.dispose();
    ownerDispose();
  };
  return current2();
}
function splitInputs(node2) {
  const dataParent = node2.parents[0];
  let data = null;
  let param = null;
  if (node2.in0 !== null) {
    if (node2.inFrom0 === dataParent) data = node2.in0;
    else param = node2.in0;
  }
  if (node2.inMore !== null) {
    for (const m of node2.inMore) {
      if (m.from === dataParent) data = m.batch;
      else param = m.batch;
    }
  }
  return { data, param };
}
function lastParam(batch2, fallback) {
  let v = fallback;
  for (const d of batch2.rows) if (d.op !== "remove") v = d.row;
  return v;
}
function adoptParam(node2, paramSrc) {
  node2.parents.push(paramSrc);
  paramSrc.children.push(node2);
}
function mergePend(map2, d) {
  const prior = map2.get(d.key);
  if (prior === void 0) {
    map2.set(d.key, d);
    return;
  }
  if (prior.op === "add") {
    if (d.op === "update") map2.set(d.key, { op: "add", key: d.key, row: d.row });
    else if (d.op === "remove") map2.delete(d.key);
  } else if (prior.op === "update") {
    if (d.op === "update") {
      const samePath = prior.path.length === d.path.length && prior.path.every((p, i) => p === d.path[i]);
      map2.set(d.key, { op: "update", key: d.key, row: d.row, prev: prior.prev, path: samePath ? d.path : [] });
    } else if (d.op === "remove") {
      map2.set(d.key, { op: "remove", key: d.key, prev: prior.prev });
    }
  } else {
    if (d.op === "add") map2.set(d.key, { op: "update", key: d.key, row: d.row, prev: prior.prev, path: [] });
  }
}
function publishScalar(node2, seq, origin) {
  const next = node2.read();
  if (Object.is(node2.cur, next)) return null;
  const prev = node2.cur;
  node2.cur = next;
  return { seq, origin, rows: [], order: void 0, scalar: { prev, next } };
}
function normN(v) {
  const num = typeof v === "number" ? v : Number(v);
  return Number.isNaN(num) ? Infinity : num;
}
function normCol(v) {
  return v === void 0 || v === null ? void 0 : typeof v === "string" ? v : String(v);
}
function projNorm(col, row) {
  const x = col === void 0 ? row : row?.[col];
  return x === void 0 || x === null ? void 0 : x;
}
var CMP2 = {
  gt: (a, b) => a > b,
  lt: (a, b) => a < b,
  gte: (a, b) => a >= b,
  lte: (a, b) => a <= b
};
var CompareRNode = class extends FilterNode {
  // read-your-writes source for mid-batch reads
  constructor(runtime2, parent, paramSrc, op, col, t0) {
    const box = { t: t0 };
    const cmp = CMP2[op];
    super(runtime2, parent, (row) => cmp(row?.[col], box.t), op);
    this.box = box;
    this.paramSrc = paramSrc;
    this.target = () => paramSrc.get(PKEY);
    adoptParam(this, paramSrc);
  }
  threshold() {
    return this.target();
  }
  snapshot() {
    if (this.runtime.midBatch) {
      const saved = this.box.t;
      this.box.t = this.target();
      try {
        return super.snapshot();
      } finally {
        this.box.t = saved;
      }
    }
    return super.snapshot();
  }
  settle(seq, origin) {
    const { data, param } = splitInputs(this);
    if (data === null && param === null) return null;
    const pending = /* @__PURE__ */ new Map();
    if (data !== null) {
      this.in0 = data;
      this.inFrom0 = this.parents[0];
      this.inMore = null;
      const b = super.settle(seq, origin);
      if (b !== null) for (const d of b.rows) pending.set(d.key, d);
    }
    if (param !== null) {
      this.box.t = lastParam(param, this.box.t);
      for (const [k, row] of this.parents[0].snapshot()) {
        const was = this.view.has(k);
        const now = this.pred(row, k);
        if (was && !now) {
          const prev = this.view.get(k);
          this.view.delete(k);
          mergePend(pending, { op: "remove", key: k, prev });
        } else if (!was && now) {
          this.view.set(k, row);
          mergePend(pending, { op: "add", key: k, row });
        }
      }
    }
    if (pending.size === 0) return null;
    return { seq, origin, rows: [...pending.values()], order: void 0, scalar: void 0 };
  }
  dispose() {
    super.dispose();
    this.paramSrc.dispose();
  }
};
function compareR(src, op, col, threshold) {
  const ra = reactiveArg(threshold);
  const t0 = ra.current();
  const paramSrc = new SourceNode(src.runtime, { [PKEY]: t0 }, `param:${op}`);
  const node2 = new CompareRNode(src.runtime, src, paramSrc, op, col, t0);
  if (ra.isReactive) {
    node2.target = ra.current;
    bindParam(node2, threshold, (v) => paramSrc.write(PKEY, [], v));
  }
  return node2;
}
function cmpFor(name, by) {
  if (name === "limit") return () => 0;
  if (name === "top") return cmpBy((r) => r, -1);
  if (typeof by === "string") return cmpBy((row) => row?.[by], name === "za" ? -1 : 1);
  const f = by;
  return name === "za" ? (a, b) => f(b, a) : f;
}
var OrderedRNode = class extends OrderedView {
  constructor(runtime2, parent, paramSrc, name, cmp, n0) {
    super(runtime2, parent, name, cmp, n0 === Infinity ? void 0 : n0);
    this.paramSrc = paramSrc;
    this.target = () => paramSrc.get(PKEY);
    adoptParam(this, paramSrc);
  }
  windowSize() {
    return normN(this.target());
  }
  currentOrder() {
    if (this.runtime.midBatch) {
      const saved = this.n;
      this.n = normN(this.target());
      try {
        return super.currentOrder();
      } finally {
        this.n = saved;
      }
    }
    return super.currentOrder();
  }
  snapshot() {
    if (this.runtime.midBatch) {
      const saved = this.n;
      this.n = normN(this.target());
      try {
        return super.snapshot();
      } finally {
        this.n = saved;
      }
    }
    return super.snapshot();
  }
  settle(seq, origin) {
    const { data, param } = splitInputs(this);
    if (data === null && param === null) return null;
    if (param !== null) this.n = normN(lastParam(param, this.n));
    this.in0 = data ?? { seq, origin, rows: [], order: void 0, scalar: void 0 };
    this.inFrom0 = this.parents[0];
    this.inMore = null;
    return super.settle(seq, origin);
  }
  dispose() {
    super.dispose();
    this.paramSrc.dispose();
  }
};
function orderedR(src, by, n, name = "az") {
  const ra = reactiveArg(n);
  const n0 = ra.current();
  const paramSrc = new SourceNode(src.runtime, { [PKEY]: n0 }, `param:${name}`);
  const node2 = new OrderedRNode(src.runtime, src, paramSrc, name, cmpFor(name, by), normN(n0));
  if (ra.isReactive) {
    node2.target = ra.current;
    bindParam(node2, n, (v) => paramSrc.write(PKEY, [], v));
  }
  return node2;
}
var SumRNode = class extends SumNode {
  constructor(runtime2, parent, paramSrc, col0) {
    super(runtime2, parent, "sum", col0);
    this.paramSrc = paramSrc;
    this.target = () => paramSrc.get(PKEY);
    adoptParam(this, paramSrc);
  }
  column() {
    return normCol(this.target());
  }
  rebuild() {
    this.tracked = /* @__PURE__ */ new Map();
    this.total = 0;
    for (const [k, row] of this.parents[0].snapshot()) {
      const x = projNorm(this.col, row);
      if (x !== void 0) {
        this.tracked.set(k, x);
        this.total += +x;
      }
    }
  }
  value() {
    if (!this.runtime.midBatch) return this.cur;
    const saved = this.col;
    this.col = normCol(this.target());
    try {
      return this.recompute(this.parents[0].snapshot());
    } finally {
      this.col = saved;
    }
  }
  settle(seq, origin) {
    const { data, param } = splitInputs(this);
    if (data === null && param === null) return null;
    if (param !== null) {
      this.col = normCol(lastParam(param, this.col));
      this.rebuild();
      return publishScalar(this, seq, origin);
    }
    this.in0 = data;
    this.inFrom0 = this.parents[0];
    this.inMore = null;
    return super.settle(seq, origin);
  }
  dispose() {
    super.dispose();
    this.paramSrc.dispose();
  }
};
var AvgRNode = class extends AvgNode {
  constructor(runtime2, parent, paramSrc, col0) {
    super(runtime2, parent, "avg", col0);
    this.paramSrc = paramSrc;
    this.target = () => paramSrc.get(PKEY);
    adoptParam(this, paramSrc);
  }
  column() {
    return normCol(this.target());
  }
  rebuild() {
    this.tracked = /* @__PURE__ */ new Map();
    this.total = 0;
    this.count = 0;
    for (const [k, row] of this.parents[0].snapshot()) {
      const x = projNorm(this.col, row);
      if (x !== void 0) {
        this.tracked.set(k, x);
        this.total += +x;
        this.count++;
      }
    }
  }
  value() {
    if (!this.runtime.midBatch) return this.cur;
    const saved = this.col;
    this.col = normCol(this.target());
    try {
      return this.recompute(this.parents[0].snapshot());
    } finally {
      this.col = saved;
    }
  }
  settle(seq, origin) {
    const { data, param } = splitInputs(this);
    if (data === null && param === null) return null;
    if (param !== null) {
      this.col = normCol(lastParam(param, this.col));
      this.rebuild();
      return publishScalar(this, seq, origin);
    }
    this.in0 = data;
    this.inFrom0 = this.parents[0];
    this.inMore = null;
    return super.settle(seq, origin);
  }
  dispose() {
    super.dispose();
    this.paramSrc.dispose();
  }
};
function sumR(src, col) {
  const ra = reactiveArg(col);
  const c0 = normCol(ra.current());
  const paramSrc = new SourceNode(src.runtime, { [PKEY]: ra.current() }, "param:sum");
  const node2 = new SumRNode(src.runtime, src, paramSrc, c0);
  if (ra.isReactive) {
    node2.target = ra.current;
    bindParam(node2, col, (v) => paramSrc.write(PKEY, [], v));
  }
  return node2;
}
function avgR(src, col) {
  const ra = reactiveArg(col);
  const c0 = normCol(ra.current());
  const paramSrc = new SourceNode(src.runtime, { [PKEY]: ra.current() }, "param:avg");
  const node2 = new AvgRNode(src.runtime, src, paramSrc, c0);
  if (ra.isReactive) {
    node2.target = ra.current;
    bindParam(node2, col, (v) => paramSrc.write(PKEY, [], v));
  }
  return node2;
}
var normBounds = (b) => Array.isArray(b) ? b : [];
function betweenR(src, col, arg) {
  const ra = reactiveArg(arg);
  const node2 = between(src, col, normBounds(ra.current()));
  bindParam(node2, arg, (b) => node2.setBounds(normBounds(b)));
  return node2;
}
function wrapDef(name, reactiveCreate, reactiveKey) {
  const orig = registry.get(name);
  if (orig === void 0) throw new Error(`data: installReactive \u2014 operator ${name} is not registered`);
  const def = {
    name: orig.name,
    kind: orig.kind,
    category: orig.category,
    declarative: orig.declarative,
    create: (src, ...args) => reactiveCreate(src, args) ?? orig.create(src, ...args),
    dedupKey: (...args) => {
      const k = reactiveKey(args);
      if (k !== void 0) return k;
      return orig.dedupKey ? orig.dedupKey(...args) : null;
    }
  };
  registry.set(name, def);
}
var installed = false;
function installReactive() {
  if (installed) return;
  installed = true;
  for (const op of ["gt", "lt", "gte", "lte"]) {
    wrapDef(
      op,
      (src, [col, threshold]) => reactiveArg(threshold).isReactive ? compareR(src, op, col, threshold) : null,
      ([col, threshold]) => {
        const ra = reactiveArg(threshold);
        if (!ra.isReactive) return void 0;
        return typeof col === "string" ? `${op}:${col}:${ra.identity}` : null;
      }
    );
  }
  for (const name of ["az", "za"]) {
    wrapDef(
      name,
      (src, [by, n]) => reactiveArg(n).isReactive ? orderedR(src, by, n, name) : null,
      ([by, n]) => {
        const ra = reactiveArg(n);
        if (!ra.isReactive) return void 0;
        return typeof by === "string" ? `${name}:${by}:${ra.identity}` : null;
      }
    );
  }
  for (const name of ["top", "limit"]) {
    wrapDef(
      name,
      (src, [n]) => reactiveArg(n).isReactive ? orderedR(src, void 0, n, name) : null,
      ([n]) => {
        const ra = reactiveArg(n);
        return ra.isReactive ? `${name}:${ra.identity}` : void 0;
      }
    );
  }
  for (const name of ["sum", "avg"]) {
    wrapDef(
      name,
      (src, [col]) => reactiveArg(col).isReactive ? name === "sum" ? sumR(src, col) : avgR(src, col) : null,
      ([col]) => {
        const ra = reactiveArg(col);
        return ra.isReactive ? `${name}:${ra.identity}` : void 0;
      }
    );
  }
  wrapDef(
    "between",
    (src, [col, bounds]) => reactiveArg(bounds).isReactive ? betweenR(src, col, bounds) : null,
    ([col, bounds]) => {
      const ra = reactiveArg(bounds);
      if (!ra.isReactive) return void 0;
      return typeof col === "string" ? `between:${col}:${ra.identity}` : null;
    }
  );
}

// v3/render/index.ts
var NODE2 = /* @__PURE__ */ Symbol.for("data.v3.node");
var VALUE2 = /* @__PURE__ */ Symbol.for("data.v3.value");
function bind(view, fn) {
  return { kind: "bind", view, fn: fn ?? null };
}
function el(tag, props, ...children) {
  const kids = [];
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (typeof c === "string" || typeof c === "number") kids.push({ kind: "text", s: String(c) });
    else kids.push(c);
  }
  return { kind: "el", tag, props: props ?? null, children: kids };
}
function text(view, fn) {
  return { kind: "rtext", view, fn: fn ?? null };
}
function list(view, rowFn) {
  return { kind: "list", view, rowFn };
}
function nodeOf(view) {
  if (view instanceof DataNode) return view;
  const n = view?.[NODE2];
  if (n instanceof DataNode) return n;
  throw new Error("data/render: expected a view \u2014 a DataNode or a $ handle");
}
function readerOf(view) {
  if (view instanceof DataNode) {
    if (view.kind === "scalar") return () => view.value();
    throw new Error(
      "data/render: text() over a raw collection node \u2014 pass a scalar view (sum/avg/\u2026/to) or a handle"
    );
  }
  if (view != null && view[NODE2] instanceof DataNode) return () => view[VALUE2];
  throw new Error("data/render: text() expects a scalar view or a $ handle");
}
function toText(v) {
  return v == null ? "" : String(v);
}
var SVG_NS = "http://www.w3.org/2000/svg";
function isBindProp(x) {
  return x !== null && typeof x === "object" && x.kind === "bind" && "view" in x;
}
function isView(x) {
  if (x instanceof DataNode) return true;
  return x !== null && typeof x === "object" && x[NODE2] instanceof DataNode;
}
function normAttr(v) {
  return v == null || v === false ? null : v === true ? "" : String(v);
}
function setProp(dom, name, v) {
  if ((name === "checked" || name === "value") && name in dom) {
    if (name === "checked") dom.checked = v === true || v === "";
    else dom.value = v == null ? "" : String(v);
    return true;
  }
  return false;
}
function applyAttr(dom, name, next) {
  if (setProp(dom, name, next)) return;
  if (next === null) dom.removeAttribute(name);
  else dom.setAttribute(name, next);
}
function bindAttr(dom, name, view, fn, scope) {
  const read = readerOf(view);
  const compute = () => normAttr(fn === null ? read() : fn(read()));
  let last = compute();
  if (last !== null || name === "checked" || name === "value") applyAttr(dom, name, last);
  const sub = nodeOf(view).connect({
    wantsOrder: false,
    origin: null,
    apply() {
      const next = compute();
      if (next === last) return;
      last = next;
      applyAttr(dom, name, next);
    }
  });
  scope.add(sub);
}
function materialize2(v, ctx) {
  switch (v.kind) {
    case "text":
      return { vnode: v, dom: ctx.doc.createTextNode(v.s), children: null };
    case "rtext": {
      const n = nodeOf(v.view);
      const raw = readerOf(v.view);
      const fmt = v.fn;
      const read = fmt === null ? raw : () => fmt(raw());
      const tn = ctx.doc.createTextNode(toText(read()));
      const sub = n.connect({
        wantsOrder: false,
        origin: null,
        apply() {
          const s = toText(read());
          if (s !== tn.textContent) tn.textContent = s;
        }
      });
      ctx.scope.add(sub);
      return { vnode: v, dom: tn, children: null };
    }
    case "el": {
      const ns = v.tag === "svg" ? SVG_NS : ctx.ns;
      const dom = ns === null ? ctx.doc.createElement(v.tag) : ctx.doc.createElementNS(ns, v.tag);
      const kidCtx = ns === ctx.ns ? ctx : { doc: ctx.doc, scope: ctx.scope, ns };
      if (v.props !== null) {
        for (const k of Object.keys(v.props)) {
          const pv = v.props[k];
          if (k.startsWith("on") && typeof pv === "function") {
            const evt = k.slice(2).toLowerCase();
            dom.addEventListener(evt, pv);
            ctx.scope.onDispose(() => dom.removeEventListener(evt, pv));
          } else if (isView(pv)) {
            bindAttr(dom, k, pv, null, ctx.scope);
          } else if (isBindProp(pv)) {
            bindAttr(dom, k, pv.view, pv.fn, ctx.scope);
          } else if (pv != null && pv !== false) {
            dom.setAttribute(k, pv === true ? "" : String(pv));
          }
        }
      }
      const kids = [];
      for (const c of v.children) {
        if (c.kind === "list") {
          const binding = new ListBinding(dom, c, kidCtx);
          ctx.scope.add(binding);
          kids.push({ vnode: c, dom: binding.anchor, children: null });
        } else {
          const m = materialize2(c, kidCtx);
          dom.appendChild(m.dom);
          kids.push(m);
        }
      }
      return { vnode: v, dom, children: kids };
    }
    case "list":
      throw new Error("data/render: internal \u2014 list must be materialized by its host");
  }
}
function staticProp(x) {
  return typeof x !== "function" && !isView(x) && !isBindProp(x);
}
function patchProps(dom, prev, next) {
  if (prev === next) return;
  if (next !== null) {
    for (const k of Object.keys(next)) {
      if (k.startsWith("on")) continue;
      const nv = next[k];
      if (!staticProp(nv)) continue;
      const pv = prev !== null && k in prev ? prev[k] : void 0;
      if (pv !== void 0 && !staticProp(pv)) continue;
      const na = normAttr(nv);
      if (normAttr(pv) !== na) applyAttr(dom, k, na);
    }
  }
  if (prev !== null) {
    for (const k of Object.keys(prev)) {
      if (k.startsWith("on") || !staticProp(prev[k])) continue;
      if (next === null || !(k in next)) applyAttr(dom, k, null);
    }
  }
}
function patchRow(m, v) {
  if (m.vnode.kind !== v.kind) return false;
  if (v.kind === "text") {
    if (m.vnode.s !== v.s) m.dom.textContent = v.s;
    m.vnode = v;
    return true;
  }
  if (v.kind === "el") {
    const prev = m.vnode;
    if (prev.tag !== v.tag) return false;
    const next = v.children;
    if (m.children === null || m.children.length !== next.length) return false;
    patchProps(m.dom, prev.props, v.props);
    for (let i = 0; i < next.length; i++) {
      if (!patchRow(m.children[i], next[i])) return false;
    }
    m.vnode = v;
    return true;
  }
  return true;
}
var ListBinding = class {
  constructor(host, vnode, ctx) {
    this.host = host;
    this.doc = ctx.doc;
    this.ns = ctx.ns;
    this.rowFn = vnode.rowFn;
    this.view = nodeOf(vnode.view);
    this.recs = /* @__PURE__ */ new Map();
    this.disposed = false;
    this.anchor = ctx.doc.createTextNode("");
    host.appendChild(this.anchor);
    const snap = this.view.snapshot();
    const ord = this.view.currentOrder();
    this.order = ord === null ? null : ord.slice();
    const keys = ord ?? [...snap.keys()];
    for (const k of keys) {
      const rec = this.buildRow(k, snap.get(k));
      this.recs.set(k, rec);
      this.host.insertBefore(rec.el, this.anchor);
    }
    this.sub = this.view.connect({
      wantsOrder: true,
      origin: null,
      apply: (b) => this.apply(b)
    });
    ctx.scope.add(this.sub);
  }
  // Each row owns a child Scope: its rtext/bind subscriptions and listeners
  // are registered there and die with the row (removeEventListener, finally).
  buildRow(key, row) {
    return this.buildRowFrom(this.rowFn(row, key), key);
  }
  buildRowFrom(vnode, key) {
    const rowScope = new Scope(null);
    const mounted = runInScope(
      rowScope,
      () => materialize2(vnode, { doc: this.doc, scope: rowScope, ns: this.ns })
    );
    return { key, el: mounted.dom, scope: rowScope, mounted };
  }
  apply(batch2) {
    if (this.disposed) return;
    const placeLater = [];
    const ordered = this.order !== null || batch2.order !== void 0;
    for (const d of batch2.rows) {
      switch (d.op) {
        case "add": {
          const rec = this.buildRow(d.key, d.row);
          this.recs.set(d.key, rec);
          if (ordered) placeLater.push(rec);
          else this.host.insertBefore(rec.el, this.anchor);
          break;
        }
        case "remove": {
          const rec = this.recs.get(d.key);
          if (rec === void 0) break;
          this.recs.delete(d.key);
          rec.scope.dispose();
          rec.el.remove();
          break;
        }
        case "update": {
          const rec = this.recs.get(d.key);
          if (rec === void 0) break;
          const next = this.rowFn(d.row, d.key);
          if (!patchRow(rec.mounted, next)) {
            const fresh = this.buildRowFrom(next, d.key);
            this.host.insertBefore(fresh.el, rec.el);
            rec.el.remove();
            rec.scope.dispose();
            this.recs.set(d.key, fresh);
          }
          break;
        }
      }
    }
    if (batch2.order !== void 0) {
      if (this.order === null) this.order = [];
      const ord = this.order;
      for (const od of batch2.order) {
        switch (od.op) {
          case "orderRemove": {
            const i = ord[od.index] === od.key ? od.index : ord.indexOf(od.key);
            if (i >= 0) ord.splice(i, 1);
            break;
          }
          case "orderInsert": {
            const i = od.index < 0 ? 0 : od.index > ord.length ? ord.length : od.index;
            ord.splice(i, 0, od.key);
            const rec = this.recs.get(od.key);
            if (rec !== void 0) this.host.insertBefore(rec.el, this.nextPlaced(i + 1));
            break;
          }
          case "orderMove": {
            const from = od.from !== void 0 && ord[od.from] === od.key ? od.from : ord.indexOf(od.key);
            if (from < 0) break;
            ord.splice(from, 1);
            const i = od.index < 0 ? 0 : od.index > ord.length ? ord.length : od.index;
            ord.splice(i, 0, od.key);
            const rec = this.recs.get(od.key);
            if (rec !== void 0) this.host.insertBefore(rec.el, this.nextPlaced(i + 1));
            break;
          }
        }
      }
    }
    for (const rec of placeLater) {
      if (rec.el.parentNode == null) this.host.insertBefore(rec.el, this.anchor);
    }
  }
  // First already-placed element at or after order position i (added-but-not-
  // yet-placed keys are skipped); the anchor closes the list.
  nextPlaced(i) {
    const ord = this.order;
    for (; i < ord.length; i++) {
      const rec = this.recs.get(ord[i]);
      if (rec !== void 0 && rec.el.parentNode != null) return rec.el;
    }
    return this.anchor;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.sub.dispose();
    for (const rec of this.recs.values()) {
      rec.scope.dispose();
      rec.el.remove();
    }
    this.recs.clear();
    this.anchor.remove();
  }
};
function render(host, ast, _runtime) {
  const doc = globalThis.document;
  if (doc == null)
    throw new Error("data/render: no global document \u2014 a DOM (or the test mock) must be installed");
  const mount = new Scope(null);
  const tops = [];
  const ctx = { doc, scope: mount, ns: null };
  runInScope(mount, () => {
    const vs = Array.isArray(ast) ? ast : [ast];
    for (const v of vs) {
      if (v.kind === "list") {
        const binding = new ListBinding(host, v, ctx);
        mount.add(binding);
      } else {
        const m = materialize2(v, ctx);
        host.appendChild(m.dom);
        tops.push(m.dom);
      }
    }
  });
  return {
    scope: mount,
    dispose() {
      mount.dispose();
      for (const t of tops) t.remove();
    }
  };
}
var MKEY = "g";
var MirrorNode = class extends DataNode {
  constructor(runtime2, parent, ctl) {
    super(runtime2, "operator", "mirror", [parent, ctl]);
    this.ctl = ctl;
    this.gen = 0;
    this.view = parent.snapshot();
    const o = parent.currentOrder();
    this.order = o === null ? null : o.slice();
  }
  snapshot() {
    if (this.runtime.midBatch) return this.parents[0].snapshot();
    return new Map(this.view);
  }
  hasRow(key) {
    if (this.runtime.midBatch) return super.hasRow(key);
    return this.view.has(key);
  }
  rowAt(key) {
    if (this.runtime.midBatch) return super.rowAt(key);
    return this.view.get(key);
  }
  currentOrder() {
    if (this.runtime.midBatch) return this.parents[0].currentOrder();
    return this.order;
  }
  current() {
    return this.parents[0];
  }
  // Re-point at another view. The swap re-parents this node (children/height
  // bookkeeping) and then writes the hidden control source, so the diff is
  // emitted as a REAL commit: it consolidates with data writes in the same
  // batch(), gets a seq, and inherits re-entrancy handling for free.
  set(next) {
    const nextNode = nodeOf(next);
    const cur = this.parents[0];
    if (nextNode === cur) return;
    if (nextNode.kind === "scalar")
      throw new Error("data: mirror.set() expects a collection view, got a scalar node");
    const stack = [nextNode];
    while (stack.length > 0) {
      const n = stack.pop();
      if (n === this) throw new Error("data: mirror.set() would create a cyclic view");
      for (const p of n.parents) stack.push(p);
    }
    const i = cur.children.indexOf(this);
    if (i >= 0) cur.children.splice(i, 1);
    this.parents[0] = nextNode;
    nextNode.children.push(this);
    if (nextNode.height + 1 > this.height) this.height = nextNode.height + 1;
    this.ctl.write(MKEY, [], ++this.gen);
  }
  dispose() {
    super.dispose();
    this.ctl.dispose();
  }
  settle(seq, origin) {
    let dataBatch = null;
    let repoint = false;
    if (this.in0 !== null) {
      if (this.inFrom0 === this.ctl) repoint = true;
      else if (this.inFrom0 === this.parents[0]) dataBatch = this.in0;
    }
    if (this.inMore !== null) {
      for (const m of this.inMore) {
        if (m.from === this.ctl) repoint = true;
        else if (m.from === this.parents[0]) dataBatch = m.batch;
      }
    }
    if (repoint) return this.settleRepoint(seq, origin);
    if (dataBatch === null) return null;
    for (const d of dataBatch.rows) {
      if (d.op === "remove") this.view.delete(d.key);
      else this.view.set(d.key, d.row);
    }
    if (dataBatch.order !== void 0) {
      if (this.order === null) this.order = [];
      applyOrderDeltas(this.order, dataBatch.order);
    }
    if (dataBatch.rows.length === 0 && dataBatch.order === void 0) return null;
    return { seq, origin, rows: dataBatch.rows, order: dataBatch.order, scalar: void 0 };
  }
  // The consolidated swap diff: old snapshot vs new snapshot — removes for
  // keys only in old, adds for keys only in new, updates ONLY for keys in
  // both whose row REFERENCE changed (Object.is — overlapping keys sharing a
  // row reference emit nothing, so downstream DOM keeps their elements).
  // A data batch from the new parent in the same commit is subsumed: the
  // parent has already settled (lower height), so its snapshot is current.
  settleRepoint(seq, origin) {
    const next = this.parents[0].snapshot();
    const rows = [];
    for (const [k, v] of this.view) {
      if (!next.has(k)) rows.push({ op: "remove", key: k, prev: v });
    }
    for (const [k, v] of next) {
      if (this.view.has(k)) {
        const old = this.view.get(k);
        if (!Object.is(old, v)) rows.push({ op: "update", key: k, row: v, prev: old, path: [] });
      } else {
        rows.push({ op: "add", key: k, row: v });
      }
    }
    const postO = this.parents[0].currentOrder();
    const postOrder = postO === null ? null : postO.slice();
    let order;
    if (this.order !== null || postOrder !== null) {
      order = orderScript(this.order ?? [], postOrder ?? []);
      if (order.length === 0) order = void 0;
    }
    this.view = next;
    this.order = postOrder;
    if (rows.length === 0 && order === void 0) return null;
    return { seq, origin, rows, order, scalar: void 0 };
  }
};
function applyOrderDeltas(ord, deltas) {
  for (const d of deltas) {
    if (d.op === "orderInsert") ord.splice(d.index, 0, d.key);
    else if (d.op === "orderRemove") ord.splice(d.index, 1);
    else {
      ord.splice(d.from, 1);
      ord.splice(d.index, 0, d.key);
    }
  }
}
function orderScript(pre, post) {
  const preSet = new Set(pre);
  const postSet = new Set(post);
  const out = [];
  for (let i = pre.length - 1; i >= 0; i--) {
    if (!postSet.has(pre[i])) out.push({ op: "orderRemove", key: pre[i], index: i });
  }
  const cur = [];
  for (const k of pre) if (postSet.has(k)) cur.push(k);
  const surv = [];
  for (const k of post) if (preSet.has(k)) surv.push(k);
  for (let i = 0; i < surv.length; i++) {
    if (cur[i] === surv[i]) continue;
    const j = cur.indexOf(surv[i], i);
    out.push({ op: "orderMove", key: surv[i], index: i, from: j });
    cur.splice(j, 1);
    cur.splice(i, 0, surv[i]);
  }
  for (let i = 0; i < post.length; i++) {
    if (!preSet.has(post[i])) out.push({ op: "orderInsert", key: post[i], index: i });
  }
  return out;
}
function mirror(initial) {
  const parent = nodeOf(initial);
  if (parent.kind === "scalar")
    throw new Error("data: mirror() expects a collection view, got a scalar node");
  const ctl = new SourceNode(parent.runtime, { [MKEY]: 0 }, "mirror:ctl");
  return new MirrorNode(parent.runtime, parent, ctl);
}
function raf(target) {
  const commit = typeof target === "function" ? target : (v) => target.update(v);
  let pending = false;
  let latest;
  let handle = null;
  const g = globalThis;
  const hasRaf = typeof g.requestAnimationFrame === "function";
  const fire = () => {
    pending = false;
    handle = null;
    commit(latest);
  };
  const write = ((v) => {
    latest = v;
    if (pending) return;
    pending = true;
    handle = hasRaf ? g.requestAnimationFrame(fire) : setTimeout(fire, 16);
  });
  write.cancel = () => {
    if (!pending) return;
    pending = false;
    if (hasRaf) g.cancelAnimationFrame(handle);
    else clearTimeout(handle);
    handle = null;
  };
  write.flush = () => {
    if (!pending) return;
    write.cancel();
    commit(latest);
  };
  currentScope()?.onDispose(() => write.cancel());
  return write;
}

// v3/seam/index.ts
var NODE3 = /* @__PURE__ */ Symbol.for("data.v3.node");
function resolveSource(target) {
  if (target instanceof SourceNode) return target;
  const n = target !== null && (typeof target === "object" || typeof target === "function") ? target[NODE3] : void 0;
  if (n instanceof SourceNode) return n;
  throw new Error(
    "data: ingest() target must be a source \u2014 pass the api handle of a $() source or a raw SourceNode (operator views are read-only projections)"
  );
}
function ingest(target, records, opts = {}) {
  const src = resolveSource(target);
  const run = () => {
    for (const r of records) {
      if (r !== null && typeof r === "object" && "t" in r) applyWire(src, r);
      else if (r !== null && typeof r === "object" && "type" in r) applyV2(src, r);
      else throw new Error(`data: ingest() cannot detect record profile: ${JSON.stringify(r)}`);
    }
  };
  if (opts.origin) src.runtime.withOrigin(opts.origin, () => src.runtime.batch(run));
  else src.runtime.batch(run);
}
function applyWire(src, r) {
  switch (r.t) {
    case "add":
      src.write(r.k, [], r.v);
      return;
    case "update":
      src.write(r.k, r.path ?? [], r.v);
      return;
    case "remove":
      src.remove(r.k);
      return;
    case "move":
      throw new Error(
        "data: ingest() does not support move records yet \u2014 order splice ingress lands with the render/ordered seam (deferred)"
      );
  }
}
function v2RowKey(src, name) {
  const ord = src.currentOrder();
  if (ord !== null) {
    if (!/^\d+$/.test(name))
      throw new Error(`data: ingest() v2 record addresses array-born source with non-positional key ${JSON.stringify(name)}`);
    const i = Number(name);
    return i < ord.length ? ord[i] : void 0;
  }
  return name;
}
function applyV2(src, r) {
  if (r.type === "move")
    throw new Error(
      "data: ingest() does not support move records yet \u2014 order splice ingress lands with the render/ordered seam (deferred)"
    );
  if (r.type === "insert") {
    if (src.currentOrder() !== null) {
      src.insert(r.value, typeof r.at === "number" ? r.at : void 0);
      return;
    }
    if (r.at === void 0 || r.at === null) src.insert(r.value);
    else src.write(r.at, [], r.value);
    return;
  }
  if (r.type === "update") {
    if (r.key.length === 0) {
      applyV2WholeValue(src, r.value);
      return;
    }
    const key2 = v2RowKey(src, r.key[0]);
    if (key2 === void 0)
      throw new Error(`data: ingest() v2 update at positional key ${r.key[0]} \u2014 out of range (order has ${src.currentOrder().length} rows)`);
    src.write(key2, r.key.slice(1), r.value);
    return;
  }
  const key = v2RowKey(src, r.key[0]);
  if (key === void 0) return;
  if (r.key.length > 1)
    throw new Error("data: ingest() nested-field removal is not supported (v2 deep delete) \u2014 write undefined/null instead");
  src.remove(key);
}
function applyV2WholeValue(src, value2) {
  const ord = src.currentOrder();
  if (ord !== null) {
    const next2 = Array.isArray(value2) ? value2 : [];
    const pre = [...ord];
    const n = Math.min(pre.length, next2.length);
    for (let i = 0; i < n; i++) src.write(pre[i], [], next2[i]);
    for (let i = pre.length - 1; i >= next2.length; i--) src.remove(pre[i]);
    for (let i = pre.length; i < next2.length; i++) src.insert(next2[i]);
    return;
  }
  const next = value2 ?? {};
  if (typeof next !== "object")
    throw new Error("data: ingest() whole-value v2 update for an object-born source must carry an object");
  for (const k of [...src.snapshot().keys()]) {
    if (!Object.prototype.hasOwnProperty.call(next, String(k))) src.remove(k);
  }
  for (const k of Object.keys(next)) src.write(k, [], next[k]);
}
function isAsyncIterable(v) {
  return v !== null && typeof v === "object" && typeof v[Symbol.asyncIterator] === "function";
}
function fromAsync(runtime2, input, opts = {}) {
  const keyFn = opts.key;
  const source = new SourceNode(runtime2, keyFn ? {} : [], "fromAsync");
  let status = "pending";
  let error;
  let cancelled = false;
  let buffer = null;
  let iterator = null;
  const setStatus = (s) => {
    if (status !== "pending") return;
    status = s;
    opts.onStatus?.(s);
  };
  const commitRows = (rows) => {
    if (cancelled || source.disposed || rows.length === 0) return;
    runtime2.batch(() => {
      for (const row of rows) {
        if (keyFn) source.write(keyFn(row), [], row);
        else source.insert(row);
      }
    });
  };
  const flush = () => {
    if (buffer === null) return;
    const b = buffer;
    buffer = null;
    commitRows(b);
  };
  const drain = (rows) => {
    if (opts.coalesce === "microtask") {
      if (buffer === null) {
        buffer = [];
        queueMicrotask(() => queueMicrotask(flush));
      }
      for (const row of rows) buffer.push(row);
    } else {
      commitRows(rows);
    }
  };
  const run = async () => {
    try {
      if (isAsyncIterable(input)) {
        iterator = input[Symbol.asyncIterator]();
        while (true) {
          const r = await iterator.next();
          if (cancelled) return;
          if (r.done) break;
          drain(r.value);
        }
      } else {
        const rows = await input;
        if (cancelled) return;
        drain(rows);
      }
      flush();
      setStatus("ready");
    } catch (e) {
      if (cancelled) return;
      error = e;
      setStatus("error");
    }
  };
  void run();
  const handle = {
    source,
    status: () => status,
    error: () => error,
    dispose() {
      if (cancelled) return;
      cancelled = true;
      buffer = null;
      if (iterator?.return) void iterator.return(void 0).catch(() => {
      });
    }
  };
  currentScope()?.add({ dispose: () => handle.dispose() });
  return handle;
}
var InMemoryBacking = class {
  constructor(runtime2, value2, name = "backed-source") {
    this.source = new SourceNode(runtime2, value2, name);
  }
  load() {
    return { rows: this.source.snapshot(), order: this.source.currentOrder() };
  }
  apply(records, origin) {
    ingest(this.source, records, origin ? { origin } : {});
  }
  subscribe(sink) {
    sink.init(this.source.snapshot(), this.source.currentOrder() ?? void 0);
    return this.source.connect({
      wantsOrder: sink.wantsOrder ?? false,
      origin: sink.origin ?? null,
      apply: (b) => sink.apply(b)
    });
  }
};
function exportContract() {
  const operators = {};
  for (const [name, def] of registry) {
    operators[name] = { category: def.category, declarative: def.declarative };
  }
  return { SCHEMA_VERSION, reserved: [...RESERVED], operators };
}

// v3/render/builders.ts
var NODE4 = /* @__PURE__ */ Symbol.for("data.v3.node");
function isViewLike(x) {
  if (x instanceof DataNode) return true;
  return x !== null && typeof x === "object" && x[NODE4] instanceof DataNode;
}
var VNODE_KINDS = /* @__PURE__ */ new Set(["el", "text", "rtext", "list"]);
function isVNode(x) {
  return x !== null && typeof x === "object" && VNODE_KINDS.has(x.kind);
}
function isBindShape(x) {
  return x !== null && typeof x === "object" && x.kind === "bind" && "view" in x;
}
function isPropsObject(x) {
  if (x === null || typeof x !== "object") return false;
  if (Array.isArray(x)) return false;
  if (x instanceof DataNode) return false;
  if (x[NODE4] instanceof DataNode) return false;
  if (isBindShape(x) || isVNode(x)) return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}
function normChildren(children) {
  const out = [];
  const push = (c) => {
    if (c == null || typeof c === "boolean") return;
    if (typeof c === "string" || typeof c === "number") {
      out.push({ kind: "text", s: String(c) });
      return;
    }
    if (Array.isArray(c)) {
      for (const k of c) push(k);
      return;
    }
    if (isViewLike(c)) {
      out.push(text(c));
      return;
    }
    if (isBindShape(c)) {
      out.push(text(c.view, c.fn ?? void 0));
      return;
    }
    if (isVNode(c)) {
      out.push(c);
      return;
    }
    throw new Error(
      "data/render: unsupported child \u2014 expected a VNode, string/number, view/$ handle, bind(), or a nested array of those"
    );
  };
  for (const c of children) push(c);
  return out;
}
var EMPTY_DOT = { classes: [], id: null, attrs: {} };
function addDot(dot, prop) {
  if (prop.startsWith("#")) return { classes: dot.classes, id: prop.slice(1), attrs: dot.attrs };
  const eq = prop.indexOf("=");
  if (eq > 0)
    return {
      classes: dot.classes,
      id: dot.id,
      attrs: { ...dot.attrs, [prop.slice(0, eq)]: prop.slice(eq + 1) }
      // FIRST '=' splits
    };
  return { classes: [...dot.classes, prop.replaceAll("_", "-")], id: dot.id, attrs: dot.attrs };
}
var toS = (x) => x == null ? "" : String(x);
function elFrom(tag, dot, callProps, children) {
  const dotClass = dot.classes.length > 0 ? dot.classes.join(" ") : null;
  let props = null;
  const hasDot = dotClass !== null || dot.id !== null || Object.keys(dot.attrs).length > 0;
  const hasCall = callProps !== null && Object.keys(callProps).length > 0;
  if (hasDot || hasCall) {
    props = { ...dot.attrs };
    if (dotClass !== null) props.class = dotClass;
    if (dot.id !== null) props.id = dot.id;
    if (callProps !== null) {
      for (const k of Object.keys(callProps)) {
        const v = callProps[k];
        if (k === "class" && dotClass !== null) {
          if (isViewLike(v)) props.class = bind(v, (x) => dotClass + " " + toS(x));
          else if (isBindShape(v)) {
            const f = v.fn;
            props.class = bind(v.view, (x) => dotClass + " " + toS(f === null ? x : f(x)));
          } else if (v != null && v !== false) props.class = dotClass + " " + String(v);
        } else {
          props[k] = v;
        }
      }
    }
  }
  return el(tag, props, ...normChildren(children));
}
function makeBuilder(tag, dot) {
  const call = (...args) => {
    if (args.length > 0 && isPropsObject(args[0]))
      return elFrom(tag, dot, args[0], args.slice(1));
    return elFrom(tag, dot, null, args);
  };
  return new Proxy(call, {
    get(t, prop) {
      if (typeof prop !== "string") return t[prop];
      return makeBuilder(tag, addDot(dot, prop));
    }
  });
}
function namespaceProxy() {
  return new Proxy(/* @__PURE__ */ Object.create(null), {
    get(_t, prop) {
      if (typeof prop !== "string") return void 0;
      return makeBuilder(prop.replaceAll("_", "-"), EMPTY_DOT);
    }
  });
}
var HTML = namespaceProxy();
var SVG = namespaceProxy();

// v3/jsx/index.ts
var NODE5 = /* @__PURE__ */ Symbol.for("data.v3.node");
function isViewLike2(x) {
  if (x instanceof DataNode) return true;
  return x !== null && typeof x === "object" && x[NODE5] instanceof DataNode;
}
function viewNodeOf(x) {
  return x instanceof DataNode ? x : x[NODE5];
}
function normComponentChildren(children) {
  const out = [];
  const push = (c) => {
    if (typeof c === "function") {
      out.push(c);
      return;
    }
    if (Array.isArray(c)) {
      for (const k of c) push(k);
      return;
    }
    for (const v of normChildren([c])) out.push(v);
  };
  for (const c of children) push(c);
  return out;
}
function h(tag, props, ...children) {
  if (typeof tag === "function") {
    const p = children.length > 0 ? { ...props ?? {}, children: normComponentChildren(children) } : { children: [], ...props ?? {} };
    return tag(p);
  }
  return el(tag, props ?? null, ...normChildren(children));
}
function Fragment(props) {
  const c = props?.children;
  return Array.isArray(c) ? c : c == null ? [] : [c];
}
function For(props) {
  const each = props?.each;
  if (!isViewLike2(each))
    throw new Error("data/jsx: <For> requires each={view} \u2014 a collection $ handle or DataNode");
  if (viewNodeOf(each).kind === "scalar")
    throw new Error("data/jsx: <For each={\u2026}> expects a COLLECTION view, got a scalar");
  const c = props?.children;
  const kids = Array.isArray(c) ? c : c == null ? [] : [c];
  if (kids.length !== 1 || typeof kids[0] !== "function")
    throw new Error(
      "data/jsx: <For each={view}> takes exactly ONE child \u2014 the row function (row, key) => vnode. Iteration is ONLY For/list(); a bare view child is reactive text, and the v2 [vp, fn] shorthand is gone."
    );
  return list(each, kids[0]);
}

// v3/jsx/runtime.ts
function toChildren(children) {
  if (children === void 0) return [];
  return Array.isArray(children) ? children : [children];
}
function transform(tag, props) {
  const { children, ...rest } = props ?? {};
  return h(tag, Object.keys(rest).length > 0 ? rest : null, ...toChildren(children));
}
function jsx(tag, props, _key) {
  return transform(tag, props);
}
function jsxs(tag, props, _key) {
  return transform(tag, props);
}
function jsxDEV(tag, props, _key, _isStaticChildren, _source, _self) {
  return transform(tag, props);
}

// v3/api/index.ts
installReactive();
var value = /* @__PURE__ */ Symbol.for("data.v3.value");
var node = /* @__PURE__ */ Symbol.for("data.v3.node");
var defaultRuntime = new Runtime();
function runtime() {
  return defaultRuntime;
}
function batch(fn) {
  return defaultRuntime.batch(fn);
}
var HANDLE = /* @__PURE__ */ Symbol("data.v3.handle");
function reserved(name) {
  return RESERVED.has(name);
}
function readAt(state) {
  if (state.path.length === 0) {
    const n = state.node;
    if (n.kind === "scalar") return n.value();
    return materialize(n.snapshot(), n.currentOrder());
  }
  const src = state.source;
  const key = state.path[0];
  const row = src.get(key);
  return state.path.length === 1 ? row : leafAt(row, state.path.slice(1));
}
function childState(parent, name) {
  if (parent.node.kind === "scalar")
    throw new Error(`data: scalar views have no children (reading .${name})`);
  if (parent.source === null && parent.path.length === 0 && parent.node instanceof SourceNode) {
    return { node: parent.node, source: parent.node, path: [name], children: /* @__PURE__ */ new Map(), dedup: /* @__PURE__ */ new Map() };
  }
  if (parent.source !== null) {
    return { node: parent.node, source: parent.source, path: [...parent.path, name], children: /* @__PURE__ */ new Map(), dedup: /* @__PURE__ */ new Map() };
  }
  return { node: parent.node, source: null, path: [name], children: /* @__PURE__ */ new Map(), dedup: /* @__PURE__ */ new Map() };
}
function childRead(state) {
  if (state.source !== null) return readAt(state);
  const snap = state.node.snapshot();
  const key = state.path[0];
  const row = snap.has(key) ? snap.get(key) : snap.get(String(key)) ?? snap.get(Number(key));
  return state.path.length === 1 ? row : leafAt(row, state.path.slice(1));
}
function coerceKey(state, name) {
  const src = state.source;
  if (src !== null && state.path.length === 0 && src.currentOrder() !== null && /^\d+$/.test(name))
    return Number(name);
  return name;
}
function writeTarget(state) {
  if (state.source === null || state.path.length === 0)
    throw new Error(
      "data: this view is a derived projection \u2014 write through its source (operator views are read-only)"
    );
  return { src: state.source, key: state.path[0], sub: state.path.slice(1) };
}
function makeMethods(state, self) {
  const m = {
    get(k) {
      return childHandle(state, String(k));
    },
    snapshot() {
      return readAt(state);
    },
    update(v) {
      if (state.path.length === 0 && state.node instanceof SourceNode)
        throw new Error("data: whole-source update \u2014 write [value] semantics not yet supported; use per-key writes or batch()");
      const { src, key, sub } = writeTarget(state);
      src.write(key, sub, v);
    },
    set(k, v) {
      if (state.node instanceof MirrorNode && state.path.length === 0 && v === void 0 && k !== null && typeof k === "object") {
        state.node.set(k[node] ?? k);
        return;
      }
      if (state.source !== null && state.path.length === 0) {
        state.source.write(coerceKey(state, String(k)), [], v);
        return;
      }
      const { src, key, sub } = writeTarget(state);
      src.write(key, [...sub, String(k)], v);
    },
    insert(v, at) {
      if (!(state.node instanceof SourceNode) || state.path.length > 0)
        throw new Error("data: insert() applies to a source root");
      return state.node.insert(v, at);
    },
    remove() {
      const { src, key, sub } = writeTarget(state);
      if (sub.length > 0) throw new Error("data: remove() detaches a row \u2014 nested field removal not yet supported");
      src.remove(key);
    },
    patch(pairs) {
      if (!(state.node instanceof SourceNode) || state.path.length > 0)
        throw new Error("data: patch() applies to a source root");
      const src = state.node;
      src.runtime.batch(() => {
        for (const [k, v] of pairs) src.write(coerceKey(state, String(k)), [], v);
      });
    },
    connect(a, b) {
      const n = state.node;
      if (state.path.length > 0) throw new Error("data: connect() on child paths not yet supported \u2014 connect the view");
      if (Array.isArray(a) && b === void 0) {
        const sink = new V2RecordSink(n, (r) => a.push(r));
        return n.connect(sink);
      }
      if (typeof a === "object" && a !== null && typeof b === "function") {
        const sink = new V2RecordSink(n, b);
        return n.connect(sink);
      }
      if (typeof a === "object" && a !== null && typeof b === "string") {
        const obj = a;
        obj[b] = readAt(state);
        return n.connect({
          wantsOrder: false,
          origin: null,
          apply: () => {
            obj[b] = readAt(state);
          }
        });
      }
      throw new Error(
        "data: connect(fn) is not a valid sink \u2014 use connect(anchor, fn) for records, connect([]) for an array, or connect(obj, prop) to mirror"
      );
    },
    dispose() {
      state.node.dispose();
    },
    mirror() {
      if (state.path.length > 0) throw new Error("data: mirror() applies to a view, not a child path");
      return handleFor(mirror(state.node));
    },
    raf() {
      return raf((v) => m.update(v));
    },
    first() {
      if (state.path.length > 0) throw new Error("data: first() applies to a view, not a child path");
      const n = state.node;
      const order = n.currentOrder();
      const k = order ? order[0] : n.snapshot().keys().next().value;
      return childHandle(state, String(k ?? 0));
    },
    last() {
      if (state.path.length > 0) throw new Error("data: last() applies to a view, not a child path");
      const n = state.node;
      const order = n.currentOrder();
      let k;
      if (order) k = order[order.length - 1];
      else for (k of n.snapshot().keys()) ;
      return childHandle(state, String(k ?? 0));
    },
    ingest(records, opts) {
      if (!(state.node instanceof SourceNode) || state.path.length > 0)
        throw new Error("data: ingest() applies to a source root");
      ingest(state.node, records, opts);
    }
  };
  return m;
}
function wrap(state) {
  const methods = makeMethods(state);
  const target = /* @__PURE__ */ Object.create(null);
  const proxy = new Proxy(target, {
    get(_t, prop, _r) {
      if (prop === value) return state.source !== null || state.path.length > 0 ? childRead(state) : readAt(state);
      if (prop === node) return state.node;
      if (prop === HANDLE) return state;
      if (prop === Symbol.toPrimitive || prop === "toString")
        return () => `[data ${state.node.opName}#${state.node.id}${state.path.length ? " ." + state.path.join(".") : ""}]`;
      if (prop === "toJSON") return () => readAt(state);
      if (prop === Symbol.iterator) {
        const snap = readAt(state);
        if (Array.isArray(snap)) return snap[Symbol.iterator].bind(snap);
        return function* () {
          if (snap && typeof snap === "object") yield* Object.values(snap);
        };
      }
      if (typeof prop !== "string") return void 0;
      if (reserved(prop)) {
        const builtin = methods[prop];
        if (builtin) return builtin;
        const def = registry.get(prop);
        if (def) {
          if (state.path.length > 0)
            throw new Error(
              `data: .${prop}(...) on a child path would operate on the OWNING view \u2014 chain operators off the view itself (child handles are addresses, not views)`
            );
          return (...rawArgs) => {
            const args = rawArgs.map((a) => {
              if (a === null || typeof a !== "object") return a;
              const st = a[HANDLE];
              if (st !== void 0 && st.path.length === 0 && a[node] instanceof DataNode)
                return a[node];
              return a;
            });
            const def2 = prop === "length" && typeof args[0] === "function" ? registry.get("lengthBuckets") : def;
            const key = def2.dedupKey ? def2.dedupKey(...args) : null;
            if (key !== null) {
              const hit = state.dedup.get(key);
              if (hit !== void 0) return hit;
            }
            const out = wrap({
              node: def2.create(state.node, ...args),
              source: null,
              path: [],
              children: /* @__PURE__ */ new Map(),
              dedup: /* @__PURE__ */ new Map()
            });
            if (key !== null) state.dedup.set(key, out);
            return out;
          };
        }
        throw new Error(`data: reserved name ${prop} has no implementation yet`);
      }
      return childHandle(state, prop);
    },
    set(_t, prop, _v) {
      if (prop === value)
        throw new Error("data: [value] whole-view assignment is a v2 idiom \u2014 use update()/set()/patch() (data/v2-compat restores it)");
      throw new Error(
        `data: bare assignment (.${String(prop)} =) is not the write surface \u2014 use .get(${JSON.stringify(String(prop))}).update(v) / .set(${JSON.stringify(String(prop))}, v) (types and runtime agree in v3)`
      );
    },
    deleteProperty(_t, prop) {
      throw new Error(`data: delete is not the write surface \u2014 use .get(${JSON.stringify(String(prop))}).remove()`);
    },
    has(_t, prop) {
      if (typeof prop !== "string") return prop === value || prop === node;
      if (reserved(prop)) return true;
      const snap = readAt(state);
      return snap != null && typeof snap === "object" ? prop in snap : false;
    },
    ownKeys() {
      const snap = readAt(state);
      return snap != null && typeof snap === "object" ? Reflect.ownKeys(snap) : [];
    },
    getOwnPropertyDescriptor(_t, prop) {
      if (typeof prop !== "string") return void 0;
      const snap = readAt(state);
      if (snap != null && typeof snap === "object" && prop in snap)
        return { configurable: true, enumerable: true, value: snap[prop] };
      return void 0;
    }
  });
  return proxy;
}
function childHandle(state, name) {
  let child = state.children.get(name);
  if (child === void 0) {
    const cs = childState(state, name);
    if (cs.source !== null && cs.path.length === 1) cs.path = [coerceKey(state, name)];
    child = wrap(cs);
    state.children.set(name, child);
  }
  return child;
}
function $(v) {
  const src = new SourceNode(defaultRuntime, v);
  return wrap({ node: src, source: src, path: [], children: /* @__PURE__ */ new Map(), dedup: /* @__PURE__ */ new Map() });
}
function handleFor(n) {
  return wrap({ node: n, source: n instanceof SourceNode ? n : null, path: [], children: /* @__PURE__ */ new Map(), dedup: /* @__PURE__ */ new Map() });
}

export { $, For, Fragment, HTML, InMemoryBacking, SVG, batch, bind, el, exportContract, fromAsync, h, handleFor, jsx, jsxDEV, jsxs, list, node, normChildren, render, runtime, text, value };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map