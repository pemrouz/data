// v3/render/component.test.ts — the M4.5b component layer: component() /
// onCleanup() lifecycle scopes and boundary() error slots.
//
// Mock DOM installed before any render() (the dom.test.ts discipline); every
// case pins one line of the contract in the render-module header. Covers:
// onCleanup() outside a scope throws (fail-fast, not a silent leak); the
// component fn is deferred to MOUNT and invoked ONCE (record creation is
// inert), cleanups run LIFO on dispose; row-hosted components clean up when
// THAT row is removed and no other; component as row ROOT (renders, rebuilds
// on update, and the two-root throw); boundary() as row ROOT throws with the
// wrap-it hint; multi-root expansion in order + null / scalar-view returns;
// bare row fns are NOT a scope (onCleanup throws at initial render, and
// surfaces as the write's AggregateError on the no-boundary add path);
// component-child patching (changed props = row rebuild in place with a fresh
// invocation and the old instance's cleanup; an identical record = the
// mounted instance stands, element identity kept); boundary mount-phase
// (fallback mounts SYNCHRONOUSLY with the thrown error, nothing escapes
// render()) vs effect-phase (rtext / bind() / row-fn throws are contained —
// the triggering write returns, the swap lands after exactly ONE microtask,
// anchored BEFORE later siblings, and the try subtree's subscriptions are
// disposed); reset() re-mounts the try child (and falls back again on a
// repeat error); nested boundaries (the inner FALLBACK mounts under the OUTER
// boundary, so its effect-phase error escalates outward); and the unchanged
// no-boundary kernel contract (an effect throw collects into the commit's
// AggregateError).

import { test } from 'node:test'
import assert from 'node:assert'
import { installMockDom, El } from './mock-dom.ts'

const dom = installMockDom() // must precede any render() call

import { Runtime } from '../kernel/runtime.ts'
import { SourceNode } from '../kernel/node.ts'
import { onCleanup, Scope, runInScope } from '../kernel/scope.ts'
import { sum } from '../ops/aggregate.ts'
import { render, el, text, list, bind, component, boundary } from './index.ts'

const same = assert.deepStrictEqual
const eq = assert.strictEqual
const ok = assert.ok

// BoundarySlot.handle()/reset() defer their swap by queueMicrotask, enqueued
// during the triggering write — so ONE resolved-promise hop lands it.
const tick = () => Promise.resolve()

type Row = { t: string; val?: number; bad?: boolean }

function host(): El {
  return dom.document.createElement('host')
}

function scalar() {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { t: 'A', val: 2 }, b: { t: 'B', val: 3 } })
  return { rt, src, s: sum(src, 'val') } // s starts at 5
}

// ── onCleanup ────────────────────────────────────────────────────────────────

test('onCleanup() outside any scope THROWS — a cleanup that would never run is a leak, not a no-op', () => {
  assert.throws(() => onCleanup(() => {}), /outside a scope/)
})

// ── component lifecycle ──────────────────────────────────────────────────────

test('component(): the fn is deferred to MOUNT (record creation is inert) and invoked ONCE; onCleanup fires on dispose, LIFO', () => {
  let calls = 0
  const order: string[] = []
  const rec = component(() => {
    calls++
    onCleanup(() => order.push('first-registered'))
    onCleanup(() => order.push('second-registered'))
    return el('div', { class: 'c' }, 'x')
  })
  eq(rec.kind, 'component')
  eq(calls, 0) // component() built a record — nothing ran
  const h = host()
  const handle = render(h, rec)
  eq(calls, 1) // mount invoked it, exactly once
  eq(h.text, 'x')
  same(order, []) // cleanups are registrations, not calls
  handle.dispose()
  eq(calls, 1) // dispose never re-invokes
  same(order, ['second-registered', 'first-registered']) // LIFO
  eq(h.children.length, 0)
})

test('a component INSIDE a row: its onCleanup fires when THAT row is removed — other rows untouched', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { t: 'A' }, b: { t: 'B' } })
  const cleaned: unknown[] = []
  const h = host()
  render(h, el('ul', null, list(src, (r: Row, k) =>
    el('li', null, component(() => {
      onCleanup(() => cleaned.push(k))
      return el('i', null, r.t)
    })),
  )))
  eq(h.text, 'AB')
  same(cleaned, [])
  src.remove('a') // the row dies → its component scope disposes
  eq(h.text, 'B')
  same(cleaned, ['a']) // ONLY the removed row's cleanup ran
})

