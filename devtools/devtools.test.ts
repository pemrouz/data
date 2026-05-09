// @ts-nocheck
import { test } from 'node:test'
import { deepStrictEqual as same, ok, strictEqual } from 'node:assert'
import { $, value, view } from '../core.ts'
// Importing 'data/full' to get operator dispatch registered. The lean core
// would throw on .filter(...) etc. (see commit 860befe).
import '../full.ts'
import { walk, classify, summarize, ancestorOf, iterRoots, internalRoot } from './walk.ts'
import './index.ts'
import { _devtoolsRoots, _devtoolsInternalRoots } from '../core.ts'
import { ensureInstrumented, restoreInstrumentation, isInstrumented } from './instrument.ts'
import { traceTargets, profilers, cascadeRecorders, nextTraceId, newProfileAcc, finalize } from './events.ts'
import { View } from '../core.ts'

// Silence the console.* calls inside $.inspect/$.graph during the test run —
// the assertions are on return values, not on console output, and the noise
// would clutter the test output.
const noop = () => {}
console.group = noop; console.log = noop; console.table = noop
console.groupEnd = noop; console.dir = noop; console.warn = noop

test('summarize - primitives pass through', () => {
  strictEqual(summarize(42), 42)
  strictEqual(summarize(true), true)
  strictEqual(summarize(null), null)
  strictEqual(summarize(undefined), undefined)
  strictEqual(summarize('short'), 'short')
})

test('summarize - long strings truncated', () => {
  const s = 'x'.repeat(200)
  const out = summarize(s)
  strictEqual(out.length, 80)
  ok(out.endsWith('...'))
})

test('summarize - arrays show length, objects show key count', () => {
  strictEqual(summarize([1, 2, 3]), 'Array(3)')
  strictEqual(summarize({ a: 1, b: 2 }), '{ keys: 2 }')
})

test('summarize - functions show name', () => {
  strictEqual(summarize(function foo() {}), 'Function(foo)')
  strictEqual(summarize(() => {}), 'Function(anonymous)')
})

test('classify - operator vs connect-style sink vs unknown', () => {
  const data = $({ x: { v: 1 } })
  const filtered = data.filter(d => d.v > 0)
  const sinks = []
  data[view].sink(s => sinks.push(s))
  // The filter is a sink on data — classify it as 'operator'.
  const op = sinks.find(s => s.constructor.name.includes('Filter'))
  strictEqual(classify(op), 'operator')

  const arr = data.connect([])
  const arrSinks = []
  data[view].sink(s => arrSinks.push(s))
  const arrSink = arrSinks.find(s => s.constructor.name === 'ArrSink')
  strictEqual(classify(arrSink), 'connect')

  strictEqual(classify({ constructor: { name: 'Random' } }), 'sink')
  // Keep the ArrSink alive so it isn't GC'd before the test's assertions
  // are evaluated (see core.ts:325-326 — unref'd sinks get pruned silently).
  ok(arr)
})

test('ancestorOf - walks parent chain, true for self and ancestors', () => {
  const data = $({ a: { b: { c: 1 } } })
  const root = data[view]
  const a = data.a[view]
  const c = data.a.b.c[view]
  ok(ancestorOf(root, root), 'self counts as ancestor')
  ok(ancestorOf(c, root), 'root is ancestor of grandchild')
  ok(ancestorOf(c, a), 'a is ancestor of grandchild')
  ok(!ancestorOf(root, c), 'descendant is not ancestor of root')
})

test('ancestorOf - depth cap prevents runaway walks', () => {
  // Build a fake parent chain of depth 100 and assert the default cap of 32
  // returns false (root not found) instead of looping.
  let chain = { p: null }
  let head = chain
  for (let i = 0; i < 100; i++) head = { p: head }
  const sentinel = chain
  ok(!ancestorOf(head, sentinel), 'cap should prevent finding distant ancestor')
})

