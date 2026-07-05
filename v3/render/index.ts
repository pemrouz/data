// v3/render — the KEYED render layer (plan §3.4, M4).
//
// What this module is:
// - a minimal ORDERED-CHILDREN element AST (el/text/rtext/list) — the ordered
//   children list kills the v2 single-static-slot trap: `el('span', null,
//   '# ', text(cur))` renders "# general", in order, because a static string
//   is just another child, not a last-wins slot on the node.
// - render(hostEl, ast) → RenderHandle: one Scope per mount; disposing the
//   handle tears every subscription/listener/row-scope down synchronously.
// - THE CENTERPIECE: the keyed list sink. A 'list' child bound to a
//   collection view maintains Map<RowKey, Element>. Per CommitBatch:
//     add    → build the row element (its own child Scope) and place it —
//              at its order position for ordered views (via the batch's
//              orderInsert), appended for unordered views
//     remove → element.remove() + dispose that row's Scope (listeners and
//              rtext subscriptions detach deterministically)
//     update → re-run ONLY the row's bindings: rowFn(newRow) is re-evaluated
//              and the row element's TEXT bindings are patched in place
//              (element identity preserved; per-binding surgical prop updates
//              come with the full builder DSL in M4.5)
//     orderMove → a REAL insertBefore of the EXISTING element — identity
//              (focus/selection/transitions) survives reorders by
//              construction; the v2 kanban/chat data-id workaround dies here.
// - mirror(view): the $(view)-swap replacement — a re-pointable view slot.
//   MirrorNode is an identity operator whose data parent can be swapped;
//   set(other) routes through a hidden control SourceNode (the between-bounds
//   pattern), so the swap is a REAL commit: one consolidated batch diffing
//   old vs new snapshot (removes, adds, updates only for keys whose row
//   reference changed) — downstream views and the DOM catch up surgically,
//   overlapping keys keep their elements.
// - raf(target): the coalescing writer — write(v) schedules ONE commit of the
//   latest value per animation frame (setTimeout(cb, 16) outside browsers);
//   flush() commits immediately and cancels the pending frame.
//
// Emission legality: MirrorNode emits per SCHEDULE.md clause 8 (≤1 delta per
// key; add only for not-live keys; no phantom updates — Object.is on the row
// reference; order script = removes at descending pre indices, then moves
// against the survivor array, then inserts at ascending final indices). Its
// tests wrap it in conform().
//
// M4.5 slice added for the crossfilter-v3 example (the first M5 migration):
// - SVG NAMESPACE: `el('svg', …)` switches to createElementNS and children
//   inherit the namespace (browser semantics), so charts are first-class.
// - REACTIVE PROPS: `bind(view, fn?)` as a prop value creates a per-binding
//   surgical attribute subscription — recompute on the view's commit, string-
//   normalized equality cutoff, setAttribute/removeAttribute only on real
//   change. A bare handle/node prop value auto-binds (fn = identity).
// - `text(view, fn?)` — rtext gained the optional format fn.
// - STRUCTURAL ROW REBUILD: patchRow now reports whether the row's shape
//   matched; on mismatch (child count / tag / kind changed — e.g. a group
//   bucket gaining a member) the list sink rebuilds that row in place (same
//   list position, old row scope disposed, fresh element). Shape-stable rows
//   keep element identity exactly as before.
//
// Deliberately still NOT here (rest of M4.5): the full HTML.*/SVG.* DSL, JSX,
// components, SSR targets. The AST shape is extensible (each kind is a tagged
// record) so those land as new kinds/props handling, not a rewrite.

import type {
  CommitBatch, OrderDelta, OriginToken, RowDelta, RowKey,
} from '../contract/delta.ts'
import { DataNode, SourceNode } from '../kernel/node.ts'
import type { SubscriptionHandle } from '../kernel/node.ts'
import type { Runtime } from '../kernel/runtime.ts'
import { Scope, currentScope, runInScope } from '../kernel/scope.ts'

// The versioned handle symbols (Symbol.for — shared with api/index.ts without
// importing it, so the render layer stays kernel-only and layering is clean).
const NODE = Symbol.for('data.v3.node')
const VALUE = Symbol.for('data.v3.value')