test('component as the row ROOT: resolves to ONE element, renders, and a row update rebuilds it; TWO roots throw', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { t: 'A' }, b: { t: 'B' } })
  const h = host()
  render(h, list(src, (r: Row) => component(() => el('li', null, r.t))))
  eq(h.text, 'AB')
  src.write('c', [], { t: 'C' }) // add through the component row root
  eq(h.text, 'ABC')
  src.write('a', ['t'], 'A2') // fresh per-row fn identity → structural rebuild in place
  eq(h.text, 'A2BC')

  // a component row root must return exactly ONE root — the keyed sink
  // places one stable element per row
  const h2 = host()
  assert.throws(
    () => render(h2, list(src, () => component(() => [el('i', null, 'a'), el('i', null, 'b')]))),
    /exactly ONE root/,
  )
})

test('boundary() as the row ROOT throws with the wrap-it hint (a swap could not keep rec.el stable)', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { t: 'A' } })
  const h = host()
  assert.throws(
    () => render(h, list(src, () => boundary(el('i', null, 'x'), () => el('b', null, 'fb')))),
    /row ROOT/,
  )
})

test('multi-root component: the returned array expands IN ORDER into its parent; dispose removes every root', () => {
  // at the mount root: both tops collected through the dom-less component Mounted
  const h = host()
  const handle = render(h, component(() => [el('i', null, 'a'), el('i', null, 'b')]))
  eq(h.text, 'ab')
  eq(h.children.length, 2)
  handle.dispose()
  eq(h.children.length, 0) // BOTH roots removed

  // between static siblings: the expansion lands at the component's position
  const h2 = host()
  render(h2, el('div', null, 'pre', component(() => [el('i', null, 'a'), el('i', null, 'b')]), 'post'))
  eq(h2.text, 'preabpost')
  eq(h2.children[0].children.length, 4)
})

test('component returning null renders NOTHING; returning a scalar view renders live reactive text', () => {
  const h = host()
  render(h, component(() => null))
  eq(h.children.length, 0)
  eq(h.text, '')

  const { src, s } = scalar()
  const h2 = host()
  render(h2, el('span', null, component(() => s))) // normChildren: a scalar node → text(s)
  eq(h2.text, '5')
  src.write('a', ['val'], 7) // sum 5 → 10
  eq(h2.text, '10') // a live binding, not a mount-time snapshot
})

// ── row fns are NOT a scope ──────────────────────────────────────────────────

test('onCleanup in a BARE row fn throws at initial render — row fns re-run on updates and are not a scope', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { t: 'A' } })
  const h = host()
  assert.throws(
    () =>
      render(h, list(src, (r: Row) => {
        onCleanup(() => {})
        return el('li', null, r.t)
      })),
    /outside a scope/,
  )
})

test('onCleanup in a bare row fn on the ADD path (no boundary): the write throws the commit AggregateError', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { t: 'A' } })
  const h = host()
  render(h, list(src, (r: Row) => {
    if (r.bad) onCleanup(() => {}) // only the added row trips it
    return el('li', null, r.t)
  }))
  eq(h.text, 'A')
  let err: any
  try {
    src.write('c', [], { t: 'C', bad: true })
  } catch (e) {
    err = e
  }
  ok(err instanceof AggregateError) // the kernel collects effect errors per commit
  assert.match(err.errors[0].message, /outside a scope/)
})

// ── component-child patching on row updates ──────────────────────────────────

test('row update, component child with CHANGED props: row rebuilds in place — old cleanup ran, fresh invocation, position kept', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { t: 'A' }, b: { t: 'B' } })
  let calls = 0
  let cleanups = 0
  const Inner = (p: { row: Row }) => {
    calls++
    onCleanup(() => cleanups++)
    return el('i', null, p.row.t)
  }
  const h = host()
  render(h, list(src, (r: Row) => el('li', null, component(Inner, { row: r }))))
  eq(h.text, 'AB')
  eq(calls, 2)
  const liA = h.children[0]
  const liB = h.children[1]

  src.write('a', ['t'], 'A2') // path-copy mints a new row reference → props changed
  eq(h.text, 'A2B')
  eq(calls, 3) // a fresh invocation for a's rebuilt row
  eq(cleanups, 1) // the OLD instance's onCleanup ran
  ok(h.children[0] !== liA) // rebuilt: a fresh element…
  eq(h.children[1], liB) // …at the SAME list position — b untouched after it
})