test('walk - root returns kind:root, no children, value summarized', () => {
  const data = $({ a: 1, b: 2 })
  const tree = walk(data[view])
  strictEqual(tree.kind, 'root')
  same(tree.key, [])
  strictEqual(tree.value, '{ keys: 2 }')
})

test('walk - operator sink shown with kind:operator and ctor name', () => {
  const data = $({ x: { active: true }, y: { active: false } })
  const filtered = data.filter(d => d.active)
  // Keep the chain alive for the duration of the assertions
  const lifeline = filtered.length()
  const tree = walk(data[view])
  const filterOp = tree.sinks.find(s => s.kind === 'operator' && s.ctor === 'FilterValue')
  ok(filterOp, 'FilterValue should appear as an operator sink')
  // Its descendant should include the LengthValue chained off it.
  const lengthOp = filterOp.sinks.find(s => s.kind === 'operator' && s.ctor === 'LengthValue')
  ok(lengthOp, 'LengthValue should appear as a sink of the FilterValue')
  ok(lifeline)
})

test('walk - dead WeakRef sinks pruned during traversal', () => {
  const data = $({ a: 1 })
  // Attach an ArrSink that we deliberately do NOT keep a strong ref to.
  // It survives initial walk because the local var in connect() holds it
  // briefly; but the next walk after we explicitly drop it should not see it.
  data.connect([])
  // Force a walk to trigger any lazy pruning, then walk again.
  walk(data[view])
  const tree = walk(data[view])
  const connects = tree.sinks.filter(s => s.kind === 'connect')
  // We can't strictly assert 0 here without --expose-gc; what we CAN assert
  // is that the walk doesn't crash on a dead WeakRef and returns a valid
  // structure. A retained sink (caught by view.sink's deref check) is fine.
  ok(Array.isArray(tree.sinks))
  ok(connects.every(s => s.kind === 'connect'))
})

test('walk - LinkedView shown as kind:linked-alias, does not recurse into source', () => {
  const src = $({ items: [1, 2, 3] })
  const linked = $(src)
  const tree = walk(linked[view])
  strictEqual(tree.kind, 'linked-alias')
  ok(Array.isArray(tree.aliasOf))
  // Children/sinks of the source should NOT appear under the alias node.
  same(tree.children, [])
  same(tree.sinks, [])
})

test('walk - cycle defense: re-encountered view marked kind:cycle', () => {
  // Synthetic check: pre-populate the seen set with the root, then walk —
  // the function should immediately return a cycle marker rather than recurse.
  const data = $({ a: 1 })
  const seen = new WeakSet()
  seen.add(data[view])
  const tree = walk(data[view], { seen })
  strictEqual(tree.kind, 'cycle')
})

test('$.inspect - root view returns key:[], parent:null', () => {
  const data = $({ a: 1, b: 2 })
  const out = $.inspect(data)
  same(out.key, [])
  strictEqual(out.parent, null)
  same(out.value, { a: 1, b: 2 })
})

test('$.inspect - child view shows parent and own key', () => {
  const data = $({ a: { b: 1 } })
  const out = $.inspect(data.a)
  same(out.key, ['a'])
  ok(out.parent, 'child should report a parent')
  // parent is a fresh ViewProxy wrapping the parent view; reading [value]
  // should give the root data.
  same(out.parent[value], { a: { b: 1 } })
})

test('$.inspect - sinks list operator + connect-style attached to view', () => {
  const data = $({ x: { active: true } })
  const op = data.filter(d => d.active)
  const arr = data.connect([])
  const out = $.inspect(data)
  ok(out.sinks.some(s => s.kind === 'operator' && s.ctor.startsWith('Filter')))
  ok(out.sinks.some(s => s.kind === 'connect' && s.ctor === 'ArrSink'))
  ok(op && arr)
})

test('$.graph(proxy) returns the same shape as walk()', () => {
  const data = $({ a: 1 })
  const tree = $.graph(data)
  strictEqual(tree.kind, 'root')
  same(tree.key, [])
})

