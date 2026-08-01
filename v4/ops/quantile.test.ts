// v4/ops/quantile.test.ts — W13 conformance: oracle-checked churn + edges.
import { test } from 'node:test'
import assert from 'node:assert'
import { Runtime } from '../kernel/runtime.ts'
import { SourceNode } from '../kernel/node.ts'
import { conformScalar } from '../conformance/harness.ts'
import { registry } from './registry.ts'
import { quantile, percentile, median } from './quantile.ts'

const same = assert.deepStrictEqual
const ok = assert.ok

function oracle(rows: number[], q: number): number | undefined {
  if (rows.length === 0) return undefined
  const s = [...rows].sort((a, b) => a - b)
  const h = (s.length - 1) * q
  const lo = Math.floor(h)
  return h === lo ? s[lo] : s[lo] + (h - lo) * (s[lo + 1] - s[lo])
}

test('W13: median/percentile/quantile — interpolation, empty set, col + identity forms', () => {
  const rt = new Runtime()
  const src = new SourceNode<any>(rt, { a: { v: 1 }, b: { v: 3 }, c: { v: 2 }, d: { v: 4 } })
  const med = median(src, 'v')
  const p90 = percentile(src, 'v', 90)
  const q25 = quantile(src, 'v', 0.25)
  conformScalar(med as any)
  conformScalar(p90 as any)
  same(med.value(), 2.5) // even count — interpolated
  same(p90.value(), oracle([1, 2, 3, 4], 0.9))
  same(q25.value(), 1.75)
  src.remove('d')
  same(med.value(), 2) // odd count — exact member
  src.remove('a'); src.remove('b'); src.remove('c')
  same(med.value(), undefined) // empty set → undefined, not NaN
  // identity projection (rows are the numbers)
  const nums = new SourceNode<number>(rt, { x: 10, y: 20 } as any)
  same(median(nums).value(), 15)
  // non-numeric / NaN rows are skipped, never poison
  src.write('s', [], { v: 'oops' })
  src.write('n', [], { v: NaN })
  src.write('k', [], { v: 7 })
  same(med.value(), 7)
  assert.throws(() => quantile(src, 'v', 1.5), /fraction in \[0,1\]/)
  assert.throws(() => percentile(src, 'v', 250), /percent in \[0,100\]/)
  same(registry.get('median')!.dedupKey!('v'), 'median:v')
  same(registry.get('quantile')!.dedupKey!('v', 0.25), 'quantile:v:0.25')
})

test('W13: 400-step seeded churn stays oracle-equal (duplicates, updates, removes)', () => {
  let s = 0xBEEF
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 0x100000000)
  const rt = new Runtime()
  const src = new SourceNode<any>(rt, {})
  const q = quantile(src, 'v', 0.7)
  conformScalar(q as any)
  const live = new Map<string, number>()
  for (let i = 0; i < 400; i++) {
    const k = 'k' + Math.floor(rnd() * 40)
    const roll = rnd()
    if (roll < 0.5) {
      const v = Math.floor(rnd() * 20) // narrow domain — plenty of duplicates
      live.set(k, v)
      src.write(k, [], { v })
    } else if (live.has(k)) {
      live.delete(k)
      src.remove(k)
    }
    same(q.value(), oracle([...live.values()], 0.7), `step ${i}`)
  }
})