test('row update, IDENTICAL component child (same fn, no props): NOT re-invoked, element identity preserved', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { t: 'A' } })
  let calls = 0
  let cleanups = 0
  const Static = () => {
    calls++
    onCleanup(() => cleanups++)
    return el('b', null, '!')
  }
  const h = host()
  render(h, list(src, (r: Row) => el('li', null, r.t, component(Static))))
  eq(h.text, 'A!')
  eq(calls, 1)
  const liA = h.children[0]
  dom.reset()
  src.write('a', ['t'], 'A2')
  eq(h.text, 'A2!') // the text sibling patched…
  eq(calls, 1) // …but same fn + shallow-equal props → the mounted instance stands
  eq(cleanups, 0)
  eq(h.children[0], liA) // patched, not rebuilt
  eq(dom.ops.created, 0)
})

// ── boundary: mount phase ────────────────────────────────────────────────────

test('boundary(): a mount-phase component throw never escapes render(); fallback(err) mounts SYNCHRONOUSLY with the thrown error', () => {
  const boom = new Error('boom-mount')
  let caught: unknown
  const h = host()
  render(h, boundary(
    component(() => { throw boom }),
    (err) => {
      caught = err
      return el('div', { class: 'fb' }, 'fallback')
    },
  )) // ← no throw escapes
  eq(caught, boom) // err IS the thrown error
  eq(h.text, 'fallback') // synchronous — mount-phase needs no microtask
  eq(h.children[0].attrs.class, 'fb')
})

// ── boundary: effect phase (deferred one microtask) ──────────────────────────

test('boundary(): an effect-phase rtext throw is CONTAINED — the write returns, the swap lands after ONE microtask, try doms gone', async () => {
  const { src, s } = scalar() // s = 5
  const fmt = (v: number) => {
    if (v > 5) throw new Error('boom-effect')
    return 'v' + v
  }
  const h = host()
  render(h, boundary(
    el('div', { class: 'try' }, text(s, fmt)),
    (err) => el('div', { class: 'fb' }, 'fb:', (err as Error).message),
  ))
  eq(h.text, 'v5')
  const tryDiv = h.children[0]

  src.write('a', ['val'], 7) // sum 5 → 10, fmt throws — the write MUST NOT throw
  eq(h.text, 'v5') // deferred exactly one microtask: nothing swapped yet
  eq(tryDiv.parentNode, h)
  await tick()
  eq(h.text, 'fb:boom-effect')
  eq(tryDiv.parentNode, null) // the try subtree's doms are gone
})

test("boundary(): an effect-phase bind() ATTRIBUTE throw routes the same way", async () => {
  const { src, s } = scalar()
  const h = host()
  render(h, boundary(
    el('div', {
      'data-v': bind(s, (v: number) => {
        if (v > 5) throw new Error('boom-attr')
        return 'v' + v
      }),
    }),
    (err) => el('div', null, 'fb:', (err as Error).message),
  ))
  eq(h.children[0].attrs['data-v'], 'v5')
  src.write('a', ['val'], 7) // contained — no AggregateError
  await tick()
  eq(h.text, 'fb:boom-attr')
})

test('boundary(): a row fn throwing during an ADD is contained; the fallback replaces the list and its subscription dies', async () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { t: 'A' } })
  const h = host()
  render(h, boundary(
    el('ul', null, list(src, (r: Row) => {
      if (r.bad) throw new Error('boom-row')
      return el('li', null, r.t)
    })),
    (err) => el('div', null, 'fb:', (err as Error).message),
  ))
  eq(h.text, 'A')
  eq(src.effects.length, 1) // the list sink
  src.write('c', [], { t: 'C', bad: true }) // guarded list apply — the write returns
  await tick()
  eq(h.text, 'fb:boom-row')
  eq(src.effects.length, 0) // the list subscription died with the try scope
})