// ── the AST ──────────────────────────────────────────────────────────────────

export interface ElNode {
  readonly kind: 'el'
  readonly tag: string
  readonly props: Readonly<Record<string, unknown>> | null
  readonly children: readonly VNode[]
}
export interface TextNode {
  readonly kind: 'text'
  readonly s: string
}
export interface RTextNode {
  readonly kind: 'rtext'
  readonly view: unknown // scalar view (DataNode with value()) or a handle
  readonly fn: ((v: any) => unknown) | null // optional format fn over the read
}
export interface ListNode {
  readonly kind: 'list'
  readonly view: unknown // collection view: DataNode or handle
  readonly rowFn: (row: any, key: RowKey) => VNode
}
export type VNode = ElNode | TextNode | RTextNode | ListNode

// A reactive PROP value: `el('path', { d: bind(view, fn) })` — subscribes to
// the view, recomputes fn(read()) per commit, writes the attribute only when
// the normalized string actually changed. A bare handle prop value auto-binds.
export interface BindProp {
  readonly kind: 'bind'
  readonly view: unknown
  readonly fn: ((v: any) => unknown) | null
}
export function bind(view: unknown, fn?: (v: any) => unknown): BindProp {
  return { kind: 'bind', view, fn: fn ?? null }
}

export type Child = VNode | string | number | boolean | null | undefined

export function el(
  tag: string,
  props?: Record<string, unknown> | null,
  ...children: Child[]
): ElNode {
  const kids: VNode[] = []
  for (const c of children) {
    if (c == null || c === false || c === true) continue
    if (typeof c === 'string' || typeof c === 'number') kids.push({ kind: 'text', s: String(c) })
    else kids.push(c)
  }
  return { kind: 'el', tag, props: props ?? null, children: kids }
}

export function text(view: unknown, fn?: (v: any) => unknown): RTextNode {
  return { kind: 'rtext', view, fn: fn ?? null }
}

export function list(view: unknown, rowFn: (row: any, key: RowKey) => VNode): ListNode {
  return { kind: 'list', view, rowFn }
}

// ── view unwrapping ──────────────────────────────────────────────────────────

function nodeOf(view: any): DataNode<any> {
  if (view instanceof DataNode) return view
  const n = view?.[NODE]
  if (n instanceof DataNode) return n
  throw new Error('data/render: expected a view — a DataNode or a $ handle')
}

// A read thunk for text bindings: scalar nodes read value(); handles read
// [value] (works for child-path handles too — the subscription is on the
// owning node, and the string-equality cut-off below suppresses no-op writes).
function readerOf(view: any): () => unknown {
  if (view instanceof DataNode) {
    if (view.kind === 'scalar') return () => (view as any).value()
    throw new Error(
      'data/render: text() over a raw collection node — pass a scalar view (sum/avg/…/to) or a handle',
    )
  }
  if (view != null && view[NODE] instanceof DataNode) return () => view[VALUE]
  throw new Error('data/render: text() expects a scalar view or a $ handle')
}

function toText(v: unknown): string {
  return v == null ? '' : String(v)
}

// ── reactive attribute binding ───────────────────────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg'

function isBindProp(x: unknown): x is BindProp {
  return x !== null && typeof x === 'object' && (x as any).kind === 'bind' && 'view' in (x as any)
}

function isView(x: unknown): boolean {
  if (x instanceof DataNode) return true
  return x !== null && typeof x === 'object' && (x as any)[NODE] instanceof DataNode
}

// Attribute value normalization: null/undefined/false remove the attribute,
// true sets the empty attribute, everything else stringifies.
function normAttr(v: unknown): string | null {
  return v == null || v === false ? null : v === true ? '' : String(v)
}

