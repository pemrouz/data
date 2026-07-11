// v3/devtools/entry.ts
import { $ } from "./index.js";

// v3/devtools/index.ts
import { Runtime } from "./index.js";
import { DataNode } from "./index.js";
import { materialize } from "./index.js";
import { runtime as defaultRuntime } from "./index.js";
var NODE = /* @__PURE__ */ Symbol.for("data.v3.node");
function resolveNode(handleOrNode) {
  if (handleOrNode instanceof DataNode) return handleOrNode;
  if (handleOrNode !== null && typeof handleOrNode === "object") {
    const n = handleOrNode[NODE];
    if (n instanceof DataNode) return n;
  }
  throw new Error("data devtools: expected a data handle or DataNode \u2014 got " + typeof handleOrNode);
}
function resolveRuntime(target) {
  if (target == null) return defaultRuntime();
  if (target instanceof Runtime) return target;
  return resolveNode(target).runtime;
}
function inspect(handleOrNode) {
  const n = resolveNode(handleOrNode);
  return {
    id: n.id,
    kind: n.kind,
    op: n.opName,
    height: n.height,
    parents: n.parents.map((p) => p.id),
    value: nodeValue(n)
  };
}
function nodeValue(n) {
  if (n.kind === "scalar") return n.value();
  return materialize(n.snapshot(), n.currentOrder());
}
function graph(target) {
  const rt = resolveRuntime(target);
  const nodes = rt.graph();
  const edges = [];
  for (const n of nodes) for (const p of n.parents) edges.push({ from: p, to: n.id });
  return { nodes, edges };
}
function trace(target, fn) {
  const rt = resolveRuntime(target);
  const out = [];
  const sub = rt.onCommit((c) => out.push(c));
  try {
    fn();
  } finally {
    sub.dispose();
  }
  return out;
}
function profile(target, fn) {
  const rt = resolveRuntime(target);
  const commits = trace(rt, fn);
  const ops = opNames(rt);
  const acc = /* @__PURE__ */ new Map();
  for (const c of commits) {
    for (const s of c.nodes) {
      let row = acc.get(s.id);
      if (row === void 0) {
        row = { id: s.id, op: ops.get(s.id) ?? "disposed", commits: 0, deltas: 0, totalMs: 0 };
        acc.set(s.id, row);
      }
      row.commits += 1;
      row.deltas += s.deltas;
      row.totalMs += s.ms;
    }
  }
  return [...acc.values()].sort((a, b) => a.id - b.id);
}
function cascades(target, fn) {
  const rt = resolveRuntime(target);
  const commits = trace(rt, fn);
  const ops = opNames(rt);
  return commits.map((c) => ({
    seq: c.seq,
    origin: c.origin.description ?? "anonymous",
    nodes: c.nodes.map((s) => {
      const op = ops.get(s.id) ?? "disposed";
      return { id: s.id, op, name: `${op}#${s.id}`, deltas: s.deltas, ms: s.ms };
    })
  }));
}
function opNames(rt) {
  const m = /* @__PURE__ */ new Map();
  for (const n of rt.graph()) m.set(n.id, n.op);
  return m;
}

// v3/devtools/dom.ts
import { domLinks, liveLists } from "./index.js";
var OUTLINE = "2px solid #e3b341";
var OUTLINE_OFFSET = "2px";
function fromDOM(dom) {
  for (let n = dom; n != null; n = n.parentNode) {
    const link = domLinks.get(n);
    if (link !== void 0) return { node: link.view, key: link.key };
  }
  return null;
}
function rowElements(target) {
  const view = resolveNode(target);
  const out = [];
  for (const l of liveLists) {
    if (l.view !== view) continue;
    for (const [key, rec] of l.recs) out.push({ key, el: rec.el });
  }
  return out;
}
function highlight(target) {
  const saved = [];
  for (const { el } of rowElements(target)) {
    const style = el?.style;
    if (style == null) continue;
    saved.push({ style, outline: style.outline ?? "", outlineOffset: style.outlineOffset ?? "" });
    style.outline = OUTLINE;
    style.outlineOffset = OUTLINE_OFFSET;
  }
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    for (const s of saved) {
      s.style.outline = s.outline;
      s.style.outlineOffset = s.outlineOffset;
    }
  };
}