test('boundary swap with a LATER SIBLING: the fallback lands at the boundary ANCHOR, before the sibling — not appended', async () => {
  const { src, s } = scalar()
  const fmt = (v: number) => {
    if (v > 5) throw new Error('x')
    return String(v)
  }
  const h = host()
  render(h, [
    boundary(el('div', { class: 'try' }, text(s, fmt)), () => el('div', { class: 'fb' }, 'FB')),
    el('footer', null, 'after'),
  ])
  same(h.children.map((c) => c.tag), ['div', '#text', 'footer']) // try, anchor, sibling
  eq(h.text, '5after')
  src.write('a', ['val'], 7)
  await tick()
  same(h.children.map((c) => c.tag), ['div', '#text', 'footer']) // same positions…
  eq(h.children[0].attrs.class, 'fb') // …but the div is now the FALLBACK
  eq(h.text, 'FBafter') // ordered BEFORE the sibling, not at the end
})

test('boundary swap disposes the try subtree subscriptions — the view effects count drops (no leak)', async () => {
  const { src, s } = scalar()
  const fmt = (v: number) => {
    if (v > 5) throw new Error('x')
    return String(v)
  }
  const h = host()
  render(h, boundary(
    el('div', null, text(s, fmt), el('i', { 'data-v': bind(s, (v: number) => String(v)) })),
    () => el('div', null, 'fb'), // static fallback — no new subscription
  ))
  eq(s.effects.length, 2) // rtext + bind, both owned by the try scope
  src.write('a', ['val'], 7)
  await tick()
  eq(h.text, 'fb')
  eq(s.effects.length, 0) // torn down with the try scope — nothing left subscribed
})

// ── reset ────────────────────────────────────────────────────────────────────

test('reset(): re-mounts the try child after one microtask (fresh invocation); a still-broken try falls back again', async () => {
  let shouldThrow = true
  let calls = 0
  let resetFn: (() => void) | null = null
  const Try = () => {
    calls++
    if (shouldThrow) throw new Error('boom')
    return el('div', null, 'ok')
  }
  const h = host()
  render(h, boundary(component(Try), (_err, reset) => {
    resetFn = reset
    return el('div', null, 'fb')
  }))
  eq(h.text, 'fb') // mount-phase error → fallback, synchronously
  eq(calls, 1)

  resetFn!() // retry while STILL broken → fresh invocation, fallback again
  await tick()
  eq(h.text, 'fb')
  eq(calls, 2)

  shouldThrow = false
  resetFn!() // retry after the fix
  eq(h.text, 'fb') // deferred one microtask, like handle()
  await tick()
  eq(h.text, 'ok') // the try child re-mounted
  eq(calls, 3)
})

// ── nested boundaries ────────────────────────────────────────────────────────

test('nested boundaries: the inner FALLBACK mounts under the OUTER boundary — its effect-phase error ESCALATES outward', async () => {
  const { src, s } = scalar()
  const fmt = (v: number) => {
    if (v > 5) throw new Error('boom-outer')
    return 'v' + v
  }
  const h = host()
  render(h, boundary(
    el('section', null,
      boundary(
        component(() => { throw new Error('boom-inner') }),
        () => el('div', null, 'inner-fb:', text(s, fmt)), // the inner FALLBACK carries a live binding
      ),
    ),
    (err) => el('div', null, 'outer-fb:', (err as Error).message),
  ))
  eq(h.text, 'inner-fb:v5') // inner mount error → inner fallback, synchronously
  src.write('a', ['val'], 7) // the inner fallback's rtext throws → routed to the OUTER (not looping on the inner)
  await tick()
  eq(h.text, 'outer-fb:boom-outer')
})

// ── no boundary: the kernel contract is unchanged ────────────────────────────

test('NO boundary: an effect-phase rtext throw keeps the kernel contract — the triggering write throws AggregateError', () => {
  const { src, s } = scalar()
  const h = host()
  render(h, el('div', null, text(s, (v: number) => {
    if (v > 5) throw new Error('boom-plain')
    return String(v)
  })))
  eq(h.text, '5')
  let err: any
  try {
    src.write('a', ['val'], 7)
  } catch (e) {
    err = e
  }
  ok(err instanceof AggregateError)
  eq(err.errors.length, 1)
  eq(err.errors[0].message, 'boom-plain')
})