function bindAttr(
  dom: any,
  name: string,
  view: unknown,
  fn: ((v: any) => unknown) | null,
  scope: Scope,
): void {
  const read = readerOf(view)
  const compute = () => normAttr(fn === null ? read() : fn(read()))
  let last = compute()
  if (last !== null) dom.setAttribute(name, last)
  const sub = nodeOf(view).connect({
    wantsOrder: false,
    origin: null,
    apply() {
      const next = compute()
      if (next === last) return // normalized-string cutoff — no redundant DOM writes
      last = next
      if (next === null) dom.removeAttribute(name)
      else dom.setAttribute(name, next)
    },
  })
  scope.add(sub)
}

// ── materialization ──────────────────────────────────────────────────────────

interface Ctx {
  readonly doc: any
  readonly scope: Scope
  readonly ns: string | null // element namespace — children inherit (SVG)
}

interface Mounted {
  vnode: VNode
  dom: any
  children: Mounted[] | null
}

function materialize(v: VNode, ctx: Ctx): Mounted {
  switch (v.kind) {
    case 'text':
      return { vnode: v, dom: ctx.doc.createTextNode(v.s), children: null }
    case 'rtext': {
      const n = nodeOf(v.view)
      const raw = readerOf(v.view)
      const fmt = v.fn
      const read = fmt === null ? raw : () => fmt(raw())
      const tn = ctx.doc.createTextNode(toText(read()))
      const sub = n.connect({
        wantsOrder: false,
        origin: null,
        apply() {
          const s = toText(read())
          if (s !== tn.textContent) tn.textContent = s
        },
      })
      ctx.scope.add(sub) // idempotent if the ambient scope already caught it
      return { vnode: v, dom: tn, children: null }
    }
    case 'el': {
      // Namespace: <svg> switches to the SVG namespace; children inherit.
      const ns = v.tag === 'svg' ? SVG_NS : ctx.ns
      const dom = ns === null ? ctx.doc.createElement(v.tag) : ctx.doc.createElementNS(ns, v.tag)
      const kidCtx = ns === ctx.ns ? ctx : { doc: ctx.doc, scope: ctx.scope, ns }
      if (v.props !== null) {
        for (const k of Object.keys(v.props)) {
          const pv = v.props[k]
          if (k.startsWith('on') && typeof pv === 'function') {
            const evt = k.slice(2).toLowerCase()
            dom.addEventListener(evt, pv)
            ctx.scope.onDispose(() => dom.removeEventListener(evt, pv))
          } else if (isView(pv)) {
            // checked BEFORE isBindProp: probing .kind on a handle would
            // route through its proxy (a scalar handle throws on child reads)
            bindAttr(dom, k, pv, null, ctx.scope)
          } else if (isBindProp(pv)) {
            bindAttr(dom, k, pv.view, pv.fn, ctx.scope)
          } else if (pv != null && pv !== false) {
            dom.setAttribute(k, pv === true ? '' : String(pv))
          }
        }
      }
      const kids: Mounted[] = []
      for (const c of v.children) {
        if (c.kind === 'list') {
          const binding = new ListBinding(dom, c, kidCtx)
          ctx.scope.add(binding)
          kids.push({ vnode: c, dom: binding.anchor, children: null })
        } else {
          const m = materialize(c, kidCtx)
          dom.appendChild(m.dom)
          kids.push(m)
        }
      }
      return { vnode: v, dom, children: kids }
    }
    case 'list':
      // handled by the 'el' branch and by render() at the root
      throw new Error('data/render: internal — list must be materialized by its host')
  }
}

// Row-update patching: re-run ONLY the row's text bindings against the fresh
// rowFn output. rtext and nested lists are self-updating (their own
// subscriptions) and are left untouched. Returns whether the shapes matched;
// a structural mismatch (kind / tag / child count changed — a rowFn whose
// SHAPE depends on the row, e.g. a group bucket gaining a member) reports
// false and the list sink REBUILDS that row in place. Static props are set
// once at build; a prop that must track the row reactively should be a
// bind()/handle prop (self-updating) or the row shape should change (rebuild).
function patchRow(m: Mounted, v: VNode): boolean {
  if (m.vnode.kind !== v.kind) return false
  if (v.kind === 'text') {
    if ((m.vnode as TextNode).s !== v.s) m.dom.textContent = v.s
    m.vnode = v
    return true
  }
  if (v.kind === 'el') {
    const prev = m.vnode as ElNode
    if (prev.tag !== v.tag) return false
    const next = v.children
    if (m.children === null || m.children.length !== next.length) return false
    for (let i = 0; i < next.length; i++) {
      if (!patchRow(m.children[i], next[i])) return false
    }
    m.vnode = v
    return true
  }
  return true // rtext / list: self-updating
}