// v3/devtools/panel/ctx.ts
var refreshables = /* @__PURE__ */ new WeakMap();
function createCtx(runtime, root, doc) {
  let sel = null;
  const listeners = /* @__PURE__ */ new Set();
  const fns = /* @__PURE__ */ new Set();
  const ctx = {
    root,
    doc,
    runtime,
    select(id) {
      if (id === sel) return;
      sel = id;
      for (const cb of [...listeners]) cb(id);
    },
    selected() {
      return sel;
    },
    onSelect(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    refresh() {
      for (const fn of [...fns]) fn();
    }
  };
  refreshables.set(ctx, fns);
  return ctx;
}
function registerRefreshable(ctx, fn) {
  const fns = refreshables.get(ctx);
  if (fns === void 0) throw new Error("data devtools: registerRefreshable requires a ctx from createCtx");
  fns.add(fn);
  return () => {
    fns.delete(fn);
  };
}

// v3/devtools/panel/graph.ts
var NODE_W = 96;
var NODE_H = 30;
var GAP_X = 44;
var GAP_Y = 10;
var PAD = 16;
var SCALE_MIN = 0.25;
var SCALE_MAX = 2.5;
var SVG_NS = "http://www.w3.org/2000/svg";
var frame = typeof requestAnimationFrame === "function" ? (fn) => requestAnimationFrame(fn) : (fn) => setTimeout(fn, 16);
function mountGraph(ctx, host) {
  const doc = ctx.doc;
  const el = (tag, cls, text) => {
    const e = doc.createElement(tag);
    if (cls !== "") e.setAttribute("class", cls);
    if (text !== void 0) e.textContent = text;
    return e;
  };
  let mode = "dag";
  const view = { scale: null, tx: 0, ty: 0 };
  let contentW = 0;
  let contentH = 0;
  const tools = el("div", "gtools");
  const seg = el("div", "gseg");
  const treeBtn = el("button", "", "Tree");
  const dagBtn = el("button", "active", "DAG");
  seg.appendChild(treeBtn);
  seg.appendChild(dagBtn);
  tools.appendChild(seg);
  const fitBtn = el("button", "gfit", "\u26F6");
  fitBtn.title = "fit to view";
  tools.appendChild(fitBtn);
  const scaleLbl = el("span", "gscale", "100%");
  tools.appendChild(scaleLbl);
  const outer = el("div", "gouter");
  const canvas = el("div", "gcanvas");
  outer.appendChild(canvas);
  host.appendChild(tools);
  host.appendChild(outer);
  const applyView = () => {
    const s = view.scale ?? 1;
    canvas.setAttribute(
      "style",
      `width:${contentW}px;height:${contentH}px;transform:translate(${view.tx}px,${view.ty}px) scale(${s})`
    );
    scaleLbl.textContent = `${Math.round(s * 100)}%`;
  };
  const fit = () => {
    const r = outer.getBoundingClientRect?.();
    if (r === void 0 || r.width === 0 || r.height === 0 || contentW === 0) return;
    const s = Math.min((r.width - 16) / contentW, (r.height - 16) / contentH, 1);
    view.scale = Math.max(SCALE_MIN, s);
    view.tx = Math.max(0, (r.width - contentW * view.scale) / 2);
    view.ty = Math.max(0, (r.height - contentH * view.scale) / 2);
    applyView();
  };
  const setMode = (next) => {
    if (mode === next) return;
    mode = next;
    treeBtn.setAttribute("class", next === "tree" ? "active" : "");
    dagBtn.setAttribute("class", next === "dag" ? "active" : "");
    refresh();
  };
  treeBtn.addEventListener("click", () => setMode("tree"));
  dagBtn.addEventListener("click", () => setMode("dag"));
  fitBtn.addEventListener("click", () => fit());
  const refresh = () => {
    const g = graph(ctx.runtime);
    while (canvas.children.length > 0) canvas.removeChild(canvas.children[canvas.children.length - 1]);
    if (g.nodes.length === 0) {
      canvas.appendChild(el("div", "gempty", "no live nodes \u2014 build a $ chain"));
      contentW = 0;
      contentH = 0;
      applyView();
      return;
    }
    const heights = [...new Set(g.nodes.map((n) => n.height))].sort((a, b) => a - b);
    const colOf = /* @__PURE__ */ new Map();
    heights.forEach((h, i) => colOf.set(h, i));
    const rows = /* @__PURE__ */ new Map();
    const pos = /* @__PURE__ */ new Map();
    for (const n of [...g.nodes].sort((a, b) => a.id - b.id)) {
      const c = colOf.get(n.height);
      const r = rows.get(c) ?? 0;
      rows.set(c, r + 1);
      pos.set(n.id, { x: PAD + c * (NODE_W + GAP_X), y: PAD + r * (NODE_H + GAP_Y) });
    }
    const maxRows = Math.max(...rows.values());
    contentW = PAD * 2 + heights.length * NODE_W + (heights.length - 1) * GAP_X;
    contentH = PAD * 2 + maxRows * NODE_H + (maxRows - 1) * GAP_Y;
    const svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "gedges");
    svg.setAttribute("width", String(contentW));
    svg.setAttribute("height", String(contentH));
    for (const n of g.nodes) {
      const parents = mode === "tree" && n.parents.length > 1 ? [n.parents[0]] : n.parents;
      for (const p of parents) {
        const a = pos.get(p);
        const b = pos.get(n.id);
        if (a === void 0 || b === void 0) continue;
        const line = doc.createElementNS(SVG_NS, "line");
        line.setAttribute("x1", String(a.x + NODE_W));
        line.setAttribute("y1", String(a.y + NODE_H / 2));
        line.setAttribute("x2", String(b.x));
        line.setAttribute("y2", String(b.y + NODE_H / 2));
        svg.appendChild(line);
      }
    }
    canvas.appendChild(svg);
    const sel = ctx.selected();
    for (const n of g.nodes) {
      const p = pos.get(n.id);
      const box = el("div", `gnode kind-${n.kind}` + (n.id === sel ? " selected" : ""));
      box.setAttribute("style", `left:${p.x}px;top:${p.y}px;width:${NODE_W}px;height:${NODE_H}px`);
      box.setAttribute("data-node-id", String(n.id));
      box.title = `${n.op}#${n.id} \xB7 ${n.kind} \xB7 height ${n.height}`;
      box.appendChild(el("div", "gnode-label", `${n.op}#${n.id}`));
      box.appendChild(el("div", "gnode-sub", n.kind));
      box.addEventListener("click", (e) => {
        e?.stopPropagation?.();
        ctx.select(n.id);
      });
      canvas.appendChild(box);
    }
    if (view.scale === null) {
      view.scale = 1;
      frame(fit);
    }
    applyView();
  };
  let pan = null;
  let moved = false;
  outer.addEventListener("pointerdown", (e) => {
    if (e?.target?.closest?.(".gnode") != null || e?.target?.closest?.(".gtools") != null) return;
    pan = { x: e.clientX ?? 0, y: e.clientY ?? 0 };
    moved = false;
    try {
      outer.setPointerCapture?.(e.pointerId);
    } catch {
    }
  });
  outer.addEventListener("pointermove", (e) => {
    if (pan === null) return;
    const dx = (e.clientX ?? 0) - pan.x;
    const dy = (e.clientY ?? 0) - pan.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    view.tx += dx;
    view.ty += dy;
    pan = { x: e.clientX ?? 0, y: e.clientY ?? 0 };
    applyView();
  });
  const endPan = (e) => {
    if (pan === null) return;
    pan = null;
    try {
      outer.releasePointerCapture?.(e.pointerId);
    } catch {
    }
  };
  outer.addEventListener("pointerup", endPan);
  outer.addEventListener("pointercancel", endPan);
  outer.addEventListener("click", (e) => {
    if (e?.target?.closest?.(".gnode") != null || e?.target?.closest?.(".gtools") != null) return;
    if (moved) return;
    ctx.select(null);
  });
  outer.addEventListener(
    "wheel",
    (e) => {
      e?.preventDefault?.();
      const factor = (e.deltaY ?? 0) > 0 ? 0.88 : 1.14;
      const cur = view.scale ?? 1;
      const next = Math.max(SCALE_MIN, Math.min(SCALE_MAX, cur * factor));
      const r = outer.getBoundingClientRect?.() ?? { left: 0, top: 0 };
      const cx = (e.clientX ?? 0) - r.left;
      const cy = (e.clientY ?? 0) - r.top;
      view.tx = cx - (cx - view.tx) * (next / cur);
      view.ty = cy - (cy - view.ty) * (next / cur);
      view.scale = next;
      applyView();
    },
    { passive: false }
  );
  let queued = false;
  let dead = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    frame(() => {
      queued = false;
      if (!dead) refresh();
    });
  };
  const commitSub = ctx.runtime.onCommit(() => schedule());
  const unSelect = ctx.onSelect(() => refresh());
  refresh();
  return {
    refresh,
    destroy() {
      dead = true;
      commitSub.dispose();
      unSelect();
      if (tools.parentNode != null) host.removeChild(tools);
      if (outer.parentNode != null) host.removeChild(outer);
    }
  };
}