// ── review fixes (2026-07-12, the component-scopes adversarial review) ───────
// Exception-safe mounts, subtree-scoped registration, structural patch
// equality, and the update-path null-scope — each test bites on the pre-fix
// code (leaked subscriptions, ghost DOM, whole-row rebuilds).

test('REVIEW FIX: mount-phase rowFn throw in the list constructor under a boundary — no ghost rows/anchor, no leaked subscriptions', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { t: 'A', val: 2 }, b: { t: 'B', val: 3 } })
  const s = sum(src, 'val')
  const h = host()
  render(
    h,
    boundary(
      list(src, (r: Row) => {
        if (r.t === 'B') throw new Error('boom-ctor')
        return el('li', null, text(s))
      }),
      (err: unknown) => el('em', null, 'fb:' + (err as Error).message),
    ),
  )
  eq(h.text, 'fb:boom-ctor') // fallback mounted synchronously
  ok(!h.children.some((c: any) => c.tag === 'li')) // row A's element did not linger
  eq(s.effects.length, 0) // row A's rtext subscription died with the partial
  eq(src.effects.length, 0) // the list sink never left a connection behind
})

test("REVIEW FIX: an add-path row-build throw under a boundary disposes the partial row's bindings — no orphans left firing", async () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { t: 'A', val: 2 } })
  const s = sum(src, 'val')
  const h = host()
  render(
    h,
    boundary(
      list(src, (r: Row) =>
        r.bad
          ? el('li', null, text(s), text(s, () => {
              throw new Error('boom-row')
            }))
          : el('li', null, text(s)),
      ),
      (err: unknown) => el('em', null, 'fb:' + (err as Error).message),
    ),
  )
  eq(s.effects.length, 1) // row a's binding
  src.write('b', [], { t: 'B', val: 4, bad: true }) // 1st rtext connects, 2nd throws at read
  await tick()
  eq(h.text, 'fb:boom-row')
  eq(s.effects.length, 0) // the partial's binding AND row a's died — nothing orphaned
  eq(src.effects.length, 0)
})

test('REVIEW FIX: a multi-root component whose later root throws removes the roots already placed', () => {
  const { s } = scalar()
  const h = host()
  render(
    h,
    boundary(
      component(() => [
        el('i', null, 'first'),
        el('b', null, text(s, () => {
          throw new Error('boom-root2')
        })),
      ]),
      (err: unknown) => el('em', null, 'fb:' + (err as Error).message),
    ),
  )
  eq(h.text, 'fb:boom-root2')
  ok(!h.children.some((c: any) => c.tag === 'i')) // the placed first root was removed
  eq(s.effects.length, 0)
})

test('REVIEW FIX: boundary subtrees register on the SUBTREE scope only — error→reset cycles keep the mount scope flat', async () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { t: 'A', val: 2 } })
  const s = sum(src, 'val')
  const h = host()
  const handle = render(
    h,
    boundary(
      el('div', null, text(s, (v: number) => {
        if (v > 90) throw new Error('boom')
        return String(v)
      })),
      (_e: unknown, reset: () => void) => el('em', { onClick: () => reset() }, 'fb'),
    ),
  )
  const owned = (handle.scope as any).owned as Set<unknown>
  const baseline = owned.size // the boundary slot only — NOT the subtree's subscriptions
  for (let i = 0; i < 3; i++) {
    src.write('a', ['val'], 91) // trip → fallback
    await tick()
    eq(h.text, 'fb')
    src.write('a', ['val'], 2) // heal while the fallback shows (it has no s binding)
    const em = h.children.find((c: any) => c.tag === 'em')
    ;(em.handlers[0].fn as () => void)() // reset
    await tick()
    eq(h.text, '2')
  }
  eq(owned.size, baseline) // pre-fix: every cycle piled dead handles onto the mount scope
  eq(s.effects.length, 1) // exactly the live try binding
  handle.dispose()
  eq(s.effects.length, 0)
})