// ── the keyed list sink ──────────────────────────────────────────────────────

interface RowRec {
  key: RowKey
  el: any
  scope: Scope
  mounted: Mounted
}

class ListBinding {
  declare host: any
  declare doc: any
  declare ns: string | null // inherited element namespace for row builds
  declare anchor: any // marker before which every row element is placed
  declare view: DataNode<any>
  declare rowFn: (row: any, key: RowKey) => VNode
  declare recs: Map<RowKey, RowRec>
  declare order: RowKey[] | null // mirror of the view's order channel
  declare sub: SubscriptionHandle
  declare disposed: boolean

  constructor(host: any, vnode: ListNode, ctx: Ctx) {
    this.host = host
    this.doc = ctx.doc
    this.ns = ctx.ns
    this.rowFn = vnode.rowFn
    this.view = nodeOf(vnode.view)
    this.recs = new Map()
    this.disposed = false
    this.anchor = ctx.doc.createTextNode('')
    host.appendChild(this.anchor)

    // snapshot-then-deltas (SCHEDULE clause 7): init from the settled state
    // (+ currentOrder when the view is ordered), then apply every commit.
    const snap = this.view.snapshot()
    const ord = this.view.currentOrder()
    this.order = ord === null ? null : ord.slice()
    const keys = ord ?? [...snap.keys()]
    for (const k of keys) {
      const rec = this.buildRow(k, snap.get(k))
      this.recs.set(k, rec)
      this.host.insertBefore(rec.el, this.anchor)
    }
    this.sub = this.view.connect({
      wantsOrder: true,
      origin: null,
      apply: (b: CommitBatch<any>) => this.apply(b),
    })
    ctx.scope.add(this.sub)
  }

  // Each row owns a child Scope: its rtext/bind subscriptions and listeners
  // are registered there and die with the row (removeEventListener, finally).
  private buildRow(key: RowKey, row: any): RowRec {
    return this.buildRowFrom(this.rowFn(row, key), key)
  }

  private buildRowFrom(vnode: VNode, key: RowKey): RowRec {
    const rowScope = new Scope(null)
    const mounted = runInScope(rowScope, () =>
      materialize(vnode, { doc: this.doc, scope: rowScope, ns: this.ns }),
    )
    return { key, el: mounted.dom, scope: rowScope, mounted }
  }

