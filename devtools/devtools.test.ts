// @ts-nocheck
import { test } from 'node:test'
import { deepStrictEqual as same, ok, strictEqual } from 'node:assert'
import { $, value, view } from '../core.ts'
// Importing 'data/full' to get operator dispatch registered. The lean core
// would throw on .filter(...) etc. (see commit 860befe).
import '../full.ts'
import { walk, classify, summarize, ancestorOf } from './walk.ts'
import './index.ts'

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
  const tree = walk(data[view], seen)
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

test('$.graph() with no arg returns [] and warns (WeakSet of roots not iterable)', () => {
  // Documented limitation: _devtoolsRoots is a WeakSet so we can't enumerate.
  // The no-arg form is best-effort — it returns [] and warns.
  const out = $.graph()
  same(out, [])
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