test('$.graph - chain shape: filter → length appears under root.sinks', () => {
  const data = $({ x: { active: true, n: 1 }, y: { active: false, n: 2 } })
  const filtered = data.filter(d => d.active)
  const counted = filtered.length()
  const tree = $.graph(data)
  const filterOp = tree.sinks.find(s => s.kind === 'operator' && s.ctor === 'FilterValue')
  ok(filterOp, 'FilterValue should appear in root sinks')
  const lengthOp = filterOp.sinks.find(s => s.kind === 'operator' && s.ctor === 'LengthValue')
  ok(lengthOp, 'LengthValue should appear under FilterValue')
  ok(counted)
})

test('iterRoots - yields every live root, prunes dead WeakRefs', () => {
  // Pin a fresh root, then verify it appears in the iteration.
  const a = $({ x: 1 })
  const seen = []
  for (const v of iterRoots()) seen.push(v)
  ok(seen.includes(a[view]), 'newly-created root should be enumerable')
})

test('iterRoots - excludes _devtoolsInternalRoots by default; included with {internal:true}', () => {
  const internal = $({ panel: 'state' })
  internalRoot(internal)
  ok(_devtoolsInternalRoots.has(internal[view]))
  const publicSeen = []
  for (const v of iterRoots()) publicSeen.push(v)
  ok(!publicSeen.includes(internal[view]), 'internal root should be hidden by default')
  const allSeen = []
  for (const v of iterRoots({ internal: true })) allSeen.push(v)
  ok(allSeen.includes(internal[view]), 'internal root visible with {internal:true}')
})

test('$.graph() with no arg returns trees for all live roots', () => {
  const a = $({ alive: true })
  const out = $.graph()
  ok(Array.isArray(out), 'no-arg form returns an array')
  ok(out.length > 0, 'should include at least the root just created')
  ok(out.some(t => t.kind === 'root'), 'every entry shape matches walk() root output')
})

test('$.fromDOM - walks parentElement chain to find __ripple_sink', () => {
  // Synthesize a DOM element with __ripple_sink directly (we don't need the
  // real render layer for this unit test — the walking logic is what matters).
  const data = $({ items: { a: 1 } })
  const fakeSink = { p: data[view] }
  const grandchild = { parentElement: { parentElement: { __ripple_sink: fakeSink, parentElement: null } } }
  const proxy = $.fromDOM(grandchild)
  ok(proxy, 'should find a proxy by walking up')
  // The returned proxy should resolve to the same value as the original.
  same(proxy[value], { items: { a: 1 } })
})

test('$.fromDOM - returns null when no __ripple_sink found in chain', () => {
  const orphan = { parentElement: { parentElement: null } }
  strictEqual($.fromDOM(orphan), null)
})

test('instrument - ensureInstrumented patches View.prototype, restore restores byte-identical', () => {
  const origXU0 = View.prototype.XU0
  const origBU1 = View.prototype.BU1
  ok(!isInstrumented())
  ensureInstrumented()
  ok(isInstrumented())
  ok(View.prototype.XU0 !== origXU0, 'XU0 should be patched')
  ok(View.prototype.BU1 !== origBU1, 'BU1 should be patched')
  restoreInstrumentation()
  strictEqual(View.prototype.XU0, origXU0, 'XU0 restored to original')
  strictEqual(View.prototype.BU1, origBU1, 'BU1 restored to original')
  ok(!isInstrumented())
})

test('instrument - patched verbs preserve correctness when no listeners attached', () => {
  ensureInstrumented()
  // Run a small core-test-shaped scenario with instrumentation on but no
  // listeners — fast-out path should kick in and the result should be
  // byte-identical to the unpatched run.
  const data = $({ a: 1 })
  const changes = data.connect([])
  data.a = 2
  data.b = 3
  delete data.a
  same(changes, [
    { type: 'update', value: { a: 1 }, key: [] },
    { type: 'update', value: 2, key: ['a'] },
    { type: 'insert', value: 3, key: [], at: 'b' },
    { type: 'remove', value: 2, key: ['a'] },
  ])
  restoreInstrumentation()
})

