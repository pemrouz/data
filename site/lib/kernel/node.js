// kernel/node.ts — graph nodes: the DataNode base and SourceNode.
//
// A node is simultaneously a consumer of parent batches and a producer of its
// own (the v2 Operator-extends-Value fusion, split: nodes have exactly one
// role surface — ingest/settle — and mutation entry points exist ONLY on
// SourceNode). References are strong and flow downward: parents hold
// children; scopes hold nodes. Delivery is deterministic.

             
                                                               
                             
import { Store } from './store.js'
import { Scope, currentScope } from './scope.js'
                                           

                                 
                              
                                                                                    
                                    
                                                                            
                                                                            
                                                                           
                                                                          
                                                                          
                                                                           
                                                                        
                                                               
                  
                
 

                                     
                 
 

let nextNodeId = 1

export          class DataNode      {
           id        
           kind                                  
           opName        
           runtime         
           parents                          
           height        
  // children/effects are arrays, not Sets: fan-out is small, iteration is the
  // per-commit hot path (no iterator allocation), and removal is rare (dispose).
           children                  = []
           effects                     = []
           scope              
  disposed = false

  // per-commit input slots (runtime-managed): in0/inFrom0 cover the
  // single-parent common case with zero allocation; inMore is the rare
  // multi-parent overflow. settledSeq: +seq = settled this commit; -seq =
  // enqueued this commit; 0 = untouched (seq starts at 1).
  in0                          = null
  inFrom0                       = null
  inMore                                                            = null
  settledSeq = 0

  constructor(runtime         , kind                       , opName        , parents                          ) {
    this.id = nextNodeId++
    this.kind = kind
    this.opName = opName
    this.runtime = runtime
    this.parents = parents
    let h = 0
    for (const p of parents) {
      if (p.height + 1 > h) h = p.height + 1
      p.children.push(this)
    }
    this.height = h
    this.scope = currentScope()
    this.scope?.add(this)
    runtime.register(this)
  }

  // Accumulate one parent's batch for this commit (runtime calls this).
  ingest(from               , batch                  )       {
    if (this.in0 === null) {
      this.in0 = batch
      this.inFrom0 = from
    } else {
      ;(this.inMore ??= []).push({ from, batch })
    }
  }

  clearInputs()       {
    this.in0 = null
    this.inFrom0 = null
    if (this.inMore !== null) this.inMore.length = 0
  }

  // Produce this node's output batch for the commit; null = nothing changed.
                                                                            

  // Materialized collection state (scalar nodes throw; see ScalarNode).
                                       
  // Current order, if this node is ordered (null otherwise).
  currentOrder()                           {
    return null
  }

  // Read-only full row pass — the NO-COPY counterpart of snapshot() for
  // one-pass consumers (construction-time seeding, settle-time rebuilds).
  // A callback visitor rather than an iterator: V8 inlines the callback and
  // elides all iterator machinery, ~5× faster than copy-then-iterate at 10k
  // rows (and generators are barely better than the copy). The base
  // delegates to snapshot(), which is midBatch-correct for every node;
  // materialized nodes override with a direct view pass behind the same
  // midBatch fallback, and SourceNode iterates its store (current even
  // mid-batch). Contract: do NOT mutate this node inside fn.
  each(fn                                 )       {
    for (const [k, v] of this.snapshot()) fn(k, v)
  }

