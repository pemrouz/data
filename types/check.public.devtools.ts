// types/check.public.devtools.ts — the SHIPPED 'data/devtools' fixture.
// Compiled by `npx tsc -p types/tsconfig.public.json`: 'data/devtools'
// resolves through the paths map to ./devtools.d.ts (what
// exports["./devtools"].types serves) and 'data' to ./public.d.ts, so this
// checks exactly what an npm consumer's editor sees — the named exports,
// their result shapes against public.d.ts's vocabulary (DataNode / Runtime /
// RowKey / CommitInfo / GraphNodeInfo), and the typed $ attach (the entry's
// import side effect). Positives must compile; every @ts-expect-error line
// must BITE (a quiet directive fails as TS2578). Never executed.

import { $, runtime, node, Runtime, DataNode } from 'data'
import type { CommitInfo, GraphNodeInfo, RowKey } from 'data'
import {
  resolveNode, inspect, graph, trace, profile, cascades,
  fromDOM, rowElements, highlight, mountPanel,
} from 'data/devtools'
import type {
  DevtoolsTarget, InspectInfo, GraphEdge, GraphInfo, ProfileRow,
  CascadeNode, Cascade, PanelHandle, DevtoolsPanelFacade,
} from 'data/devtools'

const d = $({ a: { v: 1 }, b: { v: 2 } })
const big = d.filter((r) => r.v > 1)

// ── resolution + inspect ─────────────────────────────────────────────────────
const n: DataNode<any> = resolveNode(d) // expect: a handle resolves to public.d.ts's DataNode
const n2: DataNode<any> = resolveNode(d[node]) // expect: a raw node passes through
const info: InspectInfo = inspect(big)
const kind: 'source' | 'operator' | 'scalar' = info.kind
const parents: readonly number[] = info.parents
const val: unknown = info.value

// ── graph: every DevtoolsTarget form ─────────────────────────────────────────
const g: GraphInfo = graph() // expect: target optional → the default runtime
graph(runtime()); graph(new Runtime()); graph(d); graph(d[node]); graph(null); graph(undefined)
const gn: GraphNodeInfo = g.nodes[0] // expect: nodes are public.d.ts's GraphNodeInfo
const gk: 'source' | 'operator' | 'scalar' = gn.kind
const ge: GraphEdge = g.edges[0]
const edge: [number, number] = [ge.from, ge.to]
const target: DevtoolsTarget = undefined

// ── trace / profile / cascades share (target, fn) ────────────────────────────
const commits: CommitInfo[] = trace(d, () => { d.a.v.update(3) }) // expect: public.d.ts's CommitInfo
const seq: number = commits[0].seq
const origin: symbol = commits[0].origin // expect: OriginToken = symbol
const stat: { id: number; deltas: number; ms: number } = commits[0].nodes[0]
const rows: ProfileRow[] = profile(runtime(), () => {})
rows[0].commits += 1 // expect: the three counters are MUTABLE aggregation cells
rows[0].totalMs += rows[0].deltas
const cs: Cascade[] = cascades(null, () => {})
const cn: CascadeNode = cs[0].nodes[0]
const label: string = cn.name
const corigin: string = cs[0].origin // expect: cascades stringify the origin (description)

// ── the DOM bridge ───────────────────────────────────────────────────────────
const link: { node: DataNode<any>; key?: RowKey } | null = fromDOM({}) // expect: dom is any (no DOM lib here)
if (link !== null) { const k: RowKey | undefined = link.key; void k }
const els: { key: RowKey; el: any }[] = rowElements(big)
const restore: () => void = highlight(big) // expect: the restore fn
restore()

// ── the panel ────────────────────────────────────────────────────────────────
const panel: PanelHandle = mountPanel({ open: false })
const same: PanelHandle = mountPanel() // expect: opts optional; the singleton returns
panel.open(d); panel.open(); panel.close()
const shell: any = panel.shell

// ── the $ attach: importing 'data/devtools' types the helpers onto $ ─────────
const viaDollar: InspectInfo = $.inspect(d) // expect: the SAME signature as the named export
const gg: GraphInfo = $.graph()
const tt: CommitInfo[] = $.trace(d, () => {})
const pp: ProfileRow[] = $.profile(d, () => {})
const cc: Cascade[] = $.cascades(d, () => {})
const ll: { node: DataNode<any>; key?: RowKey } | null = $.fromDOM({})
const rr: () => void = $.highlight(d)
$.devtools?.panel.open(d) // expect: browser-only → optional chaining is the honest access
$.devtools?.panel.close()
const facade: DevtoolsPanelFacade | undefined = $.devtools?.panel
const sh: any = $.devtools?.panel.shell
const still = $({ x: 1 }) // expect: $ is still the source constructor after the merge

// ── the Runtime observability trio (what trace()/graph() wrap) ───────────────
const rtSeq: number = runtime().seq // expect: the last settled commit's number (a cascade id)
const rtGraph: GraphNodeInfo[] = runtime().graph() // expect: the same GraphNodeInfo the devtools graph() projects
const hook: { dispose(): void } = runtime().onCommit((c: CommitInfo) => { void c.seq; void c.nodes[0].ms })
hook.dispose()
const hookInferred = new Runtime().onCommit((c) => { const s: number = c.seq; void s }) // expect: the hook's param infers as CommitInfo
hookInferred.dispose()

// ── negatives: every marked line must FAIL to compile ────────────────────────
// @ts-expect-error — seq is read-only from outside: the kernel advances it
runtime().seq = 5
// @ts-expect-error — onCommit's hook receives a CommitInfo, not a number
runtime().onCommit((c: number) => { void c })
// @ts-expect-error — the kernel's write protocol is NOT shipped (register / written / queueWrite …)
runtime().register(n)
// @ts-expect-error — inspect requires its target
inspect()
// @ts-expect-error — trace's second argument is the traced FUNCTION
trace(d, 'not a fn')
// @ts-expect-error — profile requires the fn too
profile(d)
// @ts-expect-error — cascades' fn takes no arguments
cascades(d, (x: number) => { void x })
// @ts-expect-error — InspectInfo is readonly
info.id = 2
// @ts-expect-error — kind is the three-way union, not one of its members
const badKind: 'source' = info.kind
// @ts-expect-error — GraphInfo.nodes is readonly
g.nodes.push(gn)
// @ts-expect-error — mountPanel's open flag is a boolean
mountPanel({ open: 'yes' })
// @ts-expect-error — highlight returns the RESTORE fn (void), not a value
const badRestore: number = highlight(d)()
// @ts-expect-error — $.devtools is browser-only: possibly undefined without ?.
$.devtools.panel.open()
// @ts-expect-error — rowElements is NOT attached to $ (only the seven helpers are)
$.rowElements(d)
// @ts-expect-error — Cascade.nodes is readonly
cs[0].nodes.push(cn)
// @ts-expect-error — $.inspect keeps the named export's arity
$.inspect()

void n; void n2; void kind; void parents; void val; void gk; void edge; void target; void seq
void origin; void stat; void label; void corigin; void els; void same; void shell; void viaDollar
void gg; void tt; void pp; void cc; void ll; void rr; void facade; void sh; void still
void badKind; void badRestore; void rtSeq; void rtGraph