  apply(batch: CommitBatch<any>): void {
    if (this.disposed) return
    const placeLater: RowRec[] = []
    const ordered = this.order !== null || batch.order !== undefined

    // Row phase — membership + content.
    for (const d of batch.rows as readonly RowDelta<any>[]) {
      switch (d.op) {
        case 'add': {
          const rec = this.buildRow(d.key, d.row)
          this.recs.set(d.key, rec)
          if (ordered) placeLater.push(rec) // placed by its orderInsert below
          else this.host.insertBefore(rec.el, this.anchor)
          break
        }
        case 'remove': {
          const rec = this.recs.get(d.key)
          if (rec === undefined) break
          this.recs.delete(d.key)
          rec.scope.dispose()
          rec.el.remove()
          break
        }
        case 'update': {
          const rec = this.recs.get(d.key)
          if (rec === undefined) break
          const next = this.rowFn(d.row, d.key)
          if (!patchRow(rec.mounted, next)) {
            // Structural change — rebuild the row IN PLACE (same list
            // position); the old row's scope (listeners, bindings) disposes.
            const fresh = this.buildRowFrom(next, d.key)
            this.host.insertBefore(fresh.el, rec.el)
            rec.el.remove()
            rec.scope.dispose()
            this.recs.set(d.key, fresh)
          }
          break
        }
      }
    }

    // Order phase — applied AFTER row deltas, in array order (the contract).
    if (batch.order !== undefined) {
      if (this.order === null) this.order = [] // view reveals itself as ordered
      const ord = this.order
      for (const od of batch.order as readonly OrderDelta[]) {
        switch (od.op) {
          case 'orderRemove': {
            const i = ord[od.index] === od.key ? od.index : ord.indexOf(od.key)
            if (i >= 0) ord.splice(i, 1)
            break
          }
          case 'orderInsert': {
            const i = od.index < 0 ? 0 : od.index > ord.length ? ord.length : od.index
            ord.splice(i, 0, od.key)
            const rec = this.recs.get(od.key)
            if (rec !== undefined) this.host.insertBefore(rec.el, this.nextPlaced(i + 1))
            break
          }
          case 'orderMove': {
            const from =
              od.from !== undefined && ord[od.from] === od.key ? od.from : ord.indexOf(od.key)
            if (from < 0) break
            ord.splice(from, 1)
            const i = od.index < 0 ? 0 : od.index > ord.length ? ord.length : od.index
            ord.splice(i, 0, od.key)
            const rec = this.recs.get(od.key)
            // THE move: one real insertBefore of the EXISTING element.
            if (rec !== undefined) this.host.insertBefore(rec.el, this.nextPlaced(i + 1))
            break
          }
        }
      }
    }

    // Safety net: any added row the order channel didn't place (e.g. a mirror
    // that re-pointed from an ordered to an unordered parent) appends.
    for (const rec of placeLater) {
      if (rec.el.parentNode == null) this.host.insertBefore(rec.el, this.anchor)
    }
  }

  // First already-placed element at or after order position i (added-but-not-
  // yet-placed keys are skipped); the anchor closes the list.
  private nextPlaced(i: number): any {
    const ord = this.order!
    for (; i < ord.length; i++) {
      const rec = this.recs.get(ord[i])
      if (rec !== undefined && rec.el.parentNode != null) return rec.el
    }
    return this.anchor
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.sub.dispose()
    for (const rec of this.recs.values()) {
      rec.scope.dispose()
      rec.el.remove()
    }
    this.recs.clear()
    this.anchor.remove()
  }
}

// ── render ───────────────────────────────────────────────────────────────────

export interface RenderHandle {
  readonly scope: Scope
  dispose(): void
}

export function render(host: any, ast: VNode | readonly VNode[], _runtime?: Runtime): RenderHandle {
  const doc = (globalThis as any).document
  if (doc == null)
    throw new Error('data/render: no global document — a DOM (or the test mock) must be installed')
  const mount = new Scope(null) // one Scope per mount — owns everything below
  const tops: any[] = []
  const ctx: Ctx = { doc, scope: mount, ns: null }
  runInScope(mount, () => {
    const vs = Array.isArray(ast) ? (ast as readonly VNode[]) : [ast as VNode]
    for (const v of vs) {
      if (v.kind === 'list') {
        const binding = new ListBinding(host, v, ctx)
        mount.add(binding)
      } else {
        const m = materialize(v, ctx)
        host.appendChild(m.dom)
        tops.push(m.dom)
      }
    }
  })
  return {
    scope: mount,
    dispose() {
      mount.dispose() // subscriptions, listeners, row scopes, list bindings
      for (const t of tops) t.remove()
    },
  }
}

// ── mirror() — the re-pointable view slot (the v2 $(view)-swap, done right) ──

const MKEY = 'g'

export class MirrorNode<T> extends DataNode<T> {
  declare view: Map<RowKey, T> // materialized identity copy of the current parent
  declare order: RowKey[] | null
  declare ctl: SourceNode<number> // hidden repoint-generation input (between-bounds pattern)
  declare gen: number

  constructor(runtime: Runtime, parent: DataNode<T>, ctl: SourceNode<number>) {
    super(runtime, 'operator', 'mirror', [parent, ctl])
    this.ctl = ctl
    this.gen = 0
    this.view = parent.snapshot()
    const o = parent.currentOrder()
    this.order = o === null ? null : o.slice()
  }

  snapshot(): Map<RowKey, T> {
    if (this.runtime.midBatch) return this.parents[0].snapshot() as Map<RowKey, T>
    return new Map(this.view)
  }