  // Live row count — O(1) on nodes with a materialized view or store,
  // snapshot().size (O(N)) as the universal fallback.
  rowCount()         {
    return this.snapshot().size
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
  hasRow(key        )          {
    return this.snapshot().has(key)
  }

  rowAt(key        )                  {
    return this.snapshot().get(key)
  }

  connect(entry                  )                     {
    entry.bornSeq = this.runtime.connectSeq()
    this.effects.push(entry)
    const self = this
    const handle                     = {
      dispose() {
        entry.dead = true // tombstone: a snapshot iteration mid-phase must skip it
        const i = self.effects.indexOf(entry)
        if (i >= 0) self.effects.splice(i, 1)
      },
    }
    currentScope()?.add(handle                                  )
    return handle
  }

  dispose()       {
    if (this.disposed) return
    this.disposed = true
    for (const p of this.parents) {
      const i = p.children.indexOf(this)
      if (i >= 0) p.children.splice(i, 1)
    }
    this.children.length = 0
    for (const e of this.effects) e.dead = true // see connect() — snapshot iterations
    this.effects.length = 0
    this.scope?.delete(this)
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

// Clause-7 wrapper for every public snapshot-then-connect site (api sink()/
// connect(), connectPath, connectRecords, wireSink). Outside a batch the
// attach runs immediately (identity). Inside an open batch() the WHOLE attach
// — init snapshot + connect — defers to the batch's own commit (after settle,
// before effects; Runtime.attachWhenSettled), so init reflects the settled
// post-commit state and the batch's own deltas are not redelivered. The
// returned handle is live immediately: dispose() before the deferred attach
// cancels it; after, it forwards. The ambient scope is captured at CALL time
// (the deferred connect may run outside the caller's scope frame).
export function attachSettled(runtime         , attach                          )                     {
  if (!runtime.midBatch) return attach()
  let inner                            = null
  let dead = false
  runtime.attachWhenSettled(() => {
    if (!dead) inner = attach()
  })
  const handle                     = {
    dispose() {
      dead = true
      if (inner) inner.dispose()
    },
  }
  currentScope()?.add(handle                                  )
  return handle
}

function shallowCopy(v     )      {
  return Array.isArray(v) ? v.slice() : { ...v }
}

// Height re-propagation after a REPARENT (today: only MirrorNode.set). A
// node's height must exceed every parent's or the flush agenda settles it
// BEFORE its input arrives: the repro is a mirror repointed at a TALLER view
// while a descendant built pre-repoint keeps its construction-time height —
// one source write then reaches the descendant along two paths, the
// descendant settles first against the mirror's stale materialized view, and
// the mirror's late batch lingers un-folded until the next re-settling
// commit (the library-v3 PROBE A staleness; STATUS gap 5). Heights only ever
// GROW: recompute from parents, and push increases through descendants.
export function reheight(n               )       {
  let h = 0
  for (const p of n.parents) if (p.height + 1 > h) h = p.height + 1
  if (h <= n.height) return
  ;(n                      ).height = h
  for (const c of n.children) reheight(c)
}

export function leafAt(v         , path      )          {
  let cur      = v
  for (const p of path) {
    if (cur == null) return undefined
    cur = cur[p]
  }
  return cur
}

// Copy-on-write field DELETION along the path (W3a). Returns the new root
// with the leaf property removed (structural sharing off-path, like
// pathCopy), or null when the deletion is a NO-OP: any ancestor is
// missing/null/non-object, or the leaf property is not owned. The null
// return is the idempotence law (SCHEDULE clause 10) — a replicated remove
// redelivered or reordered must never throw or write. Deleting an ARRAY
// element is refused loudly: `delete arr[i]` mints a sparse hole (the exact
// value-domain shape v3 version-broke) — the caller writes a spliced array
// instead.
export function pathDelete   (row   , path      )           {
  let probe      = row
  for (let i = 0; i < path.length - 1; i++) {
    if (probe === null || typeof probe !== 'object') return null
    probe = probe[path[i]]
  }
  const last = path[path.length - 1]
  if (probe === null || typeof probe !== 'object' || !Object.hasOwn(probe, last)) return null
  // The array refusal outranks the undefined-leaf no-op below: an OWNED array
  // slot holding explicit `undefined` still throws (clause 10a is a blanket —
  // only an un-owned/out-of-range index is the 10b absent-target no-op).
  if (Array.isArray(probe))
    throw new Error(
      `data: remove() of array element [${path.join('.')}] would leave a sparse hole — write the spliced array instead`,
    )
  // An owned-but-undefined leaf deletes as a no-op: at the deep-write layer
  // leaf-absent ≡ leaf-undefined (the same equivalence the Object.is no-op
  // drop applies to writes), and emitting the delete would be a phantom
  // update under clause 8 (leaf unchanged: undefined → undefined).
  if (probe[last] === undefined) return null
  const root = shallowCopy(row)
  let src      = row
  let dst      = root
  for (let i = 0; i < path.length - 1; i++) {
    const p = path[i]
    const next = shallowCopy(src[p])
    dst[p] = next
    src = src[p]
    dst = next
  }
  delete dst[last]
  return root
}

// Copy-on-write along the written path. Returns the new root; prev is the
// untouched old root (structural sharing everywhere off-path) — oldValue for
// free, zero clones.
export function pathCopy   (row   , path      , value         )    {
  if (path.length === 0) return value     
  const root = shallowCopy(row)
  let src      = row
  let dst      = root
  for (let i = 0; i < path.length - 1; i++) {
    const p = path[i]
    // Vivify ANY non-object intermediate to a clean {} (clause 10c): spreading
    // a scalar happens to be {} for numbers/booleans, but a STRING spreads its
    // index characters into the vivified object ({'0':'a','1':'b',...}) — junk
    // that would replicate to every peer.
    const cur = src == null ? undefined : src[p]
    const next = cur === null || typeof cur !== 'object' ? {} : shallowCopy(cur)
    dst[p] = next
    src = cur
    dst = next
  }
  dst[path[path.length - 1]] = value
  return root
}

// Minimal order-delta script for a source batch (sources insert/remove but
// never reorder survivors): removes at descending pre-batch indices (each
// index is valid at application time), then inserts at ascending final
// indices. TODO(M2): OrderedView emits real orderMove for rank rotations.
// Legal order script pre → post (SCHEDULE clause 8): removes at DESCENDING
// pre indices, then orderMove per SURVIVING key whose relative rank rotated
// (against the survivor array — each move valid at application time), then
// inserts at ASCENDING final indices. The rotation pass was inert until
// SourceNode.move() existed (insert/remove splices never rotate survivors),
// so pre-move consumers see byte-identical scripts.
export function diffOrder(pre                   , post                   )               {
  const postSet = new Set(post)
  const preSet = new Set(pre)
  const out               = []
  for (let i = pre.length - 1; i >= 0; i--) {
    if (!postSet.has(pre[i])) out.push({ op: 'orderRemove', key: pre[i], index: i })
  }
  const cur           = []
  for (const k of pre) if (postSet.has(k)) cur.push(k)
  const surv           = []
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

// ── SourceNode ───────────────────────────────────────────────────────────────
//
// The ONLY node with mutation entry points. Writes apply to the store
// immediately (read-your-writes); consolidated deltas accumulate per commit;
// no-op writes are dropped centrally at the single chokepoint.

export class SourceNode    extends DataNode    {
                         
                           // array-born (has an order channel)
  // The order channel. On an array-born source it starts VIRTUAL (null while
  // `ordered`): while the store is in the ident lane and only tail appends
  // have happened, the order IS the identity 0..size-1 — nothing to
  // maintain, and settle synthesizes the tail orderInserts directly (key ≡
  // index). The first remove / move / mid-insert / order READ materializes
  // it via ensureOrder(), after which it is maintained exactly as before.
                                
                                           
                                        
                           // runtime dirty-list membership flag

  constructor(runtime         , value                         , name = 'source') {
    super(runtime, 'source', name, [])
    this.pending = new Map()
    this.preBatchOrder = null
    this.inDirty = false
    if (Array.isArray(value)) {
      // Adopt the caller's array as the slots (M6 P3): key i ≡ slot i, no
      // per-row mintKey/Map.set loop — a 231k-row ingest is O(1). Same
      // take-ownership contract as the object lane.
      this.ordered = true
      this.order = null // virtual identity order
      this.store = Store.adoptArray(value)
    } else {
      // Adopt the caller's object as the row table (M6 P2): O(Object.keys)
      // ingestion, no per-row Map.set loop. Take-ownership contract — out-of-
      // band mutation of the adopted object was already unsupported (v2's
      // proxy wrote through to it the same way).
      this.ordered = false
      this.order = null
      this.store = Store.adoptObject(value)
    }
  }

  // Materialize the virtual identity order. Called by the first
  // order-perturbing write of a batch (BEFORE its store mutation — the
  // reconstruction below relies on pending still holding every append of
  // this batch) and by order reads. Appends that happened earlier in the
  // SAME batch while virtual were never snapshotted, so the pre-batch order
  // is reconstructed by peeling them off the identity tail — they are
  // exactly the pending 'add' entries (removes materialize, so no
  // annihilation can have consumed one).
          ensureOrder()       {
    if (!this.ordered || this.order !== null) return
    const len = this.store.slots.length
    const order = new Array        (len)
    for (let i = 0; i < len; i++) order[i] = i
    this.order = order
    if (this.preBatchOrder === null) {
      let adds = 0
      for (const d of this.pending.values()) if (d.op === 'add') adds++
      if (adds > 0) this.preBatchOrder = order.slice(0, len - adds)
    }
  }

  currentOrder()                           {
    if (!this.ordered) return null
    if (this.order === null) this.ensureOrder()
    return this.order
  }

  snapshot()                 {
    return this.store.snapshot()
  }

  // The store applies writes inline (read-your-writes), so these are current
  // even mid-batch — no midBatch fallback needed.
  each(fn                               )       {
    this.store.each(fn)
  }

  rowCount()         {
    return this.store.size
  }

  get(key        )                {
    return this.store.get(key)
  }

  // The store applies writes inline (read-your-writes), so it is current
  // even mid-batch — no midBatch branch needed.
  hasRow(key        )          {
    return this.store.has(key)
  }

  rowAt(key        )                {
    return this.store.get(key)
  }

  // ── mutation entry points (the runtime write protocol) ────────────────────
  // Hot path allocates no closures: canWriteNow() → inline apply → written().
  // The rare re-entrant path (a write inside an effect) queues a thunk.

  // Write at key(+path). Missing key with empty path = add; missing key with
  // a path is an error (no implicit row creation through a deep write).
  write(key        , path      , value         , at         )       {
    const rt = this.runtime
    if (!rt.canWriteNow()) {
      rt.queueWrite(() => this.write(key, path, value, at))
      return
    }
    // Mode branch keeps the packed lane at ONE probe (slotOf) and the
    // adopted lane at a guarded hasOwn — a live-key overwrite never
    // promotes; only the add path below (a structural write) does.
    const st = this.store
    let prev   
    let slot = -1
    if (st.obj !== null) {
      if (typeof key !== 'string' || !Object.hasOwn(st.obj, key)) {
        this.writeAdd(key, path, value, at)
        return
      }
      prev = st.obj[key]
    } else {
      const s = st.slotOf(key)
      if (s === undefined) {
        this.writeAdd(key, path, value, at)
        return
      }
      slot = s
      prev = st.rowAt(s)
    }
    const before = leafAt(prev, path)
    if (Object.is(before, value)) return // no-phantom-events, enforced once
    const next = pathCopy(prev, path, value)
    if (slot >= 0) st.writeSlot(slot, next)
    else (st.obj                     )[key          ] = next
    this.recordUpdate(key, next, prev, path)
    rt.written(this)
  }

  // The write() miss path: a missing key with an empty path is an add; a
  // missing key with a path is an error (no implicit row creation through a
  // deep write).
          writeAdd(key        , path      , value         , at         )       {
    if (path.length > 0)
      throw new Error(`data: deep write at [${String(key)}.${path.join('.')}] — key ${String(key)} is not live`)
    this.applyAdd(key, value     , at)
    this.runtime.written(this)
  }

  insert(row   , at         )         {
    const rt = this.runtime
    if (!rt.canWriteNow()) {
      rt.queueWrite(() => void this.insert(row, at))
      return -1
    }
    const key = this.ordered ? this.store.mintKey() : this.autoObjectKey()
    this.applyAdd(key, row, at)
    rt.written(this)
    return key
  }

  // Remove a row (no path) or DELETE a nested field (path present — W3a).
  // Both directions are idempotent by law (SCHEDULE clause 10): a non-live
  // key, an absent ancestor, or an un-owned leaf is a silent no-op — fero's
  // at-least-once redelivery and cross-origin reordering land here freely.
  remove(key        , path       )       {
    const rt = this.runtime
    if (!rt.canWriteNow()) {
      rt.queueWrite(() => this.remove(key, path))
      return
    }
    if (!this.store.has(key)) return
    if (path !== undefined && path.length > 0) {
      const st = this.store
      const prev = st.get(key)     
      const next = pathDelete(prev, path)
      if (next === null) return // absent ancestor/leaf — idempotent no-op
      const slot = st.obj !== null ? -1 : st.slotOf(key) 
      if (slot >= 0) st.writeSlot(slot, next)
      else (st.obj                     )[key          ] = next
      this.recordUpdate(key, next, prev, path, true)
      rt.written(this)
      return
    }
    this.applyRemove(key)
    rt.written(this)
  }

  // Reposition a live key in the order channel — array-born sources only
  // (object-born sources are unordered; there is no position to move). No
  // row delta is recorded: the change is purely positional, and settle's
  // diffOrder(preBatchOrder, order) synthesizes the legal orderMove. This is
  // the ingress for the seam's 'move' wire records (previously deferred).
  move(key        , to        )       {
    const rt = this.runtime
    if (!rt.canWriteNow()) {
      rt.queueWrite(() => this.move(key, to))
      return
    }
    if (!this.ordered)
      throw new Error(
        'data: move() repositions the order channel — this source is object-born (unordered); moves only apply to array-born sources',
      )
    if (!this.store.has(key)) return // idempotent, like remove
    this.ensureOrder()
    const order = this.order            
    const from = order.indexOf(key)
    if (from < 0) return
    const t = to < 0 ? 0 : to >= order.length ? order.length - 1 : to
    if (from === t) return
    this.snapPreOrder()
    order.splice(from, 1)
    order.splice(t, 0, key)
    rt.written(this)
  }

  // W11: finish the deferred adoption bookkeeping NOW, off the serving path.
  // $() adopts containers (M6) and defers keySlot/slots (object lane) or the
  // key/order materialization (ident array lane) to the FIRST structural
  // write — a <5ms-at-10k spike that lands on the first inbound remove after
  // a replica seeds from replay, i.e. exactly on the serving path. A
  // seed-then-serve flow calls promote() at boot instead. Idempotent; a
  // never-promoted source keeps the adoption fast paths.
  promote()       {
    this.store.promote()
    this.store.materializeKeys()
    if (this.ordered) this.ensureOrder()
  }

          autoObjectKey()         {
    let n = this.store.size
    while (this.store.has(String(n))) n++
    return String(n)
  }

  // ── consolidation (delta.ts rules, implemented once) ───────────────────────

          applyAdd(key        , row   , at         )       {
    // Virtual-order fast path: a tail append of the identity key onto an
    // ident store keeps both the key channel AND the order channel virtual —
    // settle synthesizes the orderInsert (key ≡ index). Anything else (a
    // mid-insert, a non-identity key, an already-materialized order)
    // materializes the order BEFORE the store mutation so the pre-batch
    // reconstruction in ensureOrder sees the pre-add length.
    let virtualAppend = false
    if (this.ordered) {
      const st = this.store
      const len = st.slots.length
      virtualAppend =
        this.order === null && st.ident && key === len && (at === undefined || at < 0 || at >= len)
      if (!virtualAppend && this.order === null) this.ensureOrder()
    }
    this.store.set(key, row)
    const prior = this.pending.get(key)
    if (prior === undefined) {
      this.pending.set(key, { op: 'add', key, row })
    } else if (prior.op === 'remove') {
      // remove + add within one batch = update (the key was live pre-batch)
      this.pending.set(key, { op: 'update', key, row, prev: prior.prev, path: [] })
    } else {
      throw new Error(`data: add for already-live key ${String(key)}`)
    }
    if (this.ordered && !virtualAppend) {
      const order = this.order            
      this.snapPreOrder()
      const i = at === undefined || at < 0 || at > order.length ? order.length : at
      order.splice(i, 0, key)
    }
  }

          applyRemove(key        )       {
    if (this.ordered && this.order === null) this.ensureOrder() // before the pending annihilation below
    const prev = this.store.del(key)     
    const prior = this.pending.get(key)
    if (prior === undefined) {
      this.pending.set(key, { op: 'remove', key, prev })
    } else if (prior.op === 'add') {
      this.pending.delete(key) // add + remove annihilate
    } else if (prior.op === 'update') {
      this.pending.set(key, { op: 'remove', key, prev: prior.prev })
    } else {
      throw new Error(`data: remove for non-live key ${String(key)}`)
    }
    if (this.order !== null) {
      this.snapPreOrder()
      const i = this.order.indexOf(key) // TODO(M2): OrderIndex rank map
      if (i >= 0) this.order.splice(i, 1)
    }
  }

          recordUpdate(key        , row   , prev   , path      , deleted          )       {
    const prior = this.pending.get(key)
    if (prior === undefined) {
      this.pending.set(
        key,
        deleted === true
          ? { op: 'update', key, row, prev, path, deleted: true }
          : { op: 'update', key, row, prev, path },
      )
    } else if (prior.op === 'add') {
      this.pending.set(key, { op: 'add', key, row })
    } else if (prior.op === 'update') {
      const samePath =
        prior.path.length === path.length && prior.path.every((p, i) => p === path[i])
      if (samePath && Object.is(leafAt(prior.prev, path), leafAt(row, path))) {
        // The batch's net effect at this leaf is zero (e.g. a flip A→B→A, or
        // set-then-delete of a field the row never owned): annihilate —
        // emitting it would be a phantom update (clause 8). Same-path merges
        // structurally share every other field with prev, so a leaf-equal
        // merge means the whole row is content-identical. (Clause 10 corner:
        // an explicit-undefined leaf deleted in the same batch that set it
        // annihilates too — at the deep-write layer leaf-absent ≡
        // leaf-undefined, the documented value-domain equivalence.)
        this.pending.delete(key)
        return
      }
      // Merged shape: same path keeps the path (and the LAST op's deletion
      // marker — set-then-delete stays a delete, delete-then-set a write);
      // diverged paths collapse to a whole-row update, where the flag is
      // meaningless (the full row already carries the truth).
      this.pending.set(
        key,
        samePath && deleted === true
          ? { op: 'update', key, row, prev: prior.prev, path, deleted: true }
          : { op: 'update', key, row, prev: prior.prev, path: samePath ? path : [] },
      )
    }
  }

          snapPreOrder()       {
    if (this.preBatchOrder === null && this.order !== null) this.preBatchOrder = this.order.slice()
  }

  settle(seq        , origin             )                        {
    if (this.pending.size === 0 && this.preBatchOrder === null) return null
    // Fast path for the batch-of-one (single-row commits dominate real ticks).
    let rows               
    if (this.pending.size === 1) {
      rows = [this.pending.values().next().value               ]
      this.pending.clear()
    } else {
      rows = [...this.pending.values()]
      this.pending = new Map()
    }
    let order                          
    if (this.preBatchOrder !== null) {
      order = diffOrder(this.preBatchOrder, this.order )
      this.preBatchOrder = null
      if (order.length === 0) order = undefined
    } else if (this.ordered && this.order === null) {
      // Virtual order (M6 P3): every structural change this batch was a tail
      // append of an identity key (anything else would have materialized),
      // so the order delta is one orderInsert per add at index ≡ key —
      // ascending, matching diffOrder's insert convention, because pending
      // preserves write order and later appends mint larger keys.
      for (const d of rows) {
        if (d.op === 'add') (order ??= []).push({ op: 'orderInsert', key: d.key, index: d.key           })
      }
    }
    if (rows.length === 0 && order === undefined) return null
    // One monomorphic batch shape (order/scalar always present as fields).
    return { seq, origin, rows, order, scalar: undefined }
  }
}
