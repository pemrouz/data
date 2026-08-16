// kernel/store.ts — the keyed row store with a packed dense lane.
//
// Keys are permanent identity; slots are physical detail no consumer ever
// sees. Removal tombstones (never shifts survivors); compaction runs off the
// hot path and remaps key→slot, never keys. A slot is live iff
// keySlot.get(slotKey[i]) === i — no separate bitmap needed at M1 (the
// packed-slots layout stays columnar-ready: a columnar SourceBacking swaps
// `slots: T[]` for per-field columns behind the same keySlot map).
//
// INVARIANT: kernel state is keyed ONLY via Map/Set — 1 and '1' can never
// collide (the v2 string/number coercion family is unrepresentable). The
// ADOPTED lane preserves it with a string guard: a non-string key can never
// hit the adopted object (obj[1] would coerce to obj['1'] — the exact v2
// collision family), so numeric probes MISS until promote() puts them in
// Map-world.
//
// ── ADOPTED-OBJECT MODE (M6 Phase 2) ─────────────────────────────────────────
// $(obj) adopts the user's object AS the row table (take-ownership — matches
// v2's proxy-wrap semantics; rows were always shared by reference) plus ONE
// Object.keys() array as the iteration-order authority. keySlot/slots are
// not built at all — a 10k-row $() ingests in O(keys array), not 10k
// Map.sets — until the first STRUCTURAL write (a new-key set or any del)
// runs the one-shot promote(): okeys-ordered fill of the packed lane, so
// iteration order is identical before and after (Map preserves insertion
// order). Reads/updates of EXISTING keys never promote: value overwrites go
// through obj[key] in place. `mode` is `obj !== null`; adopted stores have
// no tombstones (the first del promotes), so okeys is always exactly the
// live key set while adopted.

import type { RowKey } from '../contract/delta.ts'

export class Store<T> {
  declare slots: (T | undefined)[]
  declare slotKey: RowKey[]
  declare keySlot: Map<RowKey, number>
  declare nextKey: number // synthetic key counter (array-born rows)
  declare holes: number
  declare obj: Record<string, T> | null // adopted lane — null once promoted
  declare okeys: string[] | null // adopted iteration order (Object.keys at adopt)
  declare ident: boolean // adopted-ARRAY lane: key i ≡ slot i, no keySlot/slotKey

  constructor() {
    this.slots = []
    this.slotKey = []
    this.keySlot = new Map()
    this.nextKey = 0
    this.holes = 0
    this.obj = null
    this.okeys = null
    this.ident = false
  }

  // ── ADOPTED-ARRAY (IDENT) MODE (M6 Phase 3) ────────────────────────────────
  // $(arr) adopts the caller's array AS the slots (take-ownership, same
  // contract as adoptObject): key i ≡ slot i while unperturbed, so
  // keySlot/slotKey are never built — a 231k-row ingest is O(1). Appends
  // (key === length) preserve the identity; the first REMOVE (the only
  // structural write that breaks key↔slot identity) runs the one-shot
  // materializeKeys(). Non-integer / out-of-range keys route through
  // materializeKeys() + the packed lane too (map-world minted keys are
  // NUMBERS, so the integer guard preserves the 1-vs-'1' invariant exactly
  // like the object lane's string guard). No tombstones while ident.
  static adoptArray<T>(arr: T[]): Store<T> {
    const st = new Store<T>()
    st.slots = arr as (T | undefined)[]
    st.ident = true
    st.nextKey = arr.length
    return st
  }

  // One-shot exit from the ident lane — the first remove (or a non-append
  // structural key) pays the deferred keySlot/slotKey build.
  materializeKeys(): void {
    if (!this.ident) return
    const n = this.slots.length
    for (let i = 0; i < n; i++) {
      this.slotKey.push(i)
      this.keySlot.set(i, i)
    }
    this.ident = false
  }

  // Adopt the caller's object as the row table (no per-row Map.set loop).
  // Even Object.keys is deferred (okeysOf): on a fresh 10k-key dictionary-
  // mode object it costs ~0.6 ms (no enum cache yet), and non-iterating
  // consumers (a bare tap, a to()) never need it — the first iteration
  // materializes it once. Safe to defer: value updates never change the key
  // set, and structural writes promote (which materializes it first).
  static adoptObject<T>(obj: Record<string, T>): Store<T> {
    const st = new Store<T>()
    st.obj = obj
    return st
  }

  private okeysOf(): string[] {
    return (this.okeys ??= Object.keys(this.obj as Record<string, T>))
  }

  // One-shot exit from the adopted lane — called by the first structural
  // write (new-key set / any del). okeys order seeds Map insertion order, so
  // entries/keys/each/snapshot iterate identically across the transition.
  promote(): void {
    const obj = this.obj
    if (obj === null) return
    const okeys = this.okeysOf()
    for (const k of okeys) {
      this.keySlot.set(k, this.slots.length)
      this.slots.push(obj[k])
      this.slotKey.push(k)
    }
    this.obj = null
    this.okeys = null
  }

