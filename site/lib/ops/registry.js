// ops/registry.ts — the typed operator registry: the single source of
// truth from which (M3) both the runtime prototype methods and the public
// Ops<T> types are generated, and from which contract descriptors and
// guidance manifests are generated. No registration side effects: the default
// entry imports operator modules and installs statically.

                                                 
                                                      

                        
                       
                                                                                          
                               
                               
                                                           
                                                                           
                                                                             
                                          
 

export const registry = new Map               ()

export function defineOperator(def       )        {
  if (registry.has(def.name)) throw new Error(`data: operator ${def.name} already defined`)
  registry.set(def.name, def)
  return def
}
