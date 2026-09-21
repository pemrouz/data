// contract — the engine-free package contract. No symbols, no proxies, no
// engine imports: this entry is consumable by fero, codegen, and guidance
// tooling without pulling in the kernel (the load-bearing property
// proto/dir/PLAN.md specified).

export * from './delta.js'
                                        

export const SCHEMA_VERSION = 3         

// The timing/consistency contract version (contract/SCHEDULE.md). Exported at
// runtime so a layered consumer (fero) can assert the contract it was built
// against BEFORE trusting the executable suite's coverage: the suite
// (conformance/schedule.test.ts, one test per numbered clause) rides both
// repos' CIs, and any clause change bumps this constant — an unnoticed bump
// fails the consumer's pin loudly instead of shipping a silent timing change
// (the c870bde lost-write class).
// v2: clause 10 (the deep-path law: nested-field removal, absent-path
// idempotence, vivify-under-null/scalar, per-record ingest isolation — W3).
// v3: clause 11 (the value-domain portability table — W15).
export const SCHEDULE_VERSION = 4         

// ── Wire profiles ────────────────────────────────────────────────────────────
// Native profile (SCHEMA_VERSION 3): stable keys, prev, path, move-with-key.
// Keys serialize domain-tagged: {k: 5} (minted int) vs {k: "5"} (adopted
// string) — JSON distinguishes them; the WireBatch envelope (W1) carries the
// store's keyDomain so a remote fold reconstructs identity exactly.
                        
                                                                             
                                                        
                                                    
                                                                       
                                                                             
                                                                            
                                                                                               
                                                                          
                                                                            
                                                             
                                                                                   
                                                      

// The batch envelope the wire egress emits (W1): one per commit, keyDomain-
// tagged. keyDomain 'int' = array-born minted integer keys; 'string' =
// object-born adopted keys (a store never mixes them — kernel invariant).
                            
                                      
                      
                                         
 

// v2-compat profile — PERMANENT, not a shim. Byte-parity with v2's
// ChangeRecord stream: positional keys for array-born sources (projected
// through the order channel), string key paths, cloned values, `at` for
// inserts. fero-v2 consumes this shape today.
                            
                                                                                         
                                              

// ── Reserved names ───────────────────────────────────────────────────────────
// The versioned reserved-name set: property access on these names resolves to
// operators/built-ins, never to data children. `get(key)` is the total,
// collision-free child read. Frozen for all of v3 — new operators may only
// claim new names in a major.
export const RESERVED                      = new Set([
  // built-ins
  'get', 'set', 'update', 'insert', 'remove', 'patch', 'ingest', 'connect',
  'snapshot', 'raf', 'first', 'last', 'mirror', 'dispose',
  'sink', // v4 (a major): the native batch subscription (W2)
  'promote', // v4: pre-pay the container-adoption spike (W11)
  'each', 'rowCount', // v4: the no-copy read protocol on the handle (W9)
  // operators
  'filter', 'between', 'gt', 'lt', 'gte', 'lte',
  'az', 'za', 'top', 'limit', 'page',
  'length', 'sum', 'avg', 'max', 'min', 'some', 'every',
  'intersect', 'union', 'except',
  'group', 'distinct', 'map', 'to', 'reduce', 'tap',
  'median', 'percentile', 'quantile', // v4: the quantile family (W13)
  'keys', 'values', 'reverse', 'join',
])

// ── Capability descriptors ───────────────────────────────────────────────────
// Generated-from-registry in M1+ (a readonly projection of ops/registry.ts);
// seeded here so fero can consume the category vocabulary from day one.
                                                                                 
                               
                               
                                                                                                      
 

// ── Snapshot fold ────────────────────────────────────────────────────────────
// Folds one native WireRecord into a plain snapshot representation — the
// proto/dir foldSnapshot, promoted. A viewing/replay aid: the engine itself
// only moves forward.
                            
                            
                 
 

export function foldSnapshot(state           , r            )            {
  switch (r.t) {
    case 'add':
      state.rows.set(r.k, r.v)
      if (!state.order.includes(r.k)) {
        if (r.at !== undefined && r.at >= 0 && r.at <= state.order.length) state.order.splice(r.at, 0, r.k)
        else state.order.push(r.k)
      }
      return state
    case 'update': {
      if (r.path !== undefined && r.path.length > 0) {
        // v is the LEAF at path (W1) — deep-set on a copied row.
        const row = state.rows.get(r.k)
        if (row === null || typeof row !== 'object') return state
        const copy = structuredClone(row)       
        let cur = copy
        for (let i = 0; i < r.path.length - 1; i++) {
          const nxt = cur[r.path[i]]
          cur = cur[r.path[i]] = nxt === null || typeof nxt !== 'object' ? {} : nxt
        }
        cur[r.path[r.path.length - 1]] = r.v
        state.rows.set(r.k, copy)
        return state
      }
      state.rows.set(r.k, r.v)
      return state
    }
    case 'remove': {
      if (r.path !== undefined && r.path.length > 0) {
        // Nested FIELD deletion: fold by deleting the leaf property in a
        // copied row (the fold is a viewing aid — plain-JS copy is fine here).
        const row = state.rows.get(r.k)
        if (row === null || typeof row !== 'object') return state // idempotent
        const copy = structuredClone(row)       
        let cur = copy
        for (let i = 0; i < r.path.length - 1; i++) {
          cur = cur?.[r.path[i]]
          if (cur === null || typeof cur !== 'object') return state // absent ancestor — no-op
        }
        delete cur[r.path[r.path.length - 1]]
        state.rows.set(r.k, copy)
        return state
      }
      state.rows.delete(r.k)
      const i = state.order.indexOf(r.k)
      if (i >= 0) state.order.splice(i, 1)
      return state
    }
    case 'move': {
      const i = state.order.indexOf(r.k)
      if (i >= 0) {
        state.order.splice(i, 1)
        state.order.splice(r.to, 0, r.k)
      }
      return state
    }
  }
}