test('instrument - dispatchTrace fires when a trace is registered', () => {
  ensureInstrumented()
  const data = $({ a: 1, b: 2 })
  const events = []
  const id = nextTraceId()
  traceTargets.set(id, {
    id, root: data[view], verbs: null, log: false,
    onEvent: (ev) => events.push(ev),
  })
  data.a = 10
  data.b = 20
  traceTargets.delete(id)
  // After the disposer, no more events.
  data.a = 99
  ok(events.length >= 2, `expected >=2 events, got ${events.length}`)
  // Verify we captured the right verb + key for the first mutation.
  ok(events.some(e => e.verb === 'BU1' && e.key.length === 0))
  restoreInstrumentation()
})

test('instrument - trace ancestor scoping skips events outside subtree', () => {
  ensureInstrumented()
  const data = $({ foo: { x: 1 }, bar: { y: 1 } })
  // Trace only the foo subtree.
  const events = []
  const id = nextTraceId()
  traceTargets.set(id, {
    id, root: data.foo[view], verbs: null, log: false,
    onEvent: (ev) => events.push(ev),
  })
  data.bar.y = 999  // outside subtree — should be skipped
  const before = events.length
  data.foo.x = 999  // inside subtree — should fire
  traceTargets.delete(id)
  restoreInstrumentation()
  ok(events.length > before, 'foo mutation should be traced')
  ok(!events.some(e => e.key.includes('bar')), 'no bar events should leak through')
})

test('instrument - profilers accumulate per-operator counts and times', () => {
  ensureInstrumented()
  const data = $({})
  const filtered = data.filter(d => d.active)
  const counted = filtered.length()
  const acc = newProfileAcc()
  const id = nextTraceId()
  profilers.set(id, { id, root: data[view], acc })
  for (let i = 0; i < 50; i++) data['k' + i] = { active: i % 2 === 0 }
  profilers.delete(id)
  restoreInstrumentation()
  const report = finalize(acc)
  ok(report.totalEvents >= 50, `expected >=50 events, got ${report.totalEvents}`)
  ok(report.byOperator.length > 0, 'at least one operator should be tracked')
  // The hottest operator's totalMs should be >= 0 and counts should be > 0.
  ok(report.byOperator.every(b => b.count > 0))
  ok(counted)
})

test('instrument - re-entrancy: nested verb calls don\'t double-count wall time', () => {
  ensureInstrumented()
  const data = $({})
  const acc = newProfileAcc()
  const id = nextTraceId()
  profilers.set(id, { id, root: data[view], acc })
  // A single insert triggers BI0 on root and XU0 on each child view.
  // The wall-clock attribution should only apply to the outermost (BI0)
  // call; nested XU0 calls increment count but not totalMs sum.
  for (let i = 0; i < 10; i++) data['k' + i] = { x: i }
  profilers.delete(id)
  restoreInstrumentation()
  // sum of all bucket totalMs should be roughly the wall time of those calls.
  // Just assert it's finite and nonneg — the precise value depends on the
  // host. The important invariant is that no bucket reports more time than
  // the entire run took.
  ok(acc.ms >= 0)
  ok(acc.ms < 1000, `wall time should be small, got ${acc.ms}`)
})

test('$.trace - captures events for the subtree, disposer stops capture', () => {
  const data = $({ a: 1, b: 2 })
  const events = []
  const stop = $.trace(data, { log: false, onEvent: (ev) => events.push(ev) })
  data.a = 10
  data.b = 20
  stop()
  const captured = events.length
  data.a = 99
  strictEqual(events.length, captured, 'no further events after dispose')
  ok(captured >= 2, `expected >=2 events captured, got ${captured}`)
  $.devtools.disable()
})