  currentOrder(): readonly RowKey[] | null {
    if (this.runtime.midBatch) return this.parents[0].currentOrder()
    return this.order
  }

  current(): DataNode<T> {
    return this.parents[0] as DataNode<T>
  }

  // Re-point at another view. The swap re-parents this node (children/height
  // bookkeeping) and then writes the hidden control source, so the diff is
  // emitted as a REAL commit: it consolidates with data writes in the same
  // batch(), gets a seq, and inherits re-entrancy handling for free.
  set(next: any): void {
    const nextNode = nodeOf(next) as DataNode<T>
    const cur = this.parents[0]
    if (nextNode === cur) return
    if (nextNode.kind === 'scalar')
      throw new Error('data: mirror.set() expects a collection view, got a scalar node')
    // Cycle check: walking the new parent's ancestry must never reach this
    // mirror (a mirror pointed at a view derived from itself would loop).
    const stack: DataNode<any>[] = [nextNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n === this) throw new Error('data: mirror.set() would create a cyclic view')
      for (const p of n.parents) stack.push(p)
    }
    const i = cur.children.indexOf(this)
    if (i >= 0) cur.children.splice(i, 1)
    ;(this.parents as DataNode<any>[])[0] = nextNode
    nextNode.children.push(this)
    // Keep topological legality for future commits: height only ever grows.
    // (Nodes created downstream BEFORE a repoint keep their construction-time
    // height — a documented M4 limitation; see the module notes.)
    if (nextNode.height + 1 > this.height) (this as { height: number }).height = nextNode.height + 1
    this.ctl.write(MKEY, [], ++this.gen)
  }

  dispose(): void {
    super.dispose()
    this.ctl.dispose()
  }

  settle(seq: number, origin: OriginToken): CommitBatch<T> | null {
    let dataBatch: CommitBatch<T> | null = null
    let repoint = false
    if (this.in0 !== null) {
      if (this.inFrom0 === this.ctl) repoint = true
      else if (this.inFrom0 === this.parents[0]) dataBatch = this.in0 as CommitBatch<T>
    }
    if (this.inMore !== null) {
      for (const m of this.inMore) {
        if (m.from === this.ctl) repoint = true
        else if (m.from === this.parents[0]) dataBatch = m.batch as CommitBatch<T>
      }
    }
    if (repoint) return this.settleRepoint(seq, origin)
    if (dataBatch === null) return null

    // Identity forwarding: maintain the local copy, re-emit the parent's rows
    // and order deltas under this node's identity.
    for (const d of dataBatch.rows) {
      if (d.op === 'remove') this.view.delete(d.key)
      else this.view.set(d.key, d.row)
    }
    if (dataBatch.order !== undefined) {
      if (this.order === null) this.order = []
      applyOrderDeltas(this.order, dataBatch.order)
    }
    if (dataBatch.rows.length === 0 && dataBatch.order === undefined) return null
    return { seq, origin, rows: dataBatch.rows, order: dataBatch.order, scalar: undefined }
  }

  // The consolidated swap diff: old snapshot vs new snapshot — removes for
  // keys only in old, adds for keys only in new, updates ONLY for keys in
  // both whose row REFERENCE changed (Object.is — overlapping keys sharing a
  // row reference emit nothing, so downstream DOM keeps their elements).
  // A data batch from the new parent in the same commit is subsumed: the
  // parent has already settled (lower height), so its snapshot is current.
  private settleRepoint(seq: number, origin: OriginToken): CommitBatch<T> | null {
    const next = this.parents[0].snapshot() as Map<RowKey, T>
    const rows: RowDelta<T>[] = []
    for (const [k, v] of this.view) {
      if (!next.has(k)) rows.push({ op: 'remove', key: k, prev: v })
    }
    for (const [k, v] of next) {
      if (this.view.has(k)) {
        const old = this.view.get(k) as T
        if (!Object.is(old, v)) rows.push({ op: 'update', key: k, row: v, prev: old, path: [] })
      } else {
        rows.push({ op: 'add', key: k, row: v })
      }
    }
    const postO = this.parents[0].currentOrder()
    const postOrder = postO === null ? null : postO.slice()
    let order: OrderDelta[] | undefined
    if (this.order !== null || postOrder !== null) {
      order = orderScript(this.order ?? [], postOrder ?? [])
      if (order.length === 0) order = undefined
    }
    this.view = next
    this.order = postOrder
    if (rows.length === 0 && order === undefined) return null
    return { seq, origin, rows, order, scalar: undefined }
  }
}