test('REVIEW FIX: a nested list built during an add over a view that ALSO changed this commit does not duplicate rows', () => {
  const rt = new Runtime()
  const outer = new SourceNode<Row>(rt, { a: { t: 'A', val: 1 } })
  const inner = new SourceNode<Row>(rt, { x: { t: 'X', val: 1 } })
  const h = host()
  render(
    h,
    el('ul', null, list(outer, (r: Row) =>
      el('li', null, el('span', null, r.t), list(inner, (ir: Row) => el('i', null, ir.t))),
    )),
  )
  eq(h.text, 'AX')
  rt.batch(() => {
    outer.write('b', [], { t: 'B', val: 2 })
    inner.write('y', [], { t: 'Y', val: 2 })
  })
  // row B's nested list snapshotted {x, y} at build (mid-effect); inner's own
  // batch must NOT re-apply y to it (bornSeq) — pre-fix rendered 'AXYBXYY'.
  eq(h.text, 'AXYBXY')
})

test('REVIEW FIX: onCleanup in a row fn throws on the UPDATE path too, even when a scope is ambient at write time', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { t: 'A', val: 1 } })
  const h = host()
  render(
    h,
    el('ul', null, list(src, (r: Row) => {
      if (r.bad) onCleanup(() => {})
      return el('li', null, r.t)
    })),
  )
  // an ambient scope at write time (a write issued from inside a component
  // fn) must not become a silent registration target for the re-run rowFn
  const sc = new Scope(null)
  let err: unknown
  try {
    runInScope(sc, () => src.write('a', [], { t: 'A2', val: 1, bad: true }))
  } catch (e) {
    err = e
  }
  ok(err instanceof AggregateError)
  ok(/outside a scope/.test(((err as AggregateError).errors[0] as Error).message))
  sc.dispose()
})

test('REVIEW FIX: a component child with structurally-unchanged children survives row updates; it rebuilds only when its inputs move', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { t: 'A', val: 1 } })
  let calls = 0
  const Chip = (p: any) => (calls++, el('em', null, ...(p.children ?? [])))
  const h = host()
  render(
    h,
    el('ul', null, list(src, (r: Row) =>
      el('li', null,
        el('span', null, String(r.val)),
        component(Chip, { children: [{ kind: 'text', s: r.t }] }),
      ),
    )),
  )
  eq(calls, 1)
  const li = h.children[0].children[0]
  src.write('a', ['val'], 2) // t unchanged → children records structurally equal → NO rebuild
  eq(calls, 1)
  eq(li, h.children[0].children[0]) // element identity kept (pre-fix: rebuilt every update)
  eq(h.text, '2A')
  src.write('a', ['t'], 'Z') // the component's INPUT moved → rebuild, fresh invocation
  eq(calls, 2)
  eq(h.text, '2Z')
})

test('REVIEW FIX: a boundary inside a row (hoisted fallback, stable child) survives row updates without rebuilding', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { t: 'A', val: 1 } })
  const fb = (_e: unknown) => el('em', null, 'fb')
  const h = host()
  render(
    h,
    el('ul', null, list(src, (r: Row) =>
      el('li', null,
        el('span', null, String(r.val)),
        el('div', null, boundary(el('i', null, 'guarded'), fb)),
      ),
    )),
  )
  const li = h.children[0].children[0]
  src.write('a', ['val'], 2)
  eq(li, h.children[0].children[0]) // structural boundary equality — no rebuild
  eq(h.text, '2guarded')
})

test('REVIEW FIX: a component row root resolving to a list throws the row-ROOT error, not the internal mount error', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { t: 'A', val: 1 } })
  const h = host()
  let err: any
  try {
    render(h, list(src, () => component(() => list(src, (r: Row) => el('li', null, r.t)))))
  } catch (e) {
    err = e
  }
  ok(/row ROOT/.test(err.message))
})

test('REVIEW FIX: an unboundaried mount-phase throw leaves no live subscriptions or DOM — render tears down what it built', () => {
  const { s } = scalar()
  const h = host()
  let err: any
  try {
    render(h, [
      el('div', null, text(s)),
      component(() => {
        throw new Error('boom-mount')
      }),
    ])
  } catch (e) {
    err = e
  }
  eq(err.message, 'boom-mount')
  eq(s.effects.length, 0) // the completed first top's binding was disposed
  eq(h.children.length, 0) // and its DOM removed
})
