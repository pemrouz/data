// seam/wire-verbs.test.ts — a wire record whose verb is not one of the four
// (add | update | remove | move) is REJECTED under per-record isolation (SCHEDULE
// clause 10): counted in `rejected`, delivered to onReject (or surfaced in the
// AggregateError), and NEVER silently counted as applied. Found by the npm-consumer
// review of 2026-09-22: applyWire's switch had no default, so a typo'd verb was a
// no-op the report called applied — a replica desync with no signal.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { $, ingest } from '../api/index.ts'

test('ingest(): an unknown wire verb is a reject, not a silent no-op counted as applied', () => {
  const D = $({} as Record<string, { n: number }>)
  const rejects: any[] = []
  const report = ingest(D, [
    { t: 'add', k: 'ok', v: { n: 1 } },
    { t: 'nope', k: 'bad', v: { n: 2 } } as any,
    { t: 'upd', k: 'ok', v: { n: 3 } } as any,   // a typo for 'update'
  ], { onReject: r => rejects.push(r) })
  assert.deepEqual(report, { applied: 1, rejected: 2 })
  assert.deepEqual(rejects.map(r => r.index), [1, 2])
  assert.match(String(rejects[0].error?.message ?? rejects[0].error), /nope/)
  assert.match(String(rejects[1].error?.message ?? rejects[1].error), /upd/)
  assert.deepEqual(D.snapshot(), { ok: { n: 1 } })   // the sibling committed; the typo did not land
})

test('ingest(): without onReject the unknown verb surfaces after the siblings committed', () => {
  const D = $({} as Record<string, { n: number }>)
  assert.throws(
    () => ingest(D, [{ t: 'add', k: 'ok', v: { n: 1 } }, { t: 'garbage', k: 'x' } as any]),
    (e: any) => e instanceof AggregateError && e.errors.length === 1 && /garbage/.test(String(e.errors[0]?.message ?? e.errors[0])),
  )
  assert.deepEqual(D.snapshot(), { ok: { n: 1 } })
})