// v3/devtools/panel/inspector.ts
var EVENTS_MAX = 200;
var ROW_CAP = 20;
var PREVIEW_CAP = 120;
var TABS = ["inspect", "events", "profile"];
function clearEl(e) {
  while (e.firstChild) e.removeChild(e.firstChild);
  const kids = e.children;
  while (kids && kids.length > 0) e.removeChild(kids[kids.length - 1]);
}
function prim(v) {
  return typeof v === "string" ? JSON.stringify(v) : String(v);
}
function fmtValue(v) {
  if (v === null || typeof v !== "object") return prim(v);
  try {
    if (Array.isArray(v)) {
      if (v.length <= ROW_CAP) return JSON.stringify(v, null, 2);
      return `Array(${v.length}) \u2014 first ${ROW_CAP} rows
` + JSON.stringify(v.slice(0, ROW_CAP), null, 2);
    }
    const keys = Object.keys(v);
    if (keys.length <= ROW_CAP) return JSON.stringify(v, null, 2);
    const head = {};
    for (const k of keys.slice(0, ROW_CAP)) head[k] = v[k];
    return `{ ${keys.length} keys } \u2014 first ${ROW_CAP}
` + JSON.stringify(head, null, 2);
  } catch {
    return String(v);
  }
}
function fmtShort(v) {
  let s;
  try {
    s = v === void 0 ? "undefined" : JSON.stringify(v) ?? String(v);
  } catch {
    s = String(v);
  }
  return s.length > PREVIEW_CAP ? s.slice(0, PREVIEW_CAP - 1) + "\u2026" : s;
}
function originLabel(o) {
  return o.description || "anonymous";
}
function nodeById(rt, id) {
  const reg = rt.registry;
  if (reg === void 0) return null;
  for (const ref of reg) {
    const n = ref.deref();
    if (n !== void 0 && !n.disposed && n.id === id) return n;
  }
  return null;
}
function mountInspector(ctx, host) {
  const doc = ctx.doc;
  const el = (tag, cls, text) => {
    const e = doc.createElement(tag);
    if (cls !== void 0) e.setAttribute("class", cls);
    if (text !== void 0) e.appendChild(doc.createTextNode(text));
    return e;
  };
  const setText = (e, s) => {
    clearEl(e);
    e.appendChild(doc.createTextNode(s));
  };
  const opNames2 = () => {
    const m = /* @__PURE__ */ new Map();
    for (const g of ctx.runtime.graph()) m.set(g.id, g.op);
    return m;
  };
  let destroyed = false;
  let activeTab = "inspect";
  const ev = {
    sub: null,
    forId: null,
    ring: [],
    paused: false,
    seen: 0,
    names: /* @__PURE__ */ new Map(),
    listEl: null,
    badgeEl: null
  };
  const prof = {
    sub: null,
    forId: null,
    label: "",
    recording: false,
    done: false,
    // a recording finished — the table is showable
    commits: 0,
    deltas: 0,
    totalMs: 0,
    maxMs: 0,
    allCommits: 0,
    allDeltas: 0,
    allMs: 0,
    allMaxMs: 0,
    statusEl: null
  };
  const nav = el("nav", "insp-tabs");
  const tabBtns = /* @__PURE__ */ new Map();
  for (const t of TABS) {
    const b = el("button", "insp-tab", t);
    b.addEventListener("click", () => setTab(t));
    tabBtns.set(t, b);
    nav.appendChild(b);
  }
  const body = el("div", "insp-body");
  host.appendChild(nav);
  host.appendChild(body);
  function markTabs() {
    for (const [t, b] of tabBtns) b.setAttribute("class", t === activeTab ? "insp-tab active" : "insp-tab");
  }
  function setTab(t) {
    if (destroyed || t === activeTab) return;
    if (activeTab === "events") stopFeed();
    if (activeTab === "profile") stopProfile();
    activeTab = t;
    render();
  }
  function ensureFeed(n) {
    if (ev.sub !== null && ev.forId === n.id) return;
    stopFeed();
    ev.forId = n.id;
    ev.ring.length = 0;
    ev.seen = 0;
    ev.paused = false;
    ev.names = opNames2();
    ev.sub = ctx.runtime.onCommit(onFeedCommit);
  }
  function stopFeed() {
    if (ev.sub !== null) {
      ev.sub.dispose();
      ev.sub = null;
    }
    ev.listEl = null;
    ev.badgeEl = null;
  }
  function badgeText() {
    return `${ev.seen} commit${ev.seen === 1 ? "" : "s"}`;
  }
  function onFeedCommit(c) {
    if (ev.forId === null) return;
    let stat;
    for (const s of c.nodes) if (s.id === ev.forId) {
      stat = s;
      break;
    }
    if (stat === void 0) return;
    if (ev.paused) return;
    ev.seen++;
    let repulled = false;
    const nameOf = (nid) => {
      let s = ev.names.get(nid);
      if (s === void 0 && !repulled) {
        repulled = true;
        ev.names = opNames2();
        s = ev.names.get(nid);
      }
      return s ?? "disposed";
    };
    const cascade = c.nodes.map((s) => `${nameOf(s.id)}#${s.id} \xB7 ${s.deltas}\u03B4 \xB7 ${s.ms.toFixed(2)}ms`);
    const n = nodeById(ctx.runtime, ev.forId);
    const after = n === null ? "(disposed)" : fmtShort(inspect(n).value);
    const row = { seq: c.seq, deltas: stat.deltas, ms: stat.ms, origin: originLabel(c.origin), cascade, after };
    ev.ring.push(row);
    if (ev.ring.length > EVENTS_MAX) ev.ring.shift();
    if (ev.listEl !== null) {
      const list = ev.listEl;
      list.insertBefore(buildEvRow(row), list.children.length > 0 ? list.children[0] : null);
      while (list.children.length > EVENTS_MAX) list.removeChild(list.children[list.children.length - 1]);
    }
    if (ev.badgeEl !== null) setText(ev.badgeEl, badgeText());
  }
  function buildEvRow(r) {
    const row = el("li", "ev-row");
    const head = el("div", "ev-row-head", `#${r.seq} \xB7 ${r.deltas}\u03B4 \xB7 ${r.ms.toFixed(2)}ms \xB7 ${r.origin}`);
    const detail = el("div", "ev-row-detail");
    detail.appendChild(el("div", "ev-detail-line", `origin: ${r.origin}`));
    for (const line of r.cascade) detail.appendChild(el("div", "ev-detail-line ev-cascade", line));
    detail.appendChild(el("div", "ev-detail-line ev-after", `value after: ${r.after}`));
    head.addEventListener("click", () => {
      if (detail.parentNode) row.removeChild(detail);
      else row.appendChild(detail);
    });
    row.appendChild(head);
    return row;
  }
  function startProfile(n) {
    if (prof.sub !== null) prof.sub.dispose();
    prof.forId = n.id;
    prof.label = `${n.opName}#${n.id}`;
    prof.recording = true;
    prof.done = false;
    prof.commits = prof.deltas = 0;
    prof.totalMs = prof.maxMs = 0;
    prof.allCommits = prof.allDeltas = 0;
    prof.allMs = prof.allMaxMs = 0;
    prof.sub = ctx.runtime.onCommit(onProfCommit);
  }
  function stopProfile() {
    if (prof.sub !== null) {
      prof.sub.dispose();
      prof.sub = null;
    }
    if (prof.recording) {
      prof.recording = false;
      prof.done = true;
    }
    prof.statusEl = null;
  }
  function onProfCommit(c) {
    prof.allCommits++;
    let commitMs = 0;
    for (const s of c.nodes) {
      prof.allDeltas += s.deltas;
      prof.allMs += s.ms;
      commitMs += s.ms;
      if (s.id === prof.forId) {
        prof.commits++;
        prof.deltas += s.deltas;
        prof.totalMs += s.ms;
        if (s.ms > prof.maxMs) prof.maxMs = s.ms;
      }
    }
    if (commitMs > prof.allMaxMs) prof.allMaxMs = commitMs;
    if (prof.statusEl !== null) setText(prof.statusEl, profStatus());
  }
  function profStatus() {
    if (prof.recording) return `recording\u2026 ${prof.allCommits} commits \xB7 ${prof.commits} on ${prof.label}`;
    if (prof.done) return `stopped \u2014 ${prof.allCommits} commits`;
    return "idle";
  }
  function render() {
    if (destroyed) return;
    markTabs();
    clearEl(body);
    const id = ctx.selected();
    if (id === null) {
      body.appendChild(el("p", "insp-empty muted", "pick a node \u2014 click one in the graph"));
      return;
    }
    const n = nodeById(ctx.runtime, id);
    if (n === null) {
      body.appendChild(el("p", "insp-empty muted", `node #${id} is disposed`));
      return;
    }
    if (activeTab === "inspect") renderInspect(n);
    else if (activeTab === "events") renderEvents(n);
    else renderProfile(n);
  }
  function card(cls, title) {
    const c = el("section", `insp-card insp-card-${cls}`);
    c.appendChild(el("div", "card-title", title));
    const b = el("div", "card-body");
    c.appendChild(b);
    body.appendChild(c);
    return b;
  }
  function renderInspect(n) {
    const info = inspect(n);
    const opName = info.opName ?? info.op;
    const idB = card("identity", "IDENTITY");
    idB.appendChild(el("div", "card-headline", `${opName}#${info.id}`));
    idB.appendChild(el("div", "card-sub", `${info.kind} \xB7 height ${info.height}`));
    const valB = card("value", "CURRENT VALUE");
    valB.appendChild(el("pre", "card-value", fmtValue(info.value)));
    const connB = card("connections", "CONNECTIONS");
    const names = opNames2();
    const chipRow = (dir, ids, empty) => {
      const row = el("div", "conn-row");
      row.appendChild(el("span", "conn-dir", dir));
      if (ids.length === 0) row.appendChild(el("span", "conn-detail muted", empty));
      else
        for (const cid of ids) {
          const chip = el("button", "conn-chip", `${names.get(cid) ?? "disposed"}#${cid}`);
          chip.addEventListener("click", () => ctx.select(cid));
          row.appendChild(chip);
        }
      connB.appendChild(row);
    };
    chipRow("\u2191 in", info.parents ?? n.parents.map((p) => p.id), "(root \u2014 no parents)");
    chipRow("\u2193 out", info.children ?? n.children.map((c) => c.id), "(no children)");
  }
  function renderEvents(n) {
    ensureFeed(n);
    const ctrls = el("div", "ev-controls");
    const pauseBtn = el("button", "ev-pause", ev.paused ? "resume" : "pause");
    pauseBtn.addEventListener("click", () => {
      ev.paused = !ev.paused;
      setText(pauseBtn, ev.paused ? "resume" : "pause");
    });
    const clearBtn = el("button", "ev-clear", "clear");
    clearBtn.addEventListener("click", () => {
      ev.ring.length = 0;
      ev.seen = 0;
      if (ev.listEl !== null) clearEl(ev.listEl);
      if (ev.badgeEl !== null) setText(ev.badgeEl, badgeText());
    });
    const badge = el("span", "ev-badge", badgeText());
    ctrls.appendChild(pauseBtn);
    ctrls.appendChild(clearBtn);
    ctrls.appendChild(badge);
    body.appendChild(ctrls);
    const list = el("ol", "ev-feed");
    for (let i = ev.ring.length - 1; i >= 0; i--) list.appendChild(buildEvRow(ev.ring[i]));
    body.appendChild(list);
    ev.listEl = list;
    ev.badgeEl = badge;
  }
  function renderProfile(n) {
    const ctrls = el("div", "ev-controls");
    const btn = el("button", "prof-record", prof.recording ? "stop" : "record");
    btn.addEventListener("click", () => {
      if (prof.recording) stopProfile();
      else startProfile(n);
      render();
    });
    const status = el("span", "prof-status muted", profStatus());
    prof.statusEl = status;
    ctrls.appendChild(btn);
    ctrls.appendChild(status);
    body.appendChild(ctrls);
    if (!prof.recording && prof.done) renderProfTable();
  }
  function renderProfTable() {
    const wrap = el("div", "prof-wrap");
    const tbl = el("table", "prof");
    const mkRow = (cells, tag, cls) => {
      const tr = el("tr", cls);
      for (const c of cells) tr.appendChild(el(tag, void 0, c));
      return tr;
    };
    tbl.appendChild(mkRow(["scope", "commits", "deltas", "total ms", "mean ms", "max ms"], "th", "prof-head"));
    tbl.appendChild(
      mkRow(
        [
          prof.label,
          String(prof.commits),
          String(prof.deltas),
          prof.totalMs.toFixed(2),
          (prof.totalMs / Math.max(1, prof.commits)).toFixed(3),
          prof.maxMs.toFixed(2)
        ],
        "td",
        "prof-sel"
      )
    );
    tbl.appendChild(
      mkRow(
        [
          "all nodes",
          String(prof.allCommits),
          String(prof.allDeltas),
          prof.allMs.toFixed(2),
          (prof.allMs / Math.max(1, prof.allCommits)).toFixed(3),
          prof.allMaxMs.toFixed(2)
        ],
        "td",
        "prof-all"
      )
    );
    wrap.appendChild(tbl);
    body.appendChild(wrap);
  }
  const offSelect = ctx.onSelect(() => {
    if (destroyed) return;
    const id = ctx.selected();
    if (ev.sub !== null && id !== ev.forId) stopFeed();
    if (prof.sub !== null && id !== prof.forId) stopProfile();
    render();
  });
  render();
  return {
    refresh() {
      render();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      offSelect();
      stopFeed();
      stopProfile();
      nav.remove();
      body.remove();
    }
  };
}