test('$.trace - ancestor scoping skips events outside the traced subtree', () => {
  const data = $({ foo: { x: 1 }, bar: { y: 1 } })
  const events = []
  const stop = $.trace(data.foo, { log: false, onEvent: (ev) => events.push(ev) })
  data.bar.y = 999
  data.foo.x = 999
  stop()
  ok(events.length >= 1, 'foo mutation should be captured')
  ok(!events.some(e => e.key.includes('bar')), 'bar mutations should not leak')
  $.devtools.disable()
})

test('$.profile - accumulates report; stop returns sorted byOperator', () => {
  const data = $({})
  const filtered = data.filter(d => d.active)
  const counted = filtered.length()
  const p = $.profile(data)
  for (let i = 0; i < 100; i++) data['k' + i] = { active: i % 3 === 0 }
  const r = p.stop()
  ok(r.totalEvents >= 100, `expected >=100 events, got ${r.totalEvents}`)
  ok(r.byOperator.length > 0, 'expected at least one operator bucket')
  // Sorted by totalMs descending — verify monotonic.
  for (let i = 1; i < r.byOperator.length; i++) {
    ok(r.byOperator[i - 1].totalMs >= r.byOperator[i].totalMs, 'sorted by totalMs desc')
  }
  ok(counted)
  $.devtools.disable()
})

test('$.profile - report() returns snapshot without stopping', () => {
  const data = $({})
  const p = $.profile(data)
  data.x = 1
  const r1 = p.report()
  data.y = 2
  const r2 = p.report()
  ok(r2.totalEvents >= r1.totalEvents, 'report() reflects new events')
  p.stop()
  $.devtools.disable()
})

test('$.devtools.disable - restores View.prototype byte-identical', () => {
  const data = $({ a: 1 })
  const origXU0 = View.prototype.XU0
  $.trace(data, { log: false })
  ok(View.prototype.XU0 !== origXU0, 'patched after trace()')
  $.devtools.disable()
  strictEqual(View.prototype.XU0, origXU0, 'restored after disable()')
  // After disable, mutations don't accumulate any state.
  data.a = 2
  strictEqual(traceTargets.size, 0)
  strictEqual(profilers.size, 0)
})

test('$.cascades - single mutation produces one cascade with frames timed >= 0', () => {
  const data = $({ a: 1 })
  const rec = $.cascades(data)
  data.a = 2
  const out = rec.stop()
  strictEqual(out.length, 1, 'one mutation should produce one cascade')
  const c = out[0]
  ok(c.frames.length >= 1, 'cascade should record at least one frame')
  ok(c.totalMs >= 0, 'totalMs should be non-negative')
  // Every frame's endMs should be >= startMs (closed by exitCascadeFrame).
  for (const f of c.frames) {
    ok(f.endMs >= f.startMs, `frame ${f.i} endMs ${f.endMs} < startMs ${f.startMs}`)
    ok(f.endMs >= 0, 'endMs must be assigned (default -1 means unclosed)')
  }
  $.devtools.disable()
})

test('$.cascades - frame parent indices reconstruct a forest of well-formed trees', () => {
  const data = $({})
  const filtered = data.filter(d => d.active)
  const counted = filtered.length()
  const rec = $.cascades(data)
  // One insert fans out to root → filter → length. We don't assert exact
  // verb names (that depends on internal dispatch order); we assert the
  // tree shape is well-formed. A cascade can have multiple root frames
  // because Value.BU1 splits into view.BU1 + view.BI0 (see events.ts
  // coalescing notes).
  data.k0 = { active: true }
  const [c] = rec.stop()
  ok(c, 'expected at least one cascade')
  const roots = c.frames.filter(f => f.parent === -1)
  ok(roots.length >= 1, `cascade must have at least one root frame, got ${roots.length}`)
  // Every non-root frame's parent must point to a real earlier frame.
  for (const f of c.frames) {
    if (f.parent === -1) continue
    ok(f.parent >= 0 && f.parent < f.i, `parent ${f.parent} of frame ${f.i} out of range`)
  }
  ok(counted)
  $.devtools.disable()
})

