// v3/devtools/panel/inspector.ts — the slide-in inspector: three tabs
// (Inspect / Events / Profile) over the panel's selected graph node.
//
// Subscription discipline (the v2 leak lesson): every runtime.onCommit hook
// lives exactly as long as the tab that needs it — the Events feed subscribes
// while the Events tab is visible AND a node is selected, a Profile recording
// subscribes between record and stop, and BOTH are disposed on tab switch,
// deselect, and destroy(). Pause keeps the feed subscription (resume must not
// miss the re-entry commit) and just drops rows; the kernel only measures
// while a hook is live, so an idle inspector costs the runtime nothing.
//
// Data sources are the kernel's two native primitives, nothing else:
// inspect() (from ../index.ts, the consumption layer) for identity + the
// materialized value, and Runtime.onCommit's CommitInfo for the feed/profile.
// CommitInfo carries per-node {id, deltas, ms} STATS, not record payloads —
// so an Events row's expandable preview is the commit's cascade breakdown
// (op#id · δ · ms in settle order) plus the selected node's value after the
// commit, not a record list. profile(target, fn) wraps a closure and cannot
// shape a live record toggle, hence onCommit directly here.
//
// id → live node: Runtime.graph() is deliberately the serializable projection,
// but inspect()/value need the LIVE node, so selection resolves by scanning
// the runtime's WeakRef registry (private by convention, not #private) — a
// devtools-only O(graph) walk, never on the commit hot path.
//
// Import boundary: './ctx.ts' (type-only), '../index.ts' (consumption layer),
// '../../api/index.ts' (type-only here). No kernel/render/compat paths.

import type { PanelCtx } from './ctx.ts'
import { inspect } from '../index.ts'
import type { DataNode, Runtime } from '../../api/index.ts'

const EVENTS_MAX = 200 // Events ring buffer — rows AND DOM list share the cap
const ROW_CAP = 20 // CURRENT VALUE collapses collections beyond this many rows
const PREVIEW_CAP = 120 // chars for the per-commit value-after preview

type Tab = 'inspect' | 'events' | 'profile'
const TABS: readonly Tab[] = ['inspect', 'events', 'profile']

// Structural mirror of kernel CommitInfo (the type is not re-exported through
// the api entry; the boundary forbids importing kernel paths for it).
interface CommitStat {
  readonly id: number
  readonly deltas: number
  readonly ms: number
}
interface Commit {
  readonly seq: number
  readonly origin: symbol
  readonly nodes: readonly CommitStat[]
}

interface EvRow {
  seq: number
  deltas: number
  ms: number
  origin: string
  cascade: readonly string[]
  after: string
}

// ── shared helpers (mock-dom-safe: real DOM clears via firstChild, the El
// mock via its children array — each loop no-ops on the other) ───────────────

function clearEl(e: any): void {
  while (e.firstChild) e.removeChild(e.firstChild)
  const kids = e.children
  while (kids && kids.length > 0) e.removeChild(kids[kids.length - 1])
}

function prim(v: unknown): string {
  return typeof v === 'string' ? JSON.stringify(v) : String(v)
}

// Pretty-print a node value: primitives inline; collections pretty-JSON,
// collapsed past ROW_CAP to a count + the first rows (cycles → String(v)).
function fmtValue(v: unknown): string {
  if (v === null || typeof v !== 'object') return prim(v)
  try {
    if (Array.isArray(v)) {
      if (v.length <= ROW_CAP) return JSON.stringify(v, null, 2)
      return `Array(${v.length}) — first ${ROW_CAP} rows\n` + JSON.stringify(v.slice(0, ROW_CAP), null, 2)
    }
    const keys = Object.keys(v as object)
    if (keys.length <= ROW_CAP) return JSON.stringify(v, null, 2)
    const head: Record<string, unknown> = {}
    for (const k of keys.slice(0, ROW_CAP)) head[k] = (v as any)[k]
    return `{ ${keys.length} keys } — first ${ROW_CAP}\n` + JSON.stringify(head, null, 2)
  } catch {
    return String(v)
  }
}

function fmtShort(v: unknown): string {
  let s: string
  try {
    s = v === undefined ? 'undefined' : JSON.stringify(v) ?? String(v)
  } catch {
    s = String(v)
  }
  return s.length > PREVIEW_CAP ? s.slice(0, PREVIEW_CAP - 1) + '…' : s
}

function originLabel(o: symbol): string {
  return o.description || 'anonymous'
}

function nodeById(rt: Runtime, id: number): DataNode<any> | null {
  const reg = (rt as any).registry as Set<WeakRef<DataNode<any>>> | undefined
  if (reg === undefined) return null
  for (const ref of reg) {
    const n = ref.deref()
    if (n !== undefined && !n.disposed && n.id === id) return n
  }
  return null
}