  get size(): number {
    if (this.ident) return this.slots.length
    return this.obj !== null ? this.okeysOf().length : this.keySlot.size
  }

  mintKey(): number {
    return this.nextKey++
  }

  private identHit(key: RowKey): boolean {
    return typeof key === 'number' && Number.isInteger(key) && key >= 0 && key < this.slots.length
  }

  has(key: RowKey): boolean {
    if (this.ident) return this.identHit(key)
    if (this.obj !== null) return typeof key === 'string' && Object.hasOwn(this.obj, key)
    return this.keySlot.has(key)
  }

  get(key: RowKey): T | undefined {
    if (this.ident) return this.identHit(key) ? this.slots[key as number] : undefined
    if (this.obj !== null)
      return typeof key === 'string' && Object.hasOwn(this.obj, key) ? this.obj[key] : undefined
    const s = this.keySlot.get(key)
    return s === undefined ? undefined : this.slots[s]
  }

  // In-place overwrite of a key KNOWN to be live (the caller already probed
  // has()/slotOf) — the adopted-lane counterpart of writeSlot.
  updateLive(key: RowKey, row: T): void {
    if (this.ident) {
      this.slots[key as number] = row
      return
    }
    if (this.obj !== null) {
      this.obj[key as string] = row
      return
    }
    this.slots[this.keySlot.get(key) as number] = row
  }

  // Single-lookup accessor for the write hot path (has + get in one hash).
  slotOf(key: RowKey): number | undefined {
    if (this.ident) return this.identHit(key) ? (key as number) : undefined
    return this.keySlot.get(key)
  }

  rowAt(slot: number): T {
    return this.slots[slot] as T
  }

  writeSlot(slot: number, row: T): void {
    this.slots[slot] = row
  }

  // Insert or overwrite; returns previous row (undefined if new). A NEW key
  // on an adopted store is a structural write — promote first (object lane)
  // or materialize keys (ident lane, unless the key is the tail append that
  // preserves identity).
  set(key: RowKey, row: T): T | undefined {
    if (this.ident) {
      if (this.identHit(key)) {
        const prev = this.slots[key as number]
        this.slots[key as number] = row
        return prev
      }
      if (key === this.slots.length) {
        // tail append: key === slot — identity preserved
        this.slots.push(row)
        this.nextKey = (key as number) + 1
        return undefined
      }
      this.materializeKeys() // non-append new key — leave the ident lane
    }
    if (this.obj !== null) {
      if (typeof key === 'string' && Object.hasOwn(this.obj, key)) {
        const prev = this.obj[key]
        this.obj[key] = row
        return prev
      }
      this.promote()
    }
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
    if (this.ident) this.materializeKeys() // structural — leave the ident lane
    if (this.obj !== null) this.promote() // structural — leave the adopted lane
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

  // Packed iteration in key-insertion order (Map preserves it; the adopted
  // lane iterates okeys — the same order promote() seeds) — the specified
  // total iteration order for object stores.
  *entries(): IterableIterator<[RowKey, T]> {
    if (this.ident) {
      for (let i = 0; i < this.slots.length; i++) yield [i, this.slots[i] as T]
      return
    }
    if (this.obj !== null) {
      for (const k of this.okeysOf()) yield [k, this.obj[k]]
      return
    }
    for (const [k, s] of this.keySlot) yield [k, this.slots[s] as T]
  }

  *keys(): IterableIterator<RowKey> {
    if (this.ident) {
      for (let i = 0; i < this.slots.length; i++) yield i
      return
    }
    if (this.obj !== null) {
      yield* this.okeysOf()
      return
    }
    yield* this.keySlot.keys()
  }

  // No-allocation full pass — the hot path for operator construction.
  each(fn: (key: RowKey, row: T) => void): void {
    if (this.ident) {
      const slots = this.slots
      for (let i = 0; i < slots.length; i++) fn(i, slots[i] as T)
      return
    }
    if (this.obj !== null) {
      const okeys = this.okeysOf()
      const obj = this.obj
      for (let i = 0; i < okeys.length; i++) fn(okeys[i], obj[okeys[i]])
      return
    }
    for (const [k, s] of this.keySlot) fn(k, this.slots[s] as T)
  }

  snapshot(): Map<RowKey, T> {
    const m = new Map<RowKey, T>()
    if (this.ident) {
      for (let i = 0; i < this.slots.length; i++) m.set(i, this.slots[i] as T)
      return m
    }
    if (this.obj !== null) {
      const okeys = this.okeysOf()
      for (let i = 0; i < okeys.length; i++) m.set(okeys[i], this.obj[okeys[i]])
      return m
    }
    for (const [k, s] of this.keySlot) m.set(k, this.slots[s] as T)
    return m
  }
}