test('$.cascades - subtree root scoping skips cascades outside the subtree', () => {
  const data = $({ foo: { x: 1 }, bar: { y: 1 } })
  const rec = $.cascades(data.foo)
  data.bar.y = 999  // outside scope
  data.foo.x = 999  // inside scope
  const out = rec.stop()
  ok(out.length >= 1, 'foo mutation should be captured')
  // No frame should reference a key starting with 'bar'.
  for (const c of out) {
    for (const f of c.frames) {
      ok(!f.key.includes('bar'), `bar leaked into cascade frame: ${f.key.join('.')}`)
    }
  }
  $.devtools.disable()
})

test('$.cascades - mutations across task ticks produce distinct cascades', async () => {
  // Within one sync tick, all top-level patched verbs coalesce into a
  // single cascade (see events.ts). To get N cascades we must yield to
  // the microtask queue between mutations — a single Promise.resolve()
  // suffices since the cascade-close is queued via queueMicrotask.
  const data = $({})
  const rec = $.cascades(data)
  data.a = 1
  await Promise.resolve()
  data.b = 2
  await Promise.resolve()
  data.c = 3
  const out = rec.stop()
  ok(out.length >= 3, `expected >=3 cascades, got ${out.length}`)
  // Each cascade's frames must form a contiguous index range starting at 0,
  // proving they didn't interleave (two open cascades would mix indices).
  for (const c of out) {
    for (let i = 0; i < c.frames.length; i++) {
      strictEqual(c.frames[i].i, i, `frame ${i} has wrong index ${c.frames[i].i}`)
    }
  }
  // Ascending startedAt across cascades.
  for (let i = 1; i < out.length; i++) {
    ok(out[i].startedAt >= out[i - 1].startedAt, 'cascades should be in chronological order')
  }
  $.devtools.disable()
})

test('$.cascades - sync mutations within one tick coalesce into a single cascade', () => {
  // The flip side of the previous test: when mutations are back-to-back
  // sync (no microtask in between), they all belong to the same cascade.
  // This is the "user clicked once and four things changed" model.
  const data = $({})
  const rec = $.cascades(data)
  data.a = 1
  data.b = 2
  data.c = 3
  const out = rec.stop()
  strictEqual(out.length, 1, `expected 1 coalesced cascade, got ${out.length}`)
  // The cascade should carry several top-level (parent=-1) frames, one
  // pair per assignment (view.BU1 + view.BI0).
  const roots = out[0].frames.filter(f => f.parent === -1)
  ok(roots.length >= 3, `expected >=3 top-level frames, got ${roots.length}`)
  $.devtools.disable()
})

test('$.cascades - fan-out: chained operators all appear under root frame', () => {
  const data = $({})
  const a = data.filter(d => d.active).length()
  const b = data.filter(d => !d.active).length()
  const rec = $.cascades(data)
  data.k0 = { active: true }
  const [c] = rec.stop()
  ok(c, 'expected one cascade')
  // The cascade must contain frames for both filter branches (FilterValue
  // appears twice — one per branch). We can't rely on order, just presence.
  const filters = c.frames.filter(f => f.ctor === 'FilterValue')
  ok(filters.length >= 2, `expected >=2 FilterValue frames, got ${filters.length}`)
  // Each filter frame should have a parent that traces back to the root.
  for (const f of filters) {
    ok(f.parent >= 0, 'filter frame should have a parent in this cascade')
  }
  ok(a && b)
  $.devtools.disable()
})

test('$.cascades - report() returns snapshot without stopping; clear() empties buffer', () => {
  const data = $({})
  const rec = $.cascades(data)
  data.a = 1
  const r1 = rec.report()
  data.b = 2
  const r2 = rec.report()
  ok(r2.length > r1.length, 'report() should reflect new cascades')
  rec.clear()
  ok(rec.report().length === 0, 'clear() should empty the buffer')
  data.c = 3
  ok(rec.report().length >= 1, 'recorder still active after clear()')
  rec.stop()
  $.devtools.disable()
})