function applyOrderDeltas(ord: RowKey[], deltas: readonly OrderDelta[]): void {
  for (const d of deltas) {
    if (d.op === 'orderInsert') ord.splice(d.index, 0, d.key)
    else if (d.op === 'orderRemove') ord.splice(d.index, 1)
    else {
      ord.splice(d.from as number, 1)
      ord.splice(d.index, 0, d.key)
    }
  }
}

// Legal order script pre → post (SCHEDULE clause 8): removes at DESCENDING
// pre indices (each valid at application time), orderMove per surviving key
// against the survivor array (the OrderedView reconcile algorithm), then
// inserts at ASCENDING final indices.
function orderScript(pre: readonly RowKey[], post: readonly RowKey[]): OrderDelta[] {
  const preSet = new Set(pre)
  const postSet = new Set(post)
  const out: OrderDelta[] = []
  for (let i = pre.length - 1; i >= 0; i--) {
    if (!postSet.has(pre[i])) out.push({ op: 'orderRemove', key: pre[i], index: i })
  }
  const cur: RowKey[] = []
  for (const k of pre) if (postSet.has(k)) cur.push(k)
  const surv: RowKey[] = []
  for (const k of post) if (preSet.has(k)) surv.push(k)
  for (let i = 0; i < surv.length; i++) {
    if (cur[i] === surv[i]) continue
    const j = cur.indexOf(surv[i], i)
    out.push({ op: 'orderMove', key: surv[i], index: i, from: j })
    cur.splice(j, 1)
    cur.splice(i, 0, surv[i])
  }
  for (let i = 0; i < post.length; i++) {
    if (!preSet.has(post[i])) out.push({ op: 'orderInsert', key: post[i], index: i })
  }
  return out
}

export function mirror<T>(initial: any): MirrorNode<T> {
  const parent = nodeOf(initial) as DataNode<T>
  if (parent.kind === 'scalar')
    throw new Error('data: mirror() expects a collection view, got a scalar node')
  const ctl = new SourceNode<number>(parent.runtime, { [MKEY]: 0 }, 'mirror:ctl')
  return new MirrorNode<T>(parent.runtime, parent, ctl)
}

// ── raf() — the coalescing writer ────────────────────────────────────────────

export interface RafWriter<V = unknown> {
  (v: V): void
  flush(): void
  cancel(): void
}

// target: a commit function `(v) => …` or anything with `.update(v)` (a $
// child handle). write(v) schedules ONE commit of the LATEST value per
// animation frame; flush() commits immediately (pointerup wants the final
// position without an extra frame's latency); cancel() drops the pending
// value. Outside a browser the frame is setTimeout(cb, 16).
export function raf<V>(target: ((v: V) => void) | { update(v: V): void }): RafWriter<V> {
  const commit: (v: V) => void =
    typeof target === 'function' ? target : (v: V) => target.update(v)
  let pending = false
  let latest: V
  let handle: any = null
  const g: any = globalThis
  const hasRaf = typeof g.requestAnimationFrame === 'function'
  const fire = () => {
    pending = false
    handle = null
    commit(latest)
  }
  const write = ((v: V) => {
    latest = v
    if (pending) return
    pending = true
    handle = hasRaf ? g.requestAnimationFrame(fire) : setTimeout(fire, 16)
  }) as RafWriter<V>
  write.cancel = () => {
    if (!pending) return
    pending = false
    if (hasRaf) g.cancelAnimationFrame(handle)
    else clearTimeout(handle)
    handle = null
  }
  write.flush = () => {
    if (!pending) return
    write.cancel()
    commit(latest)
  }
  currentScope()?.onDispose(() => write.cancel())
  return write
}