// v3/devtools/panel/picker.ts
var OUTLINE2 = "2px solid #e3b341";
function setStyle(el, css) {
  const st = el == null ? null : el.style;
  if (st == null) return;
  for (const k in css) st[k] = css[k];
}
var isAlt = (e) => e.key === "Alt" || e.code === "AltLeft" || e.code === "AltRight";
function mountPicker(ctx, toolbar) {
  const doc = ctx.doc;
  function listen(target, type, fn, capture, bag) {
    target.addEventListener(type, fn, capture);
    bag.push(() => target.removeEventListener(type, fn, capture));
  }
  function drain(bag) {
    while (bag.length > 0) bag.pop()();
  }
  let outlined = null;
  function outline(el) {
    if (outlined !== null && outlined.el === el) return;
    restore();
    const st = el == null ? null : el.style;
    outlined = { el, outline: st == null ? void 0 : st.outline, offset: st == null ? void 0 : st.outlineOffset };
    setStyle(el, { outline: OUTLINE2, outlineOffset: "1px" });
  }
  function restore() {
    if (outlined === null) return;
    setStyle(outlined.el, { outline: outlined.outline ?? "", outlineOffset: outlined.offset ?? "" });
    outlined = null;
  }
  function rowElOf(hovered, res) {
    if (res.key === void 0) return hovered;
    for (const r of rowElements(res.node)) if (r.key === res.key) return r.el;
    return hovered;
  }
  const pickerOff = [];
  let picking = false;
  const btn = doc.createElement("button");
  btn.textContent = "\u25CE";
  btn.title = "pick a DOM element to find its view";
  const onBtn = () => {
    picking ? stopPicking() : startPicking();
  };
  btn.addEventListener("click", onBtn);
  toolbar.appendChild(btn);
  function startPicking() {
    if (picking) return;
    picking = true;
    btn.setAttribute("aria-pressed", "true");
    setStyle(doc.body, { cursor: "crosshair" });
    listen(doc, "mousemove", onPickMove, true, pickerOff);
    listen(doc, "click", onPickClick, true, pickerOff);
    listen(doc, "keydown", onPickKey, true, pickerOff);
  }
  function stopPicking() {
    if (!picking) return;
    picking = false;
    btn.removeAttribute("aria-pressed");
    setStyle(doc.body, { cursor: "" });
    restore();
    drain(pickerOff);
  }
  function onPickMove(e) {
    const res = fromDOM(e.target);
    if (res === null) {
      restore();
      return;
    }
    outline(rowElOf(e.target, res));
  }
  function onPickClick(e) {
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    const res = fromDOM(e.target);
    stopPicking();
    if (res !== null) ctx.select(res.node.id);
  }
  function onPickKey(e) {
    if (e.key === "Escape") stopPicking();
  }
  const altOff = [];
  let engaged = false;
  let badge = null;
  const onGate = (e) => {
    if (!isAlt(e) || engaged) return;
    if (e.preventDefault) e.preventDefault();
    engage();
  };
  function engage() {
    engaged = true;
    listen(doc, "mousemove", onAltMove, true, altOff);
    listen(doc, "keyup", onAltUp, true, altOff);
    const win = doc.defaultView;
    if (win != null && typeof win.addEventListener === "function") listen(win, "blur", disengage, false, altOff);
  }
  function disengage() {
    if (!engaged) return;
    engaged = false;
    hideBadge();
    drain(altOff);
  }
  function onAltUp(e) {
    if (!isAlt(e)) return;
    if (e.preventDefault) e.preventDefault();
    disengage();
  }
  function onAltMove(e) {
    if (e.altKey === false) {
      disengage();
      return;
    }
    const res = fromDOM(e.target);
    if (res === null) {
      hideBadge();
      return;
    }
    showBadge(res, rowElOf(e.target, res), e);
  }
  function showBadge(res, el, e) {
    if (badge === null) {
      badge = doc.createElement("div");
      setStyle(badge, {
        position: "fixed",
        zIndex: "2147483646",
        pointerEvents: "none",
        font: "10px/1.4 ui-monospace, monospace",
        whiteSpace: "nowrap",
        background: "#e3b341",
        color: "#0f0f0f",
        padding: "2px 6px",
        borderRadius: "2px"
      });
    }
    badge.textContent = res.key === void 0 ? String(res.node.opName) : `${res.node.opName} \xB7 ${String(res.key)}`;
    const r = el != null && typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : null;
    const left = r !== null ? r.left : e.clientX + 12;
    const top = r !== null ? Math.max(0, r.top - 20) : e.clientY + 14;
    setStyle(badge, { left: `${left}px`, top: `${top}px` });
    const host = doc.body ?? ctx.root;
    if (badge.parentNode !== host) host.appendChild(badge);
  }
  function hideBadge() {
    if (badge !== null && badge.parentNode != null) badge.remove();
  }
  doc.addEventListener("keydown", onGate, true);
  function destroy() {
    stopPicking();
    disengage();
    doc.removeEventListener("keydown", onGate, true);
    btn.removeEventListener("click", onBtn);
    btn.remove();
    badge = null;
  }
  return { destroy };
}