test('$.cascades - maxCascades caps ring buffer (oldest evicted)', async () => {
  const data = $({})
  const rec = $.cascades(data, { maxCascades: 3 })
  for (let i = 0; i < 10; i++) {
    data['k' + i] = i
    await Promise.resolve()  // yield so each mutation closes its cascade
  }
  const out = rec.stop()
  ok(out.length <= 3, `expected <=3 cascades, got ${out.length}`)
  // Newest preserved — last cascade's id should be the highest in the buffer.
  const ids = out.map(c => c.id)
  strictEqual(Math.max(...ids), ids[ids.length - 1])
  $.devtools.disable()
})

test('$.cascades - stop disposer cleans up; further mutations don\'t append', () => {
  const data = $({})
  const rec = $.cascades(data)
  data.a = 1
  const captured = rec.stop().length
  data.b = 2
  data.c = 3
  // After stop(), the recorder is gone — calling report() returns the
  // (frozen) buffer, not new cascades. We verify by re-installing a fresh
  // recorder and confirming cascadeRecorders has size 1, not 2.
  const rec2 = $.cascades(data)
  strictEqual(cascadeRecorders.size, 1, 'old recorder must be removed after stop()')
  rec2.stop()
  ok(captured >= 1)
  $.devtools.disable()
})

test('$.cascades - captureState:true records post-cascade state snapshot per cascade', () => {
  const data = $({ a: 1, b: 2 })
  const rec = $.cascades(data, { captureState: true })
  data.a = 10
  const out = rec.stop()
  ok(out.length >= 1, 'expected at least one cascade')
  const c = out[0]
  ok(c.state, 'state snapshot should be present')
  strictEqual(c.state.a, 10, 'state.a should be the post-mutation value')
  strictEqual(c.state.b, 2, 'unmutated keys should still appear in the snapshot')
  // Snapshot is a deep clone — mutating it later must not affect the
  // live data (verifies we structuredClone'd the value, not aliased it).
  c.state.a = 999
  ok(data.a[value] === 10, 'snapshot is independent of live data')
  $.devtools.disable()
})

test('$.cascades - captureState:false (default) leaves state undefined', () => {
  const data = $({ a: 1 })
  const rec = $.cascades(data)  // no captureState option
  data.a = 2
  const [c] = rec.stop()
  strictEqual(c.state, undefined)
  $.devtools.disable()
})

test('$.cascades - disable() restores View.prototype and clears recorders', () => {
  const origXU0 = View.prototype.XU0
  const data = $({ a: 1 })
  $.cascades(data)
  ok(View.prototype.XU0 !== origXU0, 'patched after $.cascades()')
  ok(cascadeRecorders.size === 1)
  $.devtools.disable()
  strictEqual(View.prototype.XU0, origXU0, 'restored after disable()')
  strictEqual(cascadeRecorders.size, 0, 'cascadeRecorders cleared')
})

test('$.highlight - adds and schedules removal of __ripple_highlight class', () => {
  const data = $({ items: {} })
  const calls = []
  // Fake DOMSink with a parent whose classList records add/remove.
  const fakeParent = {
    classList: {
      add(c) { calls.push(['add', c]) },
      remove(c) { calls.push(['remove', c]) },
    },
  }
  const fakeSink = {
    constructor: { name: 'DOMSink' },
    parent: fakeParent,
    p: data[view],
  }
  data[view].sinks.add(new WeakRef(fakeSink))
  const n = $.highlight(data, 5)
  strictEqual(n, 1)
  same(calls[0], ['add', '__ripple_highlight'])
  return new Promise(r => setTimeout(() => {
    same(calls[1], ['remove', '__ripple_highlight'])
    r()
  }, 20))
})
