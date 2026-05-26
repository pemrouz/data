import { classify, iterRoots, walk, ancestorOf, summarize } from '../chunk-CTNBR7TS.js';
export { ancestorOf, classify, summarize, walk } from '../chunk-CTNBR7TS.js';
import { $, view, ViewProxy, View } from '../chunk-VOTKTX55.js';
export { $ } from '../chunk-VOTKTX55.js';

// devtools/events.ts
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
$.fromDOM = function fromDOM(el) {
  let n = el;
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
  for (const el of targets) el.classList?.add("__ripple_highlight");
  if (typeof setTimeout !== "undefined" && targets.length) {
    setTimeout(() => {
      for (const el of targets) el.classList?.remove("__ripple_highlight");
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
      return mountPanel(proxy);
    },
    close() {
      return unmountPanel();
    },
    get shell() {
      return getPanelShell();
    }
  }
};
var mountPanel = () => void 0;
var unmountPanel = () => {
};
var getPanelShell = () => null;
if (typeof document !== "undefined") {
  const noPanel = typeof location !== "undefined" && /(?:^|[?&])nopanel(?:[=&]|$)/.test(location.search);
  void import('./panel/index.js').then((m) => {
    mountPanel = m.mount;
    unmountPanel = m.unmount;
    getPanelShell = m.getShell;
    if (!noPanel) m.mount();
  });
}
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map