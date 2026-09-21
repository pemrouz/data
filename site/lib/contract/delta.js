// contract/delta.ts — the closed delta algebra. SCHEMA_VERSION = 3.
//
// This is the WHOLE protocol: three row verbs, three order verbs, one scalar
// shape, one batch envelope. There is no other verb surface. Every operator
// consumes and emits exactly this; every sink implements one exhaustive
// switch over RowDelta['op']. A missed verb is a compile error (TS
// exhaustiveness); an illegal emission is a runtime conformance failure
// (conformance/legality.ts).
//
// Design rulings this file encodes (plans/v3/PLAN.md §3.1, §4):
// - update is FIRST-CLASS and carries `prev` (oldValue). Never retract+insert.
// - Ordering is a separate channel consumed only by sinks that declare
//   `wantsOrder` — position-agnostic consumers never see moves.
// - Batches are consolidated: ≤1 row delta per key per batch. Sinks never
//   observe intra-batch intermediate states.
// - Absence = key not live. `undefined` and `null` are first-class VALUES;
//   there are no positional holes in the value domain.

                                    
// number = synthetic key minted at ingress (array-born rows) — monotonic per
//          store, never reused.
// string = adopted key (object-born rows) — the property name.
// INVARIANT: kernel state is keyed ONLY via Map/Set (never plain-object
// property tables), so 1 and '1' can never collide.

                                               

                              
                    
                      
                 
 

                                 
                       
                      
                                                                
 

                                 
                                                                    
                      
                                               
                                                                             
                                                                                      
                                                                           
                                                                              
                                                                          
                                                                       
                                                                         
                                                                      
                            
 

                                                                       

// The SEPARATE order/rank channel. Emitted only by ordered nodes (array-born
// sources, OrderedView); consumed only by sinks with `wantsOrder: true`.
// Within a batch, order deltas apply AFTER row deltas, in array order.
                             
                                                          
                      
                                                            
                                     
 

// Scalar nodes (aggregates, .to()) — emitted only when !Object.is(prev, next).
                              
                        
                        
 

// Write-origin token. Every batch carries the origin of the commit that
// produced it; a sink that writes marks its writes with its own origin, so
// echo suppression is `if (batch.origin === mine) return` — declarative.
                                

                                 
                                                                              
                              
                                                                         
                                                                              
                                                                          
                                                                              
                                                                    
 

// The sink contract — closed, exhaustive, typed. snapshot-then-deltas:
// init() delivers the current state once at connect time, then apply()
// delivers every subsequent commit exactly once.
                                    
                               
                                                                         
                                    
 

// Batch consolidation rules (the kernel implements these once; documented
// here because legality checking and replay both depend on them):
//   add     + update  → add (updated row)
//   add     + remove  → annihilate (no delta)
//   update  + update  → update (first prev, last row; path = common prefix or [])
//   update  + remove  → remove (first prev)
//   remove  + add     → update (removed prev, new row, path [])
// LWW within a batch; a key that existed before the batch can never surface
// as `add`, and a key that did not exist can never surface as `update`/`remove`.
                                      // marker for doc-reference only