// ── mount ────────────────────────────────────────────────────────────────────

export function mountInspector(ctx: PanelCtx, host: any): { refresh(): void; destroy(): void } {
  const doc = ctx.doc

  const el = (tag: string, cls?: string, text?: string): any => {
    const e = doc.createElement(tag)
    if (cls !== undefined) e.setAttribute('class', cls)
    if (text !== undefined) e.appendChild(doc.createTextNode(text))
    return e
  }
  const setText = (e: any, s: string): void => {
    clearEl(e)
    e.appendChild(doc.createTextNode(s))
  }
  const opNames = (): Map<number, string> => {
    const m = new Map<number, string>()
    for (const g of ctx.runtime.graph()) m.set(g.id, g.op)
    return m
  }

  let destroyed = false
  let activeTab: Tab = 'inspect'

  // Per-mount tab state. Rendering reads it; subscriptions write it — so
  // refresh() can repaint Events/Profile without tearing down their in-flight
  // subscriptions/buffers (v2 lost tab state on every cascade repaint).
  const ev = {
    sub: null as { dispose(): void } | null,
    forId: null as number | null,
    ring: [] as EvRow[],
    paused: false,
    seen: 0,
    names: new Map<number, string>(),
    listEl: null as any,
    badgeEl: null as any,
  }
  const prof = {
    sub: null as { dispose(): void } | null,
    forId: null as number | null,
    label: '',
    recording: false,
    done: false, // a recording finished — the table is showable
    commits: 0,
    deltas: 0,
    totalMs: 0,
    maxMs: 0,
    allCommits: 0,
    allDeltas: 0,
    allMs: 0,
    allMaxMs: 0,
    statusEl: null as any,
  }

  // ── chrome (built once; render() only repaints the body) ──────────────────
  const nav = el('nav', 'insp-tabs')
  const tabBtns = new Map<Tab, any>()
  for (const t of TABS) {
    const b = el('button', 'insp-tab', t)
    b.addEventListener('click', () => setTab(t))
    tabBtns.set(t, b)
    nav.appendChild(b)
  }
  const body = el('div', 'insp-body')
  host.appendChild(nav)
  host.appendChild(body)

  function markTabs(): void {
    for (const [t, b] of tabBtns) b.setAttribute('class', t === activeTab ? 'insp-tab active' : 'insp-tab')
  }

  function setTab(t: Tab): void {
    if (destroyed || t === activeTab) return
    if (activeTab === 'events') stopFeed()
    if (activeTab === 'profile') stopProfile()
    activeTab = t
    render()
  }

  // ── events feed ────────────────────────────────────────────────────────────

  function ensureFeed(n: DataNode<any>): void {
    if (ev.sub !== null && ev.forId === n.id) return
    stopFeed()
    ev.forId = n.id
    ev.ring.length = 0
    ev.seen = 0
    ev.paused = false
    ev.names = opNames()
    ev.sub = ctx.runtime.onCommit(onFeedCommit as any)
  }

  function stopFeed(): void {
    if (ev.sub !== null) {
      ev.sub.dispose()
      ev.sub = null
    }
    ev.listEl = null
    ev.badgeEl = null
  }

  function badgeText(): string {
    return `${ev.seen} commit${ev.seen === 1 ? '' : 's'}`
  }

  function onFeedCommit(c: Commit): void {
    if (ev.forId === null) return
    let stat: CommitStat | undefined
    for (const s of c.nodes) if (s.id === ev.forId) { stat = s; break }
    if (stat === undefined) return // commit didn't touch the selected node
    if (ev.paused) return // paused drops rows; the subscription stays live
    ev.seen++
    // Op names resolve from a cached graph() map, re-pulled at most once per
    // commit when an unseen id appears (a node built after the feed started).
    let repulled = false
    const nameOf = (nid: number): string => {
      let s = ev.names.get(nid)
      if (s === undefined && !repulled) {
        repulled = true
        ev.names = opNames()
        s = ev.names.get(nid)
      }
      return s ?? 'disposed'
    }
    const cascade = c.nodes.map((s) => `${nameOf(s.id)}#${s.id} · ${s.deltas}δ · ${s.ms.toFixed(2)}ms`)
    // Hooks fire post-settle, so the snapshot read is consistent. O(node)
    // per commit, only while the feed is subscribed — devtools cadence.
    const n = nodeById(ctx.runtime, ev.forId)
    const after = n === null ? '(disposed)' : fmtShort(inspect(n).value)
    const row: EvRow = { seq: c.seq, deltas: stat.deltas, ms: stat.ms, origin: originLabel(c.origin), cascade, after }
    ev.ring.push(row)
    if (ev.ring.length > EVENTS_MAX) ev.ring.shift()
    if (ev.listEl !== null) {
      const list = ev.listEl
      list.insertBefore(buildEvRow(row), list.children.length > 0 ? list.children[0] : null)
      while (list.children.length > EVENTS_MAX) list.removeChild(list.children[list.children.length - 1])
    }
    if (ev.badgeEl !== null) setText(ev.badgeEl, badgeText())
  }

  function buildEvRow(r: EvRow): any {
    const row = el('li', 'ev-row')
    const head = el('div', 'ev-row-head', `#${r.seq} · ${r.deltas}δ · ${r.ms.toFixed(2)}ms · ${r.origin}`)
    const detail = el('div', 'ev-row-detail')
    detail.appendChild(el('div', 'ev-detail-line', `origin: ${r.origin}`))
    for (const line of r.cascade) detail.appendChild(el('div', 'ev-detail-line ev-cascade', line))
    detail.appendChild(el('div', 'ev-detail-line ev-after', `value after: ${r.after}`))
    // Detail toggles by attach/detach (works on real DOM and the El mock —
    // neither `hidden` nor classList is assumed).
    head.addEventListener('click', () => {
      if (detail.parentNode) row.removeChild(detail)
      else row.appendChild(detail)
    })
    row.appendChild(head)
    return row
  }

  // ── profile recording ──────────────────────────────────────────────────────

  function startProfile(n: DataNode<any>): void {
    if (prof.sub !== null) prof.sub.dispose()
    prof.forId = n.id
    prof.label = `${n.opName}#${n.id}`
    prof.recording = true
    prof.done = false
    prof.commits = prof.deltas = 0
    prof.totalMs = prof.maxMs = 0
    prof.allCommits = prof.allDeltas = 0
    prof.allMs = prof.allMaxMs = 0
    prof.sub = ctx.runtime.onCommit(onProfCommit as any)
  }

  function stopProfile(): void {
    if (prof.sub !== null) {
      prof.sub.dispose()
      prof.sub = null
    }
    if (prof.recording) {
      prof.recording = false
      prof.done = true
    }
    prof.statusEl = null
  }

  function onProfCommit(c: Commit): void {
    prof.allCommits++
    let commitMs = 0
    for (const s of c.nodes) {
      prof.allDeltas += s.deltas
      prof.allMs += s.ms
      commitMs += s.ms
      if (s.id === prof.forId) {
        prof.commits++
        prof.deltas += s.deltas
        prof.totalMs += s.ms
        if (s.ms > prof.maxMs) prof.maxMs = s.ms
      }
    }
    if (commitMs > prof.allMaxMs) prof.allMaxMs = commitMs
    if (prof.statusEl !== null) setText(prof.statusEl, profStatus())
  }

  function profStatus(): string {
    if (prof.recording) return `recording… ${prof.allCommits} commits · ${prof.commits} on ${prof.label}`
    if (prof.done) return `stopped — ${prof.allCommits} commits`
    return 'idle'
  }

  // ── rendering ──────────────────────────────────────────────────────────────

  function render(): void {
    if (destroyed) return
    markTabs()
    clearEl(body)
    const id = ctx.selected()
    if (id === null) {
      body.appendChild(el('p', 'insp-empty muted', 'pick a node — click one in the graph'))
      return
    }
    const n = nodeById(ctx.runtime, id)
    if (n === null) {
      body.appendChild(el('p', 'insp-empty muted', `node #${id} is disposed`))
      return
    }
    if (activeTab === 'inspect') renderInspect(n)
    else if (activeTab === 'events') renderEvents(n)
    else renderProfile(n)
  }

  function card(cls: string, title: string): any {
    const c = el('section', `insp-card insp-card-${cls}`)
    c.appendChild(el('div', 'card-title', title))
    const b = el('div', 'card-body')
    c.appendChild(b)
    body.appendChild(c)
    return b
  }

  function renderInspect(n: DataNode<any>): void {
    // inspect() ships {id, kind, op/opName, height, parents, value}; children
    // come off the live node (fan-out is not part of the serializable info).
    const info: any = inspect(n)
    const opName: string = info.opName ?? info.op

    const idB = card('identity', 'IDENTITY')
    idB.appendChild(el('div', 'card-headline', `${opName}#${info.id}`))
    idB.appendChild(el('div', 'card-sub', `${info.kind} · height ${info.height}`))

    const valB = card('value', 'CURRENT VALUE')
    valB.appendChild(el('pre', 'card-value', fmtValue(info.value)))

    const connB = card('connections', 'CONNECTIONS')
    const names = opNames()
    const chipRow = (dir: string, ids: readonly number[], empty: string): void => {
      const row = el('div', 'conn-row')
      row.appendChild(el('span', 'conn-dir', dir))
      if (ids.length === 0) row.appendChild(el('span', 'conn-detail muted', empty))
      else
        for (const cid of ids) {
          const chip = el('button', 'conn-chip', `${names.get(cid) ?? 'disposed'}#${cid}`)
          chip.addEventListener('click', () => ctx.select(cid))
          row.appendChild(chip)
        }
      connB.appendChild(row)
    }
    chipRow('↑ in', info.parents ?? n.parents.map((p) => p.id), '(root — no parents)')
    chipRow('↓ out', info.children ?? n.children.map((c) => c.id), '(no children)')
  }

  function renderEvents(n: DataNode<any>): void {
    ensureFeed(n)
    const ctrls = el('div', 'ev-controls')
    const pauseBtn = el('button', 'ev-pause', ev.paused ? 'resume' : 'pause')
    pauseBtn.addEventListener('click', () => {
      ev.paused = !ev.paused
      setText(pauseBtn, ev.paused ? 'resume' : 'pause')
    })
    const clearBtn = el('button', 'ev-clear', 'clear')
    clearBtn.addEventListener('click', () => {
      ev.ring.length = 0
      ev.seen = 0
      if (ev.listEl !== null) clearEl(ev.listEl)
      if (ev.badgeEl !== null) setText(ev.badgeEl, badgeText())
    })
    const badge = el('span', 'ev-badge', badgeText())
    ctrls.appendChild(pauseBtn)
    ctrls.appendChild(clearBtn)
    ctrls.appendChild(badge)
    body.appendChild(ctrls)
    const list = el('ol', 'ev-feed')
    for (let i = ev.ring.length - 1; i >= 0; i--) list.appendChild(buildEvRow(ev.ring[i])) // newest first
    body.appendChild(list)
    ev.listEl = list
    ev.badgeEl = badge
  }

  function renderProfile(n: DataNode<any>): void {
    const ctrls = el('div', 'ev-controls')
    const btn = el('button', 'prof-record', prof.recording ? 'stop' : 'record')
    btn.addEventListener('click', () => {
      if (prof.recording) stopProfile()
      else startProfile(n)
      render()
    })
    const status = el('span', 'prof-status muted', profStatus())
    prof.statusEl = status
    ctrls.appendChild(btn)
    ctrls.appendChild(status)
    body.appendChild(ctrls)
    if (!prof.recording && prof.done) renderProfTable()
  }

  function renderProfTable(): void {
    const wrap = el('div', 'prof-wrap')
    const tbl = el('table', 'prof')
    const mkRow = (cells: string[], tag: 'th' | 'td', cls: string): any => {
      const tr = el('tr', cls)
      for (const c of cells) tr.appendChild(el(tag, undefined, c))
      return tr
    }
    tbl.appendChild(mkRow(['scope', 'commits', 'deltas', 'total ms', 'mean ms', 'max ms'], 'th', 'prof-head'))
    tbl.appendChild(
      mkRow(
        [
          prof.label,
          String(prof.commits),
          String(prof.deltas),
          prof.totalMs.toFixed(2),
          (prof.totalMs / Math.max(1, prof.commits)).toFixed(3),
          prof.maxMs.toFixed(2),
        ],
        'td',
        'prof-sel',
      ),
    )
    tbl.appendChild(
      mkRow(
        [
          'all nodes',
          String(prof.allCommits),
          String(prof.allDeltas),
          prof.allMs.toFixed(2),
          (prof.allMs / Math.max(1, prof.allCommits)).toFixed(3),
          prof.allMaxMs.toFixed(2),
        ],
        'td',
        'prof-all',
      ),
    )
    wrap.appendChild(tbl)
    body.appendChild(wrap)
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  // A selection change retargets the tabs: the feed re-subscribes to the new
  // node via renderEvents→ensureFeed; a live recording stops (it aggregates
  // the node it started on — silently switching targets would mix stats).
  const offSelect = ctx.onSelect(() => {
    if (destroyed) return
    const id = ctx.selected()
    if (ev.sub !== null && id !== ev.forId) stopFeed()
    if (prof.sub !== null && id !== prof.forId) stopProfile()
    render()
  })

  render()

  return {
    refresh(): void {
      render()
    },
    destroy(): void {
      if (destroyed) return
      destroyed = true
      offSelect()
      stopFeed()
      stopProfile()
      nav.remove()
      body.remove()
    },
  }
}
