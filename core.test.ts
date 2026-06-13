// @ts-nocheck
import { deepStrictEqual as same, ok } from 'node:assert'
import { test } from 'node:test'
import { $, value, view, _devtoolsRoots } from './core.ts'

const max = (a, b) => a > b ? a : b
$.random = o => 1 + Object.keys(o).map(Number).sort().reduce(max, -1)

test('update (val, val)', () => {
  const res = $(5)
  const changes = res.connect([])
  res[value] = 10
  res.update(20)
  same(changes, [
    { type: 'update', key: [], value: 5 },
    { type: 'update', key: [], value: 10 },
    { type: 'update', key: [], value: 20 },
  ])
  same(res[value], 20)
})

test('connect(fn) single-arg throws immediately with a helpful message', () => {
  // A bare function is not a valid sink; the single-arg form must fail fast
  // at connect() time (not defer a cryptic "fn.BI0 is not a function" to the
  // first event). The two-arg connect(anchor, fn) is the supported form.
  const res = $([1, 2, 3])
  let threw
  try { res.connect(c => c) } catch (e) { threw = e }
  ok(threw, 'connect(fn) should throw')
  ok(/connect\(fn\) isn't supported/.test(threw.message), threw?.message)
  // The supported two-arg form still works and receives change records.
  const seen = []
  res.connect({}, c => seen.push(c.type))
  res.insert(4)
  ok(seen.includes('insert'), 'connect(anchor, fn) still delivers events')
})

test('insert (val, val)', () => {
  const res = $(5)
  const changes1 = res.connect([])
  const changes2 = res[0].connect([])
  const changes3 = res[1].connect([])
  res.insert(10)
  res.insert(20)
  same(changes1, [
    { type: 'update', key: [], value: 5 },
    { type: 'insert', key: [], value: 10, at: '0' },
    { type: 'insert', key: [], value: 20, at: '1' }
  ])
  same(changes2, [
    { type: 'update', key: [], value: undefined },
    { type: 'update', key: [], value: 10 }
  ])
  same(changes3, [
    { type: 'update', key: [], value: undefined },
    { type: 'update', key: [], value: 20 }
  ])
  same(res[value], { 0: 10, 1: 20 })
  same(res[0][value], 10)
  same(res[1][value], 20)
})

test('remove (val, val)', () => {
  const res = $(5)
  const changes1 = res.connect([])
  const changes2 = res.a.connect([])
  delete res[value]
  delete res[value]
  same(changes1, [
    { type: 'update', key: [], value: 5 },
    { type: 'remove', key: [], value: 5 }
  ])
  same(changes2, [
    { type: 'update', key: [], value: undefined }
  ])
  same(res[value], undefined)
})

test('update (val, dir)', () => {
  const res = $(5)
  const changes1 = res.connect([])
  const changes2 = res.a.connect([])
  res[value] = { a: 1 }
  res.a = 2
  same(changes1, [
    { type: 'update', key: [], value: 5 },
    { type: 'update', key: [], value: { a: 1 } },
    { type: 'update', key: ['a'], value: 2 },
  ])
  same(changes2, [
    { type: 'update', key: [], value: undefined },
    { type: 'update', key: [], value: 1 },
    { type: 'update', key: [], value: 2 }
  ])
  same(res[value], { a: 2 })
  same(res.a[value], 2)
})

test('proxy/link', () => {
  const c = $({ a: 1 })
  const d = $({ b: 2 })
  const e = $(c)
  const changes1 = c.connect([])
  const changes2 = d.connect([])
  const changes3 = e.connect([])
  same(c[value], { a: 1 })
  same(d[value], { b: 2 })
  same(e[value], { a: 1 })

  e[value] = d
  c.x = 0
  same(c[value], { a: 1, x: 0 })
  same(d[value], { b: 2 })
  same(e[value], { b: 2 })

  e.f = 3
  same(c[value], { a: 1, x: 0 })
  same(d[value], { b: 2, f: 3 })
  same(e[value], { b: 2, f: 3 })

  d.g = 4
  same(c[value], { a: 1, x: 0 })
  same(d[value], { b: 2, f: 3, g: 4 })
  same(e[value], { b: 2, f: 3, g: 4 })

  delete d.g
  same(c[value], { a: 1, x: 0 })
  same(d[value], { b: 2, f: 3 })
  same(e[value], { b: 2, f: 3 })

  same(changes1, [
    { type: 'update', key: [], value: { a: 1 } },
    { type: 'insert', key: [], value: 0, at: 'x' }
  ])
  same(changes2, [
    { type: 'update', key: [], value: { b: 2 } },
    { type: 'insert', key: [], value: 3, at: 'f' },
    { type: 'insert', key: [], value: 4, at: 'g' },
    { type: 'remove', key: [ 'g' ], value: 4 }
  ])
  same(changes3, [
    { type: 'update', key: [], value: { a: 1 } },
    { type: 'update', key: [], value: { b: 2 } },
    { type: 'insert', key: [], value: 3, at: 'f' },
    { type: 'insert', key: [], value: 4, at: 'g' },
    { type: 'remove', key: [ 'g' ], value: 4 }
  ])
})

test('array indexing', () => {
  const res = $({ a: [1] })
  const changes1 = res.connect([])
  const changes2 = res.a.connect([])
  const changes3 = res.a[0].connect([])
  const changes4 = res.a[1].connect([])
  const changes5 = res.a[2].connect([])
  res.a.insert(3, 0)
  res.a.insert(2, 1)
  delete res.a[1]

  same(changes1, [
    { type: 'update', key: [], value: { a: [1] } },
    { type: 'insert', key: [ 'a' ], value: 3, at: '0' },
    { type: 'insert', key: [ 'a' ], value: 2, at: '1' },
    { type: 'remove', key: [ 'a', '1' ], value: 2 }
  ])
  same(changes2, [
    { type: 'update', key: [], value: [ 1 ] },
    { type: 'insert', key: [], value: 3, at: '0' },
    { type: 'insert', key: [], value: 2, at: '1' },
    { type: 'remove', key: [ '1' ], value: 2 }
  ])
  same(changes3, [
    { type: 'update', key: [], value: 1 },
    { type: 'update', key: [], value: 3 }
  ])
  same(changes4, [
    { type: 'update', key: [], value: undefined },
    { type: 'update', key: [], value: 1 },
    { type: 'update', key: [], value: 2 },
    { type: 'update', key: [], value: 1 }
  ])
  same(changes5, [
    { type: 'update', key: [], value: undefined },
    { type: 'update', key: [], value: 1 },
    { type: 'update', key: [], value: undefined }
  ])
  same(res[value], { a: [ 3, 1 ] })
})

test('proxy/link - child propagation', () => {
  // regression: LinkedView.BU1/BU2/BI0/BR1 etc. used to override View's
  // implementations and only forward to their own sinks, skipping the
  // child-traversal step. Path-keyed updates on the source therefore never
  // reached descendants of the LinkedView. Each assertion below is a path
  // that was silently broken before the fix.
  const src = $({ a: { x: 1 }, b: 2 })
  const linked = $(src)
  const cLinkedRoot = linked.connect([])
  const cLinkedA = linked.a.connect([])
  const cLinkedAX = linked.a.x.connect([])
  const cLinkedB = linked.b.connect([])

  // BU2 on source reaches the grandchild sink of the LinkedView.
  src.a.x = 5
  same(linked[value], { a: { x: 5 }, b: 2 })

  // BU1 on source reaches a child sink of the LinkedView.
  src.b = 3

  // Late-attached child sink: BI0 on source reaches the new child.
  const cLinkedC = linked.c.connect([])
  src.c = 7
  same(linked.c[value], 7)

  // BR1 on source reaches the child sink as a remove.
  delete src.b
  same(linked.b[value], undefined)

  // Switching the source: children that exist in the new src get an
  // update, ones that don't get an XR0 (and skip if their value was
  // already undefined).
  const other = $({ a: { x: 9 } })
  linked[value] = other
  same(linked.a.x[value], 9)
  same(linked.c[value], undefined)

  same(cLinkedAX, [
    { type: 'update', key: [], value: 1 },
    { type: 'update', key: [], value: 5 },
    { type: 'update', key: [], value: 9 },
  ])
  same(cLinkedA, [
    { type: 'update', key: [], value: { x: 1 } },
    { type: 'update', key: ['x'], value: 5 },
    { type: 'update', key: [], value: { x: 9 } },
  ])
  same(cLinkedB, [
    { type: 'update', key: [], value: 2 },
    { type: 'update', key: [], value: 3 },
    { type: 'remove', key: [], value: 3 },
  ])
  same(cLinkedC, [
    { type: 'update', key: [], value: undefined },
    { type: 'update', key: [], value: 7 },
    { type: 'remove', key: [], value: 7 },
  ])
  same(cLinkedRoot, [
    { type: 'update', key: [], value: { a: { x: 1 }, b: 2 } },
    { type: 'update', key: ['a', 'x'], value: 5 },
    { type: 'update', key: ['b'], value: 3 },
    { type: 'insert', key: [], value: 7, at: 'c' },
    { type: 'remove', key: ['b'], value: 3 },
    { type: 'update', key: [], value: { a: { x: 9 } } },
  ])
})

test('iterator', async () => {
  const res = $([1, 2])
  const [one, two, three] = res
  const changes1 = one.connect([])
  const changes2 = two.connect([])
  const changes3 = three.connect([])
  same(one[value], 1)
  same(two[value], 2)
  same(three[value], undefined)

  res.insert(3)
  same(one[value], 1)
  same(two[value], 2)
  same(three[value], 3)

  res[1] = 4
  same(one[value], 1)
  same(two[value], 4)
  same(three[value], 3)

  delete res[1]
  same(one[value], 1)
  same(two[value], 3)
  same(three[value], undefined)

  same(changes1, [
    { type: 'update', value: 1, key: [] }
  ])
  same(changes2, [
    { type: 'update', value: 2, key: [] },
    { type: 'update', value: 4, key: [] },
    { type: 'update', value: 3, key: [] }
  ])
  same(changes3, [
    { type: 'update', value: undefined, key: [] },
    { type: 'update', value: 3, key: [] },
    { type: 'update', value: undefined, key: [] }
  ])
})

// A ViewProxy is a callable Proxy, so any property read — including `then` —
// returns a callable child view, which makes the runtime treat the proxy as a
// thenable. Without the `apply` guard, `await proxy` would call the `then`
// child view, hit the operator dispatch, and throw "Unknown operator 'then'".
// We distinguish promise assimilation (calls `then` with a function arg) from
// genuine `.then` data access (reads, never calls) at call time.
test('thenable - await resolves to the current snapshot', async () => {
  same(await $([1, 2, 3]), [1, 2, 3])
  same(await $({ a: 1 }), { a: 1 })
  // assimilation reads the live snapshot at await time
  const res = $([1])
  res.insert(2)
  same(await res, [1, 2])
  // survives Promise.all and async-return assimilation
  same(await Promise.all([$([9]), $('x')]), [[9], 'x'])
  same(await (async () => $({ ok: true }))(), { ok: true })
})

test('thenable - `.then` is still a real child-view key (read, not call)', async () => {
  // Reading `.then` must keep working as data access — it only becomes a
  // promise probe when *called* with a function. A key literally named "then"
  // round-trips through await untouched.
  const res = $({ a: 1, then: 99 })
  same(res.then[value], 99)
  res.then = 100
  same(res.then[value], 100)
  same(await res, { a: 1, then: 100 })
})

// `first()` / `last()` are sugar over `proxy[0]` / `proxy[lastKey]` — the
// same child-view machinery, just discoverable as methods. Snapshot
// semantics: `last()` reads the source's current last key at call time.
test('first/last - array indexing', () => {
  const res = $(['a', 'b', 'c'])
  same(res.first()[value], 'a')
  same(res.last()[value], 'c')
})

test('first/last - tracking the same child view as numeric indexing', () => {
  const res = $(['a', 'b', 'c'])
  // first() and proxy[0] resolve to the same child view, so subscribing
  // through one and mutating through the other is observed.
  const changes = res.first().connect([])
  res[0] = 'A'
  same(changes, [
    { type: 'update', key: [], value: 'a' },
    { type: 'update', key: [], value: 'A' },
  ])
})

test('first/last - empty array returns proxy at "0" with undefined value', () => {
  const res = $([])
  same(res.first()[value], undefined)
  same(res.last()[value], undefined)
})

test('first/last - object iteration order', () => {
  const res = $({ a: 1, b: 2, c: 3 })
  same(res.first()[value], 1)
  same(res.last()[value], 3)
})

// Replaces the rafWriter pattern that was hand-rolled in
// examples/crossfilter/index.html. Tests run in node where there's no native
// requestAnimationFrame; the operator falls back to setTimeout(16), so these
// tests just await > 16ms before asserting.
const tick = () => new Promise(r => setTimeout(r, 30))

test('raf - coalesces a burst into one commit per frame', async () => {
  const res = $([0, 0])
  const changes = res.connect([])
  const write = res.raf()
  write([1, 1])
  write([2, 2])
  write([3, 3])
  // not committed synchronously
  same(res[value], [0, 0])
  await tick()
  // burst landed as one update, with the latest value
  same(res[value], [3, 3])
  same(changes, [
    { type: 'update', key: [], value: [0, 0] },
    { type: 'update', key: [], value: [3, 3] },
  ])
})

test('raf - flush commits immediately and cancels the pending frame', async () => {
  const res = $(0)
  const changes = res.connect([])
  const write = res.raf()
  write(1)
  write(2)
  same(res[value], 0)
  write.flush()
  same(res[value], 2)
  // pending frame should be cancelled — no second commit after the timer fires
  await tick()
  same(res[value], 2)
  same(changes, [
    { type: 'update', key: [], value: 0 },
    { type: 'update', key: [], value: 2 },
  ])
})

test('raf - flush is a no-op when nothing is pending', () => {
  const res = $(0)
  const write = res.raf()
  write.flush()    // nothing pending — must not throw or commit
  same(res[value], 0)
})

test('raf - separate bursts commit independently', async () => {
  const res = $(0)
  const changes = res.connect([])
  const write = res.raf()
  write(1)
  await tick()
  write(2)
  await tick()
  same(changes, [
    { type: 'update', key: [], value: 0 },
    { type: 'update', key: [], value: 1 },
    { type: 'update', key: [], value: 2 },
  ])
})

test('raf - works on a child view', async () => {
  const res = $({ a: 1, b: 2 })
  const write = res.a.raf()
  write(10)
  await tick()
  same(res[value], { a: 10, b: 2 })
})

// Helper: walk the WeakRef Set and check whether `target` is currently
// registered. Mirrors the logic devtools/walk.ts:iterRoots() will use.
function rootsHas(target) {
  for (const ref of _devtoolsRoots) if (ref.deref() === target) return true
  return false
}

test('devtools - root view is registered in _devtoolsRoots', () => {
  const res = $({ a: 1 })
  ok(rootsHas(res[view]))
})

test('devtools - linked roots are not registered (only the source is)', () => {
  const src = $({ a: 1 })
  const linked = $(src)
  ok(rootsHas(src[view]))
  ok(!rootsHas(linked[view]))
})

test('devtools - _devtoolsRoots holds WeakRef so unreached roots can be GC\'d', () => {
  // Sanity check on the new shape: every entry is a WeakRef whose deref
  // returns either a View or undefined (not a raw value).
  $({ a: 1 })
  for (const ref of _devtoolsRoots) {
    ok(ref instanceof WeakRef, '_devtoolsRoots entries should be WeakRef instances')
    const v = ref.deref()
    ok(v === undefined || (v && typeof v === 'object'), 'deref returns View|undefined')
  }
})

test('connect(obj, fn) — FunctionSink pinned to obj (returned), survives GC', () => {
  // Like PropSink, a FunctionSink lives only as a WeakRef on the view; pinning it
  // to `obj` via lifetimes means holding connect()'s return value keeps it firing.
  const res = $({ a: 1 })
  const seen = []
  const host = res.connect({}, c => seen.push(c)) // FunctionSink branch
  ok(host && typeof host === 'object', 'connect returns the host object')
  same(seen.length, 1)                            // initial snapshot
  res.b = 2
  same(seen.length, 2)                            // subsequent change delivered

  // With gc exposed, dropping every local ref but `host` must NOT stop delivery —
  // that's the regression this pin guards against.
  if (typeof globalThis.gc === 'function') {
    globalThis.gc()
    res.c = 3
    same(seen.length, 3, 'FunctionSink collected despite host being retained')
  }
  ok(host) // keep `host` reachable to end-of-test
})

test('connect([]) — ArrSink pinned to the array (returned), survives GC', () => {
  // The array references the sink only one way (sink.arr), so holding it must be
  // made to keep the sink alive — same pin as FunctionSink/PropSink.
  const res = $({ a: 1 })
  const changes = res.connect([]) // ArrSink branch; returns the array
  same(changes.length, 1)         // initial snapshot pushed
  res.b = 2
  same(changes.length, 2)         // subsequent change pushed

  if (typeof globalThis.gc === 'function') {
    globalThis.gc()
    res.c = 3
    same(changes.length, 3, 'ArrSink collected despite array being retained')
  }
  ok(changes) // keep `changes` reachable to end-of-test
})

test('patch - batches updates and inserts into one cascade', () => {
  // patch([name, value, ...]) is the bulk form of `proxy[name] = value`: it
  // updates the backing value for every pair and emits a single batched BU1
  // (new keys split out as BI0), instead of one dispatch per assignment. This
  // is the high-throughput producer path the swarm example uses.
  const data = $({ a: { n: 1 }, b: { n: 2 }, c: { n: 3 } })
  const changes = data.connect([])
  const aChanges = data.a.connect([]) // touched row sees its update…
  const bChanges = data.b.connect([]) // …untouched row stays silent (per-path routing)

  data.patch(['a', { n: 10 }, 'c', { n: 30 }, 'd', { n: 99 }]) // a,c update; d insert

  same(data[value], { a: { n: 10 }, b: { n: 2 }, c: { n: 30 }, d: { n: 99 } })
  same(changes, [
    { type: 'update', key: [], value: { a: { n: 1 }, b: { n: 2 }, c: { n: 3 } } },
    { type: 'update', key: ['a'], value: { n: 10 } },
    { type: 'update', key: ['c'], value: { n: 30 } },
    { type: 'insert', key: [], value: { n: 99 }, at: 'd' },
  ])
  same(aChanges, [
    { type: 'update', key: [], value: { n: 1 } },
    { type: 'update', key: [], value: { n: 10 } },
  ])
  same(bChanges, [{ type: 'update', key: [], value: { n: 2 } }])
})

test('patch - new keys become inserts, existing keys propagate per-path', () => {
  // a second cascade on the same proxy: new key 'e' inserts; the
  // previously-inserted 'c' updates; a derived child sees only its own path.
  const data = $({ a: { n: 1 } })
  data.patch(['b', { n: 2 }, 'c', { n: 3 }]) // two inserts
  const changes = data.connect([])
  const cChanges = data.c.n.connect([])
  data.patch(['c', { n: 30 }, 'e', { n: 5 }]) // c updates, e inserts
  same(data[value], { a: { n: 1 }, b: { n: 2 }, c: { n: 30 }, e: { n: 5 } })
  same(changes, [
    { type: 'update', key: [], value: { a: { n: 1 }, b: { n: 2 }, c: { n: 3 } } },
    { type: 'update', key: ['c'], value: { n: 30 } },
    { type: 'insert', key: [], value: { n: 5 }, at: 'e' },
  ])
  same(cChanges, [
    { type: 'update', key: [], value: 3 },
    { type: 'update', key: [], value: 30 },
  ])
})

// Regression: sclone guarded only undefined before dereferencing d[view], so a
// null delta value — ordinary JSON data — threw TypeError INSIDE the cascade
// whenever a record-producing sink (connect([]) / connect(obj, fn)) was
// attached. The backing value was already committed by then, so every sink
// missed the event and the exception escaped to the innocent mutator.
test('connect - null delta values flow through record sinks', () => {
  const res = $({ a: 1 })
  const changes = res.connect([])
  const seen = []
  res.connect({}, c => seen.push(c.value))

  res.b = null            // insert of null
  res.a = null            // update to null
  res.c = { d: 1 }
  res.c.d = null          // nested update to null
  same(res[value], { a: null, b: null, c: { d: null } })
  same(changes, [
    { type: 'update', key: [], value: { a: 1 } },
    { type: 'insert', key: [], value: null, at: 'b' },
    { type: 'update', key: ['a'], value: null },
    { type: 'insert', key: [], value: { d: 1 }, at: 'c' },
    { type: 'update', key: ['c', 'd'], value: null },
  ])
  same(seen, [{ a: 1 }, null, null, { d: 1 }, null]) // first entry = connect-time snapshot

  // array inserts of null take the BI0 path
  const arr = $([1, 2])
  const arrChanges = arr.connect([])
  arr[2] = null
  same(arr[value], [1, 2, null])
  same(arrChanges, [
    { type: 'update', key: [], value: [1, 2] },
    { type: 'insert', key: [], value: null, at: '2' },
  ])

  // root replacement to null
  const root = $({ x: 1 })
  const rootChanges = root.connect([])
  root[value] = null
  same(root[value], null)
  same(rootChanges, [
    { type: 'update', key: [], value: { x: 1 } },
    { type: 'update', key: [], value: null },
  ])
})

// Regression: `typeof null === 'object'` slipped past the auto-vivify guards in
// BU1/BU2/BI0/BI2, so `$(null).a = 1` threw ('Cannot set properties of null')
// while $(undefined) and every other primitive root vivified to an object per
// the transparent-mutation contract. Same gap after a root BECOMES null at
// runtime (s[value] = null; s.b = 2).
test('mutation - null roots vivify like every other primitive', () => {
  const a = $(null)
  a.x = 1
  same(a[value], { x: 1 })

  const b = $({ k: 1 })
  b[value] = null
  b.k = 2                      // BU1 upsert path on a null backing value
  same(b[value], { k: 2 })

  const c = $(null)
  c.patch(['m', 1, 'n', 2])    // batched BU1 on a null root
  same(c[value], { m: 1, n: 2 })

  const d = $(null)
  d.insert(5, 'p')             // BI0 path
  same(d[value], { p: 5 })

  const e = $({ q: 1 })
  e[value] = null
  e.r = { s: 1 }
  e.r.s = 2                    // BU2 deep path after re-vivify
  same(e[value], { r: { s: 2 } })
})

// Regression: JSON.stringify(proxy) used to throw 'Unknown operator toJSON' —
// stringify probes .toJSON (a callable child view), calls it, and landed in
// the operator-dispatch fall-through. Serializing state is routine logging;
// it now resolves with the raw snapshot, like the thenable guard.
test('JSON.stringify(proxy) serializes the snapshot', () => {
  same(JSON.stringify($({ a: 1, b: [1, null] })), '{"a":1,"b":[1,null]}')
  same(JSON.stringify($(5)), '5')
  same(JSON.stringify({ nested: $({ x: 1 }) }), '{"nested":{"x":1}}')
  const t = $({ toJSON: 1 })       // a key literally named toJSON stays data
  same(t.toJSON[value], 1)
})

// Regression: the unknown-operator error unconditionally claimed "the dispatch
// table is empty — likely an import from 'data/lean'", even when operators WERE
// registered (where it misdirected every typo'd name at a nonexistent lean
// import). core.test.ts runs against the bare core, so the table IS empty here;
// the populated-table variant is asserted in index.test.ts.
test('unknown operator - empty-table diagnosis points at data/lean', () => {
  let e
  try { $({}).bogus() } catch (err) { e = err }
  ok(/Unknown operator 'bogus'/.test(e?.message), e?.message)
  ok(/dispatch table is empty/.test(e?.message), e?.message)
})

// Regression (C1 root-array refill): writing a value into a slot that is
// currently undefined was classified as a fresh insert and routed through
// BI0 -> BI0A (splice-shift), even when the index was IN-BOUNDS of an array.
// `s[k] = undefined` (length-stable hole) then `s[k] = v` (hole fill) thus
// grew a phantom row in every downstream positional operator. An in-bounds
// array hole-fill must route through BF0 (length-stable); out-of-bounds stays
// an insert; objects keep a previously-undefined key as a real insert. The
// downstream-operator consequences are asserted in index.test.ts (operators
// aren't registered against the bare core); here we pin the raw value and the
// position-agnostic change-record stream.
test('array refill of an in-bounds hole keeps the array length-stable', () => {
  const s = $([1, 2, 3, 4])
  s[2] = undefined            // length-stable hole
  s[2] = 9                    // refill — must NOT shift
  same(s[value], [1, 2, 9, 4])
  same(s[value].length, 4)

  // out-of-bounds write IS a genuine append (extends the array)
  const a = $([1, 2])
  a[2] = 3
  same(a[value], [1, 2, 3])

  // OBJECT source: a previously-undefined key stays a real insert (BI0)
  const o = $({ a: 1 })
  const oc = o.connect([])
  o.b = undefined
  o.b = 2
  same(o[value], { a: 1, b: 2 })
  same(oc.at(-1), { type: 'insert', key: [], value: 2, at: 'b' })
})

// Regression (C3): View.BR1/BI0A found the smallest shifted index to start the
// V1 child-view refresh by comparing protocol names with `<` — but names are
// strings, so '10' < '9' lexicographically. A multi-index array batch crossing
// a digit-width boundary (e.g. patch over indices 9 and 10) computed offset as
// '10', V1 started past 9, and a held child view at index 9 kept a stale
// snapshot while the backing array had the new value. Coerced with unary + now.
test('array child-view refresh handles a digit-width boundary (BI0A/BR1 min)', () => {
  const s = $([0, 1, 2, 3, 4, 5, 6, 7, 8])
  const child9 = s[9] // held child past the boundary
  s.patch(['10', 'x', '9', 'y']) // two new indices, 10 before 9 in payload order
  same(s[value][9], 'y')
  same(child9[value], 'y') // was undefined (V1 started at lexicographic '10')

  // remove crossing the boundary: indices >= 9 shift down by one
  const r = $(Array.from({ length: 12 }, (_, i) => i))
  const c10 = r[10]
  delete r[9]
  same(c10[value], r[value][10]) // 11 — was stale at 10
})

// Regression (C4): Value.BU2's no-op guard skipped the assignment but left the
// pair in U2 and dispatched it unfiltered, so a no-op deep write (`s.a.b = 1`
// when already 1, or a sub-proxy patch with unchanged values) emitted a phantom
// update — change-stream consumers saw updates for nothing and every BU2-rebuild
// operator re-ran. BU2 now builds a filtered NU2 like BU1 (whose sibling no-op
// already emits nothing).
test('deep no-op write emits no phantom update (BU2 filtering)', () => {
  const s = $({ a: { b: 1 }, c: 2 })
  const ev = s.connect([])
  s.c = 2     // BU1 no-op (already filtered)
  s.a.b = 1   // BU2 no-op — must emit nothing
  s.a.b = 9   // real change
  same(ev.slice(1), [{ type: 'update', key: ['a', 'b'], value: 9 }])

  // sub-proxy patch with all-unchanged values emits nothing
  const s2 = $({ o: { a: 1, b: 2 } })
  const ev2 = s2.o.connect([])
  s2.o.patch(['a', 1, 'b', 2])
  same(ev2.slice(1), [])
})

// Regression (re-entrancy queue): a sink callback that writes back to the graph
// used to re-enter the synchronous fan-out — unbounded recursion overflowed the
// stack and poisoned the graph; a terminating rule delivered events out of
// order. Re-entrant writes are now deferred FIFO until the current cascade
// settles; a non-converging cycle is reported instead of hanging/overflowing.
test('re-entrant write from a sink is deferred until the cascade settles', () => {
  // structural re-entrancy: inserting during a remove-cascade must not splice
  // mid-flight (which desynced downstream positional consumers). The insert
  // lands after the remove completes.
  const arr = $([10, 20, 30])
  const order = []
  let armed = true
  arr.connect({}, (c) => {
    order.push(c.type)
    if (armed && c.type === 'remove') { armed = false; arr.insert(99) }
  })
  delete arr[0]
  same(arr[value], [20, 30, 99])
  // remove fully delivered before the deferred insert
  same(order, ['update', 'remove', 'insert'])
})

test('non-converging re-entrant cycle throws instead of overflowing', () => {
  const c = $({ x: 0 })
  c.connect({}, (ch) => { if (ch.key[0] === 'x') c.x = (ch.value || 0) + 1 })
  let err
  try { c.x = 1 } catch (e) { err = e }
  ok(err && /reactive cycle/.test(err.message), err?.message)
})

// Regression (C7): a sink that subscribed during another sink's callback (a
// connect() mid-cascade) was seeded with the post-commit snapshot AND then
// visited by the live Set iterator for the in-flight delta — delivering the
// same change twice (a duplicate that no fold could reconcile). Fan-out now
// snapshots the sink set, so a mid-emit subscriber gets only its seed snapshot
// and sees subsequent events normally.
test('subscribing during fan-out does not double-deliver the in-flight event', () => {
  const src = $({ a: 1 })
  let added = false
  let late
  src.connect({}, (c) => {
    if (!added && c.key[0] === 'a') { added = true; late = src.connect([]) }
  })
  src.a = 2
  same(late, [{ type: 'update', key: [], value: { a: 2 } }]) // seed only, no echoed delta
  src.a = 3 // a later event is delivered normally
  same(late.at(-1), { type: 'update', key: ['a'], value: 3 })
})

// Regression (C8): LinkedView.update re-pointed the source with no cycle check
// and BEFORE the XU0, so `b=$(a); c=$(b); b[value]=c` (b.src=c, c.src=b) made
// the read-through getter recurse to a RangeError — and since the re-point had
// already committed, EVERY later read/write on b or c threw forever. A cycle is
// now rejected up front, leaving both proxies fully usable.
test('linked value rejects a cycle without poisoning the proxies', () => {
  const a = $({ x: 1 })
  const b = $(a)
  const c = $(b)
  let err
  try { b[value] = c } catch (e) { err = e }
  ok(err && /cyclic/.test(err.message), err?.message)
  // both still usable — the rejected link was a clean no-op
  same(b[value], { x: 1 })
  b.x = 2
  same(b[value], { x: 2 })
  same(a[value], { x: 2 }) // b still forwards to a
  same(c[value], { x: 2 }) // c still mirrors b
  // a legitimate re-point still works
  const other = $({ y: 9 })
  b[value] = other
  same(b[value], { y: 9 })
})

// Regression (#56): Symbol.toPrimitive was `(hint) => hint ? toString : +value`,
// but hint is always one of 'string'|'number'|'default' (all truthy), so the
// numeric branch was dead — every coercion round-tripped through toString and
// `+$(aDate)` was NaN. Only 'string' should take the string form.
test('Symbol.toPrimitive - numeric coercion is numeric, not a string round-trip', () => {
  const d = new Date('2024-01-01')
  same(+$(d), d.getTime())       // number hint — was NaN
  same(+$(5), 5)
  same($(3) + 4, 7)              // default hint, numeric value -> numeric
  same(`${$(7)}`, '7')          // string hint -> string
  same('row:' + $('A'), 'row:A') // default hint, STRING value -> string (not NaN)
  same(`${$('A')}`, 'A')        // string hint, string value
})

// Regression (#50): every $() root registered a WeakRef in the module-global
// _devtoolsRoots, pruned only when the devtools layer iterates it — so a
// non-devtools app leaked a wrapper + Set entry per root forever. A
// FinalizationRegistry now removes each wrapper when its root is GC'd, keeping
// the registry bounded to live roots. (Run under --expose-gc.)
test('_devtoolsRoots stays bounded as transient roots are collected', { skip: typeof global.gc !== 'function' ? 'needs --expose-gc' : false }, async () => {
  for (let i = 0; i < 20000; i++) { const r = $({ n: i }); void r.n }
  global.gc(); await new Promise((r) => setTimeout(r, 10)); global.gc()
  await new Promise((r) => setTimeout(r, 30))
  ok(_devtoolsRoots.size < 1000, `expected the registry to shrink after GC, got ${_devtoolsRoots.size}`)
})
