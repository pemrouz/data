// v3/ops/registry.ts — the typed operator registry: the single source of
// truth from which (M3) both the runtime prototype methods and the public
// Ops<T> types are generated, and from which contract descriptors and
// guidance manifests are generated. No registration side effects: the default
// entry imports operator modules and installs statically.

import type { DataNode } from '../kernel/node.ts'
import type { OpCategory } from '../contract/index.ts'

export interface OpDef {
  readonly name: string
  readonly kind: 'row' | 'ordered' | 'bucket' | 'aggregate' | 'set' | 'rebuild' | 'effect'
  readonly category: OpCategory
  readonly declarative: boolean
  create(src: DataNode<any>, ...args: any[]): DataNode<any>
  // Dedup iff args have well-defined value identity; null = fresh per call
  // (opaque closures never dedup). Reactive args key by bound-node identity.
  dedupKey?(...args: any[]): string | null
}

export const registry = new Map<string, OpDef>()

export function defineOperator(def: OpDef): OpDef {
  if (registry.has(def.name)) throw new Error(`data: operator ${def.name} already defined`)
  registry.set(def.name, def)
  return def
}
