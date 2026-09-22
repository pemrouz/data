// devtools — the CONSUMPTION layer over the kernel's two native
// observability primitives (plan §3.5): Runtime.graph() (the live registry
// projection) and Runtime.onCommit() (per-commit CommitInfo carrying per-node
// {id, deltas, ms} stats, measured only while a hook is subscribed). Nothing
// here adds engine hooks of its own — every helper is derivable from those
// two, disposable, and serializable.
//
// The v2 structurally-empty-profile defect (a profiler that could return no
// per-operator rows because instrumentation lived outside the commit loop) is
// impossible by construction here: profile() aggregates the kernel's OWN
// CommitInfo stats, which the runtime records for every settled node whenever
// any onCommit hook is live — so a traced write through a chain necessarily
// yields one row per operator that settled.
//
// highlight()/fromDOM() live in ./dom.ts (they need a DOM and the render
// layer's element↔node registry); the overlay panel lives in ./panel/ and the
// data/devtools entry (attach + auto-mount) in ./entry.ts.

import { Runtime } from '../kernel/runtime.js'
                                                                     
import { DataNode } from '../kernel/node.js'
import { materialize } from '../compat/v2-records.js'
import { runtime as defaultRuntime } from '../api/index.js'

// The public handle exposes its node under this registry symbol (api/index.ts
// exports it as `node`); Symbol.for makes resolution work across entries.
const NODE = Symbol.for('data.v4.node')

// Anything the helpers accept as "where is the graph": a Runtime, a raw
// DataNode, or a public handle (resolved via Symbol.for('data.v4.node')).
                                                                                

                              
                     
                                                 
                     
                         
                                     
                         
 

                            
                                    
                                 
 

                            
                                          
                                      
 

                             
                     
                     
                 
                
                 
 

                              
                     
                     
                                                               
                         
                     
 

                          
                                                                    
                         
                                        
 

// ── resolution ───────────────────────────────────────────────────────────────

export function resolveNode(handleOrNode         )                {
  if (handleOrNode instanceof DataNode) return handleOrNode
  if (handleOrNode !== null && typeof handleOrNode === 'object') {
    const n = (handleOrNode                           )[NODE]
    if (n instanceof DataNode) return n
  }
  throw new Error('data devtools: expected a data handle or DataNode — got ' + typeof handleOrNode)
}

function resolveRuntime(target                )          {
  if (target == null) return defaultRuntime()
  if (target instanceof Runtime) return target
  return resolveNode(target).runtime
}

// ── inspect ──────────────────────────────────────────────────────────────────

// One node's identity + topology + current value. Accepts a public handle
// (resolves through Symbol.for('data.v4.node')) or a raw node.
export function inspect(handleOrNode         )              {
  const n = resolveNode(handleOrNode)
  return {
    id: n.id,
    kind: n.kind,
    op: n.opName,
    height: n.height,
    parents: n.parents.map((p) => p.id),
    value: nodeValue(n),
  }
}

function nodeValue(n               )          {
  if (n.kind === 'scalar') return (n       ).value()
  return materialize(n.snapshot(), n.currentOrder())
}

// ── graph ────────────────────────────────────────────────────────────────────

// The full graph as data: the kernel's GraphNodeInfo[] plus a flat edge list
// (parent → child). Plain JSON — safe to postMessage to a panel or persist.
export function graph(target                 )            {
  const rt = resolveRuntime(target)
  const nodes = rt.graph()
  const edges              = []
  for (const n of nodes) for (const p of n.parents) edges.push({ from: p, to: n.id })
  return { nodes, edges }
}

// ── trace ────────────────────────────────────────────────────────────────────

// Runs fn and returns every CommitInfo observed during it. The onCommit
// subscription is disposed after (even if fn throws) — tracing has zero
// steady-state cost, and the kernel only measures while a hook is live.
// Causality is free: seq IS the cascade id, and CommitInfo.nodes are in
// settle (topological) order.
export function trace(target                , fn            )               {
  const rt = resolveRuntime(target)
  const out               = []
  const sub = rt.onCommit((c) => out.push(c))
  try {
    fn()
  } finally {
    sub.dispose()
  }
  return out
}

// ── profile ──────────────────────────────────────────────────────────────────

// Aggregates trace output per node: {id, op, commits, deltas, totalMs}.
// Op names resolve from the live graph; a node that settled during fn but was
// disposed before aggregation still gets a row (op 'disposed').
export function profile(target                , fn            )               {
  const rt = resolveRuntime(target)
  const commits = trace(rt, fn)
  const ops = opNames(rt)
  const acc = new Map                    ()
  for (const c of commits) {
    for (const s of c.nodes) {
      let row = acc.get(s.id)
      if (row === undefined) {
        row = { id: s.id, op: ops.get(s.id) ?? 'disposed', commits: 0, deltas: 0, totalMs: 0 }
        acc.set(s.id, row)
      }
      row.commits += 1
      row.deltas += s.deltas
      row.totalMs += s.ms
    }
  }
  return [...acc.values()].sort((a, b) => a.id - b.id)
}

// ── cascades ─────────────────────────────────────────────────────────────────

// The flow-essay view: trace output grouped by cascade (seq), each node
// labelled `${op}#${id}` in settle order — "this write became these deltas,
// flowing through these views, in this order".
export function cascades(target                , fn            )            {
  const rt = resolveRuntime(target)
  const commits = trace(rt, fn)
  const ops = opNames(rt)
  return commits.map((c) => ({
    seq: c.seq,
    origin: c.origin.description ?? 'anonymous',
    nodes: c.nodes.map((s) => {
      const op = ops.get(s.id) ?? 'disposed'
      return { id: s.id, op, name: `${op}#${s.id}`, deltas: s.deltas, ms: s.ms }
    }),
  }))
}

function opNames(rt         )                      {
  const m = new Map                ()
  for (const n of rt.graph()) m.set(n.id, n.op)
  return m
}
