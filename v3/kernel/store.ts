// v3/kernel/store.ts — the keyed row store with a packed dense lane.
//
// Keys are permanent identity; slots are physical detail no consumer ever
// sees. Removal tombstones (never shifts survivors); compaction runs off the
// hot path and remaps key→slot, never keys. A slot is live iff
// keySlot.get(slotKey[i]) === i — no separate bitmap needed at M1 (the
// packed-slots layout stays columnar-ready: a columnar SourceBacking swaps
// `slots: T[]` for per-field columns behind the same keySlot map).
//
// INVARIANT: kernel state is keyed ONLY via Map/Set — 1 and '1' can never
// collide (the v2 string/number coercion family is unrepresentable).

import type { RowKey } from '../contract/delta.ts'

export class Store<T> {
  declare slots: (T | undefined)[]
  declare slotKey: RowKey[]
  declare keySlot: Map<RowKey, number>
  declare nextKey: number // synthetic key counter (array-born rows)
  declare holes: number

  constructor() {
    this.slots = []
    this.slotKey = []
    this.keySlot = new Map()
    this.nextKey = 0
    this.holes = 0
  }

  get size(): number {
    return this.keySlot.size
  }

  mintKey(): number {
    return this.nextKey++
  }

  has(key: RowKey): boolean {
    return this.keySlot.has(key)
  }

  get(key: RowKey): T | undefined {
    const s = this.keySlot.get(key)
    return s === undefined ? undefined : this.slots[s]
  }

  // Single-lookup accessor for the write hot path (has + get in one hash).
  slotOf(key: RowKey): number | undefined {
    return this.keySlot.get(key)
  }

  rowAt(slot: number): T {
    return this.slots[slot] as T
  }

  writeSlot(slot: number, row: T): void {
    this.slots[slot] = row
  }

  // Insert or overwrite; returns previous row (undefined if new).
  set(key: RowKey, row: T): T | undefined {
    const s = this.keySlot.get(key)
    if (s !== undefined) {
      const prev = this.slots[s]
      this.slots[s] = row
      return prev
    }
    const slot = this.slots.length
    this.slots.push(row)
    this.slotKey.push(key)
    this.keySlot.set(key, slot)
    if (typeof key === 'number' && key >= this.nextKey) this.nextKey = key + 1
    return undefined
  }

  del(key: RowKey): T | undefined {
    const s = this.keySlot.get(key)
    if (s === undefined) return undefined
    const prev = this.slots[s]
    this.slots[s] = undefined // tombstone — survivors never shift
    this.keySlot.delete(key)
    this.holes++
    if (this.holes > (this.slots.length >> 1) && this.slots.length > 16) this.compact()
    return prev
  }

  compact(): void {
    const slots: (T | undefined)[] = []
    const slotKey: RowKey[] = []
    for (let i = 0; i < this.slots.length; i++) {
      const k = this.slotKey[i]
      if (this.keySlot.get(k) === i) {
        this.keySlot.set(k, slots.length)
        slots.push(this.slots[i])
        slotKey.push(k)
      }
    }
    this.slots = slots
    this.slotKey = slotKey
    this.holes = 0
  }

  // Packed iteration in key-insertion order (Map preserves it) — the specified
  // total iteration order for object stores.
  *entries(): IterableIterator<[RowKey, T]> {
    for (const [k, s] of this.keySlot) yield [k, this.slots[s] as T]
  }

  *keys(): IterableIterator<RowKey> {
    yield* this.keySlot.keys()
  }

  snapshot(): Map<RowKey, T> {
    const m = new Map<RowKey, T>()
    for (const [k, s] of this.keySlot) m.set(k, this.slots[s] as T)
    return m
  }
}
