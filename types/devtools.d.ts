// types/devtools.d.ts — the SHIPPED types for 'data/devtools' (package.json
// exports["./devtools"].types): what a consumer's tsc resolves for
// `import { inspect } from 'data/devtools'`. The runtime behind it is
// dist/devtools/entry.js (devtools/entry.ts type-stripped). This file
// declares EXACTLY that entry's exports, hand-mirrored from devtools/index.ts
// (resolveNode / inspect / graph / trace / profile / cascades + their
// interfaces), devtools/dom.ts (fromDOM / rowElements / highlight) and
// devtools/panel/index.ts (mountPanel — its return interface is file-local
// there and exported here as PanelHandle). Keep it in LOCKSTEP with those
// three files; nothing here is invented.
//
// SELF-CONTAINED for node_modules: the one import is './public.js' (the
// relative specifier every moduleResolution substitutes to ./public.d.ts),
// and everything typed by name — DataNode / Runtime / RowKey / CommitInfo /
// GraphNodeInfo — is public.d.ts's, so a consumer's `d[node]`, `runtime()`
// and a trace() result are one vocabulary with the main entry.
//
// SIDE EFFECTS of importing the entry (the v2 data/devtools discipline,
// typed below as a module augmentation of public.d.ts's `$`):
//   1. the helpers attach onto the canonical $ — $.inspect / $.graph /
//      $.trace / $.profile / $.cascades / $.fromDOM / $.highlight are the
//      SAME functions as the named exports (rowElements is NOT attached), one
//      console keystroke away;
//   2. in a browser (typeof document !== 'undefined') $.devtools.panel.{open,
//      close, shell} becomes the lazy panel facade — nothing is built until
//      the first open() — and the overlay panel AUTO-MOUNTS unless the page
//      URL carries ?nopanel (console API without the visible UI; open() can
//      still summon the dock later). Outside a browser the helpers attach
//      and $.devtools is never assigned — hence `| undefined` below: the type
//      makes you write $.devtools?.panel, which is the truth.
// The augmentation targets './public.js' (relative, not the bare 'data'), so
// it needs no package self-reference and merges under any moduleResolution;
// public.d.ts's `$` is an ambient function declaration, which an ambient
// `namespace $` merges with cleanly — no DevtoolsDollar facade needed. The
// augmentation is program-wide once this file is in the program, exactly as
// the runtime attach is process-wide once the entry is imported anywhere.
//
// Gate: types/tsconfig.public.json maps 'data/devtools' here via paths and
// compiles check.public.devtools.ts (positives + biting negatives).

import type { DataNode, Runtime, RowKey, CommitInfo, GraphNodeInfo } from './public.js'

// ── the consumption layer (devtools/index.ts) ────────────────────────────────

// Anything the helpers accept as "where is the graph": a Runtime, a raw
// DataNode, or a public handle (resolved via Symbol.for('data.v4.node'));
// null / undefined = the default runtime().
export type DevtoolsTarget = Runtime | DataNode<any> | object | null | undefined

export interface InspectInfo {
  readonly id: number
  readonly kind: 'source' | 'operator' | 'scalar'
  readonly op: string
  readonly height: number
  readonly parents: readonly number[]
  readonly value: unknown
}

export interface GraphEdge {
  readonly from: number // parent id
  readonly to: number // child id
}

export interface GraphInfo {
  readonly nodes: readonly GraphNodeInfo[]
  readonly edges: readonly GraphEdge[]
}

export interface ProfileRow {
  readonly id: number
  readonly op: string
  commits: number
  deltas: number
  totalMs: number
}

export interface CascadeNode {
  readonly id: number
  readonly op: string
  readonly name: string // `${op}#${id}` — the flow-essay label
  readonly deltas: number
  readonly ms: number
}

export interface Cascade {
  readonly seq: number // the cascade id — one commit IS one cascade
  readonly origin: string
  readonly nodes: readonly CascadeNode[]
}

// A public handle (via Symbol.for('data.v4.node')) or a raw node → the node;
// throws on anything else.
export declare function resolveNode(handleOrNode: unknown): DataNode<any>

// One node's identity + topology + current value.
export declare function inspect(handleOrNode: unknown): InspectInfo

// The full graph as data: the kernel's GraphNodeInfo[] plus a flat
// parent → child edge list. Plain JSON — safe to postMessage or persist.
export declare function graph(target?: DevtoolsTarget): GraphInfo

// Runs fn and returns every CommitInfo observed during it (the onCommit hook
// is disposed after, even if fn throws — zero steady-state cost). seq IS the
// cascade id; CommitInfo.nodes are in settle (topological) order.
export declare function trace(target: DevtoolsTarget, fn: () => void): CommitInfo[]

// trace() aggregated per node ({id, op, commits, deltas, totalMs}), sorted by
// id; a node disposed before aggregation still gets a row (op 'disposed').
export declare function profile(target: DevtoolsTarget, fn: () => void): ProfileRow[]

// trace() grouped by cascade (seq), each node labelled `${op}#${id}` in
// settle order — "this write became these deltas, through these views".
export declare function cascades(target: DevtoolsTarget, fn: () => void): Cascade[]

// ── the DOM bridge (devtools/dom.ts) ─────────────────────────────────────────

// The console's $0 → data bridge: walks the parentNode chain to the nearest
// registered row root, so a row element or ANY descendant resolves.
export declare function fromDOM(dom: any): { node: DataNode<any>; key?: RowKey } | null

// view → every bound row element, across ALL live list bindings over it.
export declare function rowElements(target: unknown): { key: RowKey; el: any }[]

// Outlines every row element bound to the target view; returns a restore fn
// that puts the saved inline values back (runs at most once).
export declare function highlight(target: unknown): () => void

// ── the overlay panel (devtools/panel/index.ts) ──────────────────────────────

// mountPanel builds the shell ONCE (module singleton — a second call returns
// the live handle); open() attaches the dock to document.body and mounts the
// modules, close() destroys them and detaches — the handle survives
// close/open cycles. shell is the closed ShadowRoot (or the fallback
// container where attachShadow is missing).
export interface PanelHandle {
  open(target?: unknown): void
  close(): void
  shell: any
}
export declare function mountPanel(opts?: { open?: boolean }): PanelHandle

// $.devtools.panel — the lazy facade the entry installs in a browser: open()
// builds the dock on first call, close() no-ops before that, shell is null
// until the first open().
export interface DevtoolsPanelFacade {
  open(target?: unknown): void
  close(): void
  readonly shell: any
}

// ── the $ attach (the entry's side effect, typed) ────────────────────────────

declare module './public.js' {
  namespace $ {
    function inspect(handleOrNode: unknown): InspectInfo
    function graph(target?: DevtoolsTarget): GraphInfo
    function trace(target: DevtoolsTarget, fn: () => void): CommitInfo[]
    function profile(target: DevtoolsTarget, fn: () => void): ProfileRow[]
    function cascades(target: DevtoolsTarget, fn: () => void): Cascade[]
    function fromDOM(dom: any): { node: DataNode<any>; key?: RowKey } | null
    function highlight(target: unknown): () => void
    // browser-only (typeof document !== 'undefined'); undefined elsewhere
    const devtools: { readonly panel: DevtoolsPanelFacade } | undefined
  }
}