// v3/devtools/panel/index.ts
import { runtime as defaultRuntime2 } from "./index.js";
var WIDTH_KEY = "data-v3-devtools-dock-width";
var WIDTH_DEFAULT = 420;
var WIDTH_MIN = 280;
var WIDTH_MAX_FRAC = 0.8;
var current = null;
function mountPanel(opts = {}) {
  if (current !== null) {
    if (opts.open !== false) current.open();
    return current;
  }
  const doc = document;
  const el = (tag, cls, text) => {
    const e = doc.createElement(tag);
    if (cls !== "") e.setAttribute("class", cls);
    if (text !== void 0) e.textContent = text;
    return e;
  };
  const host = el("div", "");
  host.setAttribute("data-v3-devtools", "");
  let shell;
  if (typeof host.attachShadow === "function") {
    shell = host.attachShadow({ mode: "closed" });
  } else {
    shell = el("div", "");
    shell.setAttribute("data-v3-devtools-shell", "");
    host.appendChild(shell);
  }
  const style = doc.createElement("style");
  style.textContent = CSS_TEXT;
  shell.appendChild(style);
  const dock = el("aside", "dock");
  shell.appendChild(dock);
  const maxWidth = () => typeof window !== "undefined" && typeof window.innerWidth === "number" ? Math.max(WIDTH_MIN, Math.floor(window.innerWidth * WIDTH_MAX_FRAC)) : 1600;
  const clampW = (w) => Math.max(WIDTH_MIN, Math.min(maxWidth(), w));
  let width = WIDTH_DEFAULT;
  try {
    const raw = parseInt(localStorage.getItem(WIDTH_KEY) ?? "", 10);
    if (Number.isFinite(raw)) width = raw;
  } catch {
  }
  const applyWidth = () => {
    width = clampW(width);
    dock.setAttribute("style", `width:${width}px`);
  };
  applyWidth();
  const handle = el("div", "dock-resize");
  handle.title = "drag to resize";
  dock.appendChild(handle);
  let drag = null;
  handle.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX ?? 0, w: width };
    try {
      handle.setPointerCapture?.(e.pointerId);
    } catch {
    }
    e?.preventDefault?.();
  });
  handle.addEventListener("pointermove", (e) => {
    if (drag === null) return;
    width = drag.w - ((e.clientX ?? 0) - drag.x);
    applyWidth();
  });
  const endDrag = (e) => {
    if (drag === null) return;
    drag = null;
    try {
      handle.releasePointerCapture?.(e.pointerId);
    } catch {
    }
    try {
      localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
    } catch {
    }
  };
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
  const header = el("div", "dock-header");
  header.appendChild(el("span", "brand", "data devtools"));
  const tools = el("div", "tools");
  const closeBtn = el("button", "", "\u2715");
  closeBtn.title = "close panel";
  closeBtn.addEventListener("click", () => handleObj.close());
  header.appendChild(tools);
  header.appendChild(closeBtn);
  dock.appendChild(header);
  const body = el("div", "dock-body");
  const graphHost = el("div", "graph-host");
  const inspHost = el("div", "insp-host");
  inspHost.setAttribute("style", "display:none");
  body.appendChild(graphHost);
  body.appendChild(inspHost);
  dock.appendChild(body);
  const ctx = createCtx(defaultRuntime2(), dock, doc);
  let graphCtl = null;
  let inspCtl = null;
  let pickCtl = null;
  let unregs = [];
  let attached = false;
  const unSelect = ctx.onSelect((id) => {
    inspHost.setAttribute("style", id === null ? "display:none" : "");
    if (id !== null) inspCtl?.refresh();
  });
  const mountParts = () => {
    if (graphCtl !== null) return;
    graphCtl = mountGraph(ctx, graphHost);
    inspCtl = mountInspector(ctx, inspHost);
    pickCtl = mountPicker(ctx, tools);
    unregs.push(registerRefreshable(ctx, () => graphCtl.refresh()));
    unregs.push(registerRefreshable(ctx, () => inspCtl.refresh()));
  };
  const handleObj = {
    open(target) {
      if (!attached) {
        doc.body.appendChild(host);
        attached = true;
      }
      mountParts();
      if (target !== void 0 && target !== null) ctx.select(resolveNode(target).id);
      ctx.refresh();
    },
    close() {
      graphCtl?.destroy();
      inspCtl?.destroy();
      pickCtl?.destroy();
      graphCtl = inspCtl = null;
      pickCtl = null;
      for (const u of unregs) u();
      unregs = [];
      ctx.select(null);
      if (attached) {
        host.remove();
        attached = false;
      }
    },
    shell
  };
  void unSelect;
  current = handleObj;
  if (opts.open !== false) {
    handleObj.open();
    setTimeout(() => {
      if (graphCtl !== null) ctx.refresh();
    }, 250);
  }
  return handleObj;
}
var CSS_TEXT = `
:host { all: initial; }
.dock {
  position: fixed; top: 0; right: 0; bottom: 0; width: ${WIDTH_DEFAULT}px;
  background: #1a1a1a; color: #e6e6e6;
  border-left: 1px solid #2a2a2a;
  font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  display: flex; flex-direction: column;
  z-index: 2147483646;
  box-sizing: border-box;
}
.dock-resize {
  position: absolute; top: 0; bottom: 0; left: -3px; width: 7px;
  cursor: col-resize; z-index: 5; background: transparent;
  transition: background .12s;
}
.dock-resize:hover { background: rgba(155,227,168,.35); }
.dock-header {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px; border-bottom: 1px solid #2a2a2a;
  flex-shrink: 0;
}
.brand { color: #9be3a8; font-weight: 600; letter-spacing: .03em; margin-right: auto; }
.tools { display: flex; gap: 4px; }
.dock-header button {
  min-width: 26px; height: 24px; background: transparent; color: #888;
  border: 1px solid transparent; border-radius: 4px; cursor: pointer;
  font: inherit; padding: 0 5px;
}
.dock-header button:hover { color: #e6e6e6; background: #222; border-color: #2a2a2a; }
.dock-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.graph-host { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.insp-host {
  flex-shrink: 0; max-height: 46%; overflow: auto;
  background: #161616; border-top: 1px solid #2a2a2a;
  animation: v3slide .18s ease-out;
}
@keyframes v3slide { from { transform: translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } }

/* graph toolbar */
.gtools {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 10px; background: #222; border-bottom: 1px solid #2a2a2a;
  flex-shrink: 0; font-size: 11px;
}
.gseg { display: inline-flex; border: 1px solid #2a2a2a; border-radius: 4px; overflow: hidden; }
.gseg button {
  background: transparent; color: #888; border: none;
  padding: 3px 12px; cursor: pointer; font: inherit; font-size: 11px;
}
.gseg button:hover { color: #e6e6e6; }
.gseg button.active { background: #1a1a1a; color: #9be3a8; }
.gfit {
  background: transparent; color: #888; border: none; border-radius: 3px;
  min-width: 24px; height: 22px; cursor: pointer; font: inherit;
  margin-left: auto;
}
.gfit:hover { background: #1a1a1a; color: #9be3a8; }
.gscale { color: #888; min-width: 38px; text-align: right; font-variant-numeric: tabular-nums; }

/* graph viewport \u2014 pan + zoom */
.gouter {
  position: relative; flex: 1; min-height: 0; overflow: hidden;
  cursor: grab; touch-action: none;
  background: radial-gradient(circle, #2a2a2a 1px, transparent 1px) 0 0 / 24px 24px, #141414;
}
.gcanvas { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
.gedges { position: absolute; left: 0; top: 0; pointer-events: none; }
.gedges line { stroke: #5e7593; stroke-width: 1.2; opacity: .8; }
.gempty { padding: 16px; color: #666; }
.gnode {
  position: absolute; box-sizing: border-box;
  border: 1px solid #2a2a2a; border-radius: 3px;
  background: #1f1f1f; padding: 2px 5px; cursor: pointer;
  display: flex; flex-direction: column; justify-content: center;
  font-size: 10px; line-height: 1.15;
}
.gnode:hover { filter: brightness(1.3); z-index: 1; }
.gnode-label { color: #e6e6e6; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
.gnode-sub { color: #888; font-size: 9px; white-space: nowrap; }
.gnode.kind-source { background: #2d3a2d; border-color: #3a4f3a; }
.gnode.kind-source .gnode-label { color: #9be3a8; }
.gnode.kind-operator { background: #2d3447; border-color: #3a4760; }
.gnode.kind-operator .gnode-label { color: #9bb3e3; }
.gnode.kind-scalar { background: #3a3727; border-color: #55502f; }
.gnode.kind-scalar .gnode-label { color: #e3c98e; }
.gnode.selected {
  box-shadow: 0 0 0 2px #9be3a8, 0 0 14px rgba(155,227,168,.55);
  border-color: #9be3a8; z-index: 3;
}

/* picker (\u25CE) armed state */
.dock-header button[aria-pressed="true"] { color: #e3b341; border-color: #e3b341; background: #222; }

/* inspector \u2014 tabs */
.insp-tabs { display: flex; border-bottom: 1px solid #2a2a2a; }
.insp-tab {
  flex: 1; background: transparent; color: #888; border: none;
  padding: 7px 4px; cursor: pointer; font: inherit; font-size: 11px;
  border-bottom: 2px solid transparent; text-transform: capitalize;
}
.insp-tab:hover { color: #e6e6e6; }
.insp-tab.active { color: #9be3a8; border-bottom-color: #9be3a8; }
.insp-body { padding: 10px 12px; }
.insp-empty { margin: 0; font-style: italic; font-size: 11px; }
.muted { color: #888; }

/* inspector \u2014 card stack (Inspect tab) */
.insp-card {
  background: #131313; border: 1px solid #2a2a2a; border-radius: 6px;
  margin: 0 0 10px; overflow: hidden;
}
.card-title {
  padding: 6px 10px; background: #181818; border-bottom: 1px solid #2a2a2a;
  color: #888; font-size: 10px; text-transform: uppercase; letter-spacing: .08em;
}
.card-body { padding: 10px 12px; }
.insp-card-identity { border-color: #3a4f3a; }
.insp-card-identity .card-title { background: #1f2a20; color: #9be3a8; }
.card-headline { color: #9be3a8; font-size: 13px; font-weight: 600; word-break: break-all; }
.card-sub { color: #888; font-size: 11px; margin-top: 4px; }
pre.card-value {
  margin: 0; font: inherit; color: #e6e6e6;
  background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 4px;
  padding: 8px 10px; max-height: 200px; overflow: auto; white-space: pre; tab-size: 2;
}
.conn-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 4px 0; font-size: 11px; }
.conn-dir { color: #9bb3e3; width: 44px; flex-shrink: 0; }
.conn-detail { word-break: break-all; }
.conn-chip {
  background: #222; color: #ddd; border: 1px solid #2a2a2a;
  padding: 2px 8px; border-radius: 8px; cursor: pointer; font: inherit; font-size: 10px;
}
.conn-chip:hover { border-color: #9be3a8; color: #9be3a8; }

/* inspector \u2014 Events / Profile shared controls */
.ev-controls { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
.ev-controls button {
  background: #222; color: #ddd; border: 1px solid #2a2a2a;
  padding: 4px 10px; border-radius: 4px; cursor: pointer; font: inherit; font-size: 11px;
}
.ev-controls button:hover { border-color: #9be3a8; color: #9be3a8; }
.ev-badge { margin-left: auto; color: #888; font-size: 10px; font-variant-numeric: tabular-nums; white-space: nowrap; }

/* inspector \u2014 Events feed */
.ev-feed { list-style: none; padding: 0; margin: 0; }
.ev-row { border-bottom: 1px solid #1f1f1f; font-size: 11px; }
.ev-row-head { padding: 4px 0; cursor: pointer; color: #ddd; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ev-row-head:hover { color: #9be3a8; }
.ev-row-detail { padding: 2px 0 6px 12px; border-left: 2px solid #2a2a2a; margin-bottom: 4px; }
.ev-detail-line { color: #888; font-size: 10px; padding: 1px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ev-cascade { color: #9bb3e3; }
.ev-after { color: #e3c98e; }

/* inspector \u2014 Profile table */
.prof-status { font-size: 11px; font-variant-numeric: tabular-nums; }
.prof-wrap { overflow: auto; }
table.prof { width: 100%; border-collapse: collapse; font-size: 11px; }
table.prof th, table.prof td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #2a2a2a; }
table.prof th { color: #888; font-weight: 500; background: #181818; }
table.prof td:nth-child(n+2), table.prof th:nth-child(n+2) { text-align: right; font-variant-numeric: tabular-nums; }
.prof-sel td:first-child { color: #9be3a8; }
.prof-all td { color: #888; }
`;

// v3/devtools/entry.ts
var dollar = $;
dollar.inspect = inspect;
dollar.graph = graph;
dollar.trace = trace;
dollar.profile = profile;
dollar.cascades = cascades;
dollar.fromDOM = fromDOM;
dollar.highlight = highlight;
var inst = null;
function ensure() {
  if (inst === null) inst = mountPanel({ open: false });
  return inst;
}
if (typeof document !== "undefined") {
  dollar.devtools = {
    panel: {
      open(target) {
        ensure().open(target);
      },
      close() {
        if (inst !== null) inst.close();
      },
      get shell() {
        return inst !== null ? inst.shell : null;
      }
    }
  };
  const noPanel = typeof location !== "undefined" && /(?:^|[?&])nopanel(?:[=&]|$)/.test(location.search);
  if (!noPanel) {
    const boot = () => {
      if (document.body != null) ensure().open();
      else setTimeout(boot, 10);
    };
    boot();
  }
}
export {
  cascades,
  fromDOM,
  graph,
  highlight,
  inspect,
  mountPanel,
  profile,
  resolveNode,
  rowElements,
  trace
};
//# sourceMappingURL=devtools.js.map