// @ts-nocheck
// Differential correctness harness.
//
// For every (source-shape × operator-chain × mutation) it asserts the LIVE
// incrementally-updated view stays equal to a FROM-SCRATCH rebuild of the same
// chain over the current source snapshot. The rebuild is the oracle: it can
// only be wrong if a pure function is wrong, whereas the live view exercises
// every incremental BU1/BR1/BI0/BU2/BMV1 path. Any incremental desync (a
// dropped survivor, a ghost row, a stale value) shows up as a mismatch.
//
// Comparison is *logical*: array views are densified (explicit-undefined holes
// dropped) and compared in index order; object views compared as key→value
// maps excluding undefined. This tolerates the hole-vs-splice REPRESENTATION
// difference (which is legal) while still catching wrong/missing/extra ROWS.
//
// This file IS in the default `npm test` glob (see package.json). Run it alone:
//   node --experimental-strip-types --test differential.test.ts
import { test } from 'node:test'
import { strictEqual as eq, ok } from 'node:assert'
import { $, value } from './index.ts'

// ---- deterministic RNG ----
let _seed = 0
const rnd = () => (_seed = (_seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]

// ---- logical comparator ----
const isObj = (v) => v != null && typeof v === 'object'
const num = (v) => typeof v === 'number'
const approx = (a, b) => a === b || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
function logicalEqual(a, b) {
  if (a === b) return true
  if (num(a) && num(b)) return approx(a, b) || (Number.isNaN(a) && Number.isNaN(b))
  if (a === undefined || b === undefined) return a === b
  const aArr = Array.isArray(a), bArr = Array.isArray(b)
  if (aArr || bArr) {
    // densify both, compare in order
    const da = (aArr ? a : Object.values(a)).filter((x) => x !== undefined)
    const db = (bArr ? b : Object.values(b)).filter((x) => x !== undefined)
    if (da.length !== db.length) return false
    for (let i = 0; i < da.length; i++) if (!logicalEqual(da[i], db[i])) return false
    return true
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined)
    const kb = Object.keys(b).filter((k) => b[k] !== undefined)
    if (ka.length !== kb.length) return false
    for (const k of ka) if (!logicalEqual(a[k], b[k])) return false
    return true
  }
  return false
}

// ---- world: rows {id,g,v} ----
// `v` is kept globally UNIQUE (initial 0,11,22,…; every insert/update draws a
// fresh monotonic value) so sort order is unambiguous — otherwise live vs
// rebuild can break ties differently, a representation difference, not a bug.
// `g` stays in {g0,g1,g2} so group/distinct/length(fn) see real collisions.
let _vCounter = 200
const nextV = () => _vCounter++
const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: i, g: 'g' + (i % 3), v: i * 11 }))
const asObject = (arr) => Object.fromEntries(arr.map((r) => ['k' + r.id, { ...r }]))
const clone = (v) => structuredClone(v)

// length(fn) keeps emptied buckets as {value:0} (documented fixed-keyspace
// persistence); a fresh rebuild never has them. Drop zero-buckets from both
// sides so that intentional contract isn't flagged as a desync.
const dropZeroBuckets = (o) => {
  if (!isObj(o) || Array.isArray(o)) return o
  const out = {}
  for (const k of Object.keys(o)) {
    const b = o[k]
    if (isObj(b) && 'value' in b && b.value === 0) continue
    out[k] = b
  }
  return out
}

// distinct's OUTPUT ROW identity / order is legitimately history-dependent
// (first-seen-historically vs a fresh build's first-seen-in-current-iteration).
// The unambiguous correctness property is the SET of distinct keys present, so
// project the output rows to their `g` keyset before comparing.
const gKeyset = (o) => {
  if (!isObj(o)) return o
  const vals = (Array.isArray(o) ? o : Object.values(o)).filter((x) => x !== undefined)
  return [...new Set(vals.map((r) => (r && typeof r === 'object' ? r.g : r)))].sort()
}

// A "scenario" describes a chain + how to drive it. `project(src, ctx)` builds
// the derived view; `ctx.bound` is a [lo,hi] pair — a reactive proxy for the
// live chain, a literal for the rebuild oracle. Scenarios that don't filter by
// bound ignore ctx.
const SCENARIOS = [
  // ---- single ops ----
  { tag: 'filter', project: (s) => s.filter((r) => r.v > 25) },
  { tag: 'map', project: (s) => s.map((r) => r.v) },
  { tag: 'gt', project: (s) => s.gt('v', 25) },
  { tag: 'lt', project: (s) => s.lt('v', 25) },
  { tag: 'between', bound: true, project: (s, c) => s.between('v', c.bound) },
  { tag: 'az', project: (s) => s.az('v') },
  { tag: 'za', project: (s) => s.za('v') },
  { tag: 'za-window', project: (s) => s.za('v', 3) },
  { tag: 'length', scalar: true, project: (s) => s.length() },
  { tag: 'length-fn', normalize: dropZeroBuckets, project: (s) => s.length((r) => r.g) },
  { tag: 'sum', scalar: true, project: (s) => s.sum('v') },
  { tag: 'avg', scalar: true, project: (s) => s.avg('v') },
  { tag: 'max', scalar: true, project: (s) => s.max('v') },
  { tag: 'min', scalar: true, project: (s) => s.min('v') },
  { tag: 'some', scalar: true, project: (s) => s.some((r) => r.v > 80) },
  { tag: 'every', scalar: true, project: (s) => s.every((r) => r.v >= 0) },
  { tag: 'distinct', normalize: gKeyset, project: (s) => s.distinct((r) => r.g) },
  { tag: 'keys', project: (s) => s.keys() },
  { tag: 'values', project: (s) => s.values() },
  { tag: 'reverse', project: (s) => s.reverse() },
  { tag: 'to', scalar: true, project: (s) => s.to((a) => (a ? Object.values(a).filter(Boolean).length : 0)) },
  { tag: 'group', project: (s) => s.group((r) => r.g) },
  // ---- set-algebra producers (C12: the harness had NO intersect/union/except
  // head-operator coverage, which is why their array-source remove-churn desync
  // went unseen). Facets derive from the same source so membership correlates
  // by key/index.
  { tag: 'intersect', project: (s) => s.intersect(s.filter((r) => r.v > 25)) },
  { tag: 'intersect2', project: (s) => s.intersect(s.filter((r) => r.v > 25), s.filter((r) => r.v < 80)) },
  { tag: 'intersect-between', bound: true, project: (s, c) => s.intersect(s.between('v', c.bound)) },
  { tag: 'union', project: (s) => s.filter((r) => r.v > 60).union(s.filter((r) => r.v < 30)) },
  { tag: 'except', project: (s) => s.except(s.filter((r) => r.v > 60)) },
  { tag: 'reduce2', scalar: true, project: (s) => s.reduce((a, r) => a + (r ? r.v : 0), 0) },
  {
    tag: 'reduce3', scalar: true,
    project: (s) => s.reduce((a, r) => a + r.v, (a, r) => a - r.v, 0),
  },
  // ---- critical chains ----
  { tag: 'between→filter', bound: true, project: (s, c) => s.between('v', c.bound).filter((r) => r.v > 25) },
  { tag: 'between→map', bound: true, project: (s, c) => s.between('v', c.bound).map((r) => r.v) },
  { tag: 'za-window→map', project: (s) => s.za('v', 3).map((r) => r.v) },
  { tag: 'za-window→filter', project: (s) => s.za('v', 3).filter((r) => r.v > 25) },
  { tag: 'za-window→distinct', normalize: gKeyset, project: (s) => s.za('v', 3).distinct((r) => r.g) },
  // Chained sorts — the inner sort's output feeds another sort, whose state is
  // keyed by the inner's POSITIONS. A bounded inner window reconciles rotations
  // as content-stable BU1s (not mid-window splices), and an ascending sort tracks
  // array index-shifts (AZValue.isArr), so these stay consistent (C3).
  { tag: 'za-window→az-window', project: (s) => s.za('v', 3).az('v', 3) },
  { tag: 'az-window→za-window', project: (s) => s.az('v', 3).za('v', 3) },
  { tag: 'za-window→za-window', project: (s) => s.za('v', 3).za('v', 3) },
  { tag: 'za→az (unbounded chain)', project: (s) => s.za('v').az('v') },
  { tag: 'za-window→az-window→map', project: (s) => s.za('v', 3).az('v', 3).map((r) => r.v) },
  // filter (sparse array via predicate-flip holes) → chained windowed sort: the
  // filter emits BF0/BH1 on a flip so the sort mirrors the hole instead of
  // shift-splicing every later row (C1 family extended to filter→sort).
  { tag: 'filter→za-window→az-window', project: (s) => s.filter((r) => r.v > 5).za('v', 3).az('v', 3) },
  { tag: 'between→group', bound: true, project: (s, c) => s.between('v', c.bound).group((r) => r.g) },
  { tag: 'between→distinct', bound: true, normalize: gKeyset, project: (s, c) => s.between('v', c.bound).distinct((r) => r.g) },
  { tag: 'between→az', bound: true, project: (s, c) => s.between('v', c.bound).az('v') },
  { tag: 'between→za', bound: true, project: (s, c) => s.between('v', c.bound).za('v') },
  { tag: 'filter→az', project: (s) => s.filter((r) => r.v > 10).az('v') },
  // TRAILING-excluded predicate (v < 60 drops the highest-v rows, and every
  // fresh insert draws v ≥ 200 so the tail stays excluded) — the C13 shape:
  // a RowOperator over an array whose own output is SHORTER than the source
  // (XU0 never assigns trailing excluded indices), chained into a positional
  // consumer. Leading-excluded predicates (v > N) never catch this.
  { tag: 'lt→map (trailing-excluded)', project: (s) => s.lt('v', 60).map((r) => r.v) },
  { tag: 'lt→az (trailing-excluded)', project: (s) => s.lt('v', 60).az('v') },
  { tag: 'filter→between', bound: true, project: (s, c) => s.filter((r) => r.v > 10).between('v', c.bound) },
  { tag: 'filter→sum', scalar: true, project: (s) => s.filter((r) => r.v > 25).sum('v') },
  { tag: 'za-window→length', scalar: true, project: (s) => s.za('v', 3).length() },
  // limit downstream of a SORT: a sort re-orders its output, reaching limit as
  // the array-positional BR1A/BI0A/BMV1 verbs. limit recomputes its window on
  // those (it can't follow a re-ranking parent incrementally) — without that,
  // `az('v').limit(k)` dropped/duped rows on a removal or rank crossing.
  { tag: 'az→limit', project: (s) => s.az('v').limit(4) },
  { tag: 'za→limit', project: (s) => s.za('v').limit(4) },
  // Aggregates downstream of `between` (C8): a counting/summing sink decrements
  // on every BR1/BH1 `between` emits, so a spurious remove (re-emitting a row
  // that already left the view) drifts the count to 0 / negative. The brush+edit
  // mutation mix exercises the `set extent` narrow loop that was the culprit.
  { tag: 'between→length', bound: true, scalar: true, project: (s, c) => s.between('v', c.bound).length() },
  { tag: 'between→sum', bound: true, scalar: true, project: (s, c) => s.between('v', c.bound).sum('v') },
  { tag: 'between→avg', bound: true, scalar: true, project: (s, c) => s.between('v', c.bound).avg('v') },
]

// mutation kinds
const freshRow = () => ({ id: 1000 + Math.floor(rnd() * 100000), g: 'g' + Math.floor(rnd() * 3), v: nextV() })
function mutate(kind, S, isArr, ctx) {
  const v = S[value]
  const keysNow = isArr
    ? v.map((_, i) => i).filter((i) => v[i] !== undefined)
    : Object.keys(v).filter((k) => v[k] !== undefined)
  if (kind === 'insert') {
    const row = freshRow()
    if (isArr) S.insert(row)
    else S['k' + row.id] = row
  } else if (kind === 'remove' && keysNow.length) {
    const k = pick(keysNow)
    if (isArr) delete S[k]
    else delete S[k]
  } else if (kind === 'update-v' && keysNow.length) {
    const k = pick(keysNow)
    S[k].v = nextV()
  } else if (kind === 'update-g' && keysNow.length) {
    const k = pick(keysNow)
    S[k].g = 'g' + Math.floor(rnd() * 3)
  } else if (kind === 'bound' && ctx.bound) {
    const lo = Math.floor(rnd() * 50), hi = lo + 10 + Math.floor(rnd() * 50)
    ctx.bound[value] = [lo, hi]
  } else if (kind === 'slot-undef' && keysNow.length) {
    // clear a slot/key in place — the documented leave-via-undefined idiom.
    // Arrays keep their length (a positional hole), objects keep the key.
    S[pick(keysNow)] = undefined
  } else if (kind === 'refill') {
    // write a fresh row back into a previously-cleared slot. For arrays this
    // is a HOLE FILL (nothing shifted) and must not be emitted as a splice.
    const holes = isArr
      ? v.map((_, i) => i).filter((i) => i in v && v[i] === undefined)
      : Object.keys(v).filter((k) => v[k] === undefined)
    if (holes.length) S[pick(holes)] = freshRow()
  } else if (kind === 'row-overwrite' && keysNow.length) {
    // whole-slot BU1 (data[k] = newRow) — not a nested field edit
    S[pick(keysNow)] = freshRow()
  } else if (kind === 'patch-batch' && keysNow.length >= 2) {
    // batched whole-row overwrites through the patch() built-in: one BU1
    // carrying multiple pairs, all committed before any sink is notified
    const k1 = pick(keysNow)
    let k2 = pick(keysNow)
    if (k2 === k1) k2 = keysNow[(keysNow.indexOf(k1) + 1) % keysNow.length]
    S.patch([k1, freshRow(), k2, freshRow()])
  } else if (kind === 'mid-insert') {
    // positional insert-at for arrays (BI0A splice mid-array); plain key
    // insert for objects (no position semantics there)
    const row = freshRow()
    if (isArr) S.insert(row, Math.floor(rnd() * (v.length + 1)))
    else S['k' + row.id] = row
  }
}

const MUT_KINDS = ['insert', 'remove', 'update-v', 'update-g', 'bound',
  'slot-undef', 'refill', 'row-overwrite', 'patch-batch', 'mid-insert']

function runScenario(scn, shape, seed) {
  _seed = seed
  const init = shape === 'array' ? rows(9) : asObject(rows(9))
  const isArr = shape === 'array'
  const S = $(clone(init))
  const liveCtx = { bound: scn.bound ? $([20, 70]) : null }
  const live = scn.project(S, liveCtx)

  const norm = scn.normalize || ((x) => x)
  const oracle = () => {
    const fresh = $(clone(S[value]))
    const bnd = liveCtx.bound ? liveCtx.bound[value] : null
    return norm(scn.project(fresh, { bound: bnd })[value])
  }

  // initial state must already match
  if (!logicalEqual(norm(live[value]), oracle()))
    return { ok: false, step: 'init', live: live[value], want: oracle() }

  for (let step = 0; step < 24; step++) {
    const kind = pick(MUT_KINDS)
    mutate(kind, S, isArr, liveCtx)
    const got = norm(live[value])
    const want = oracle()
    if (!logicalEqual(got, want))
      return { ok: false, step: `${step}:${kind}`, live: got, want }
  }
  return { ok: true }
}

// The C1 (hole-vs-splice), C3 (chained windowed/array sort) and C12 (set-algebra
// producers over an ARRAY source) families are all CLOSED under the ORIGINAL
// mutation vocabulary (tail insert / delete / field edit / bound move). The
// 2026-06-11 re-examination showed that vocabulary was exactly the corridor the
// bugs lived outside of, so the harness now also drives: slot-undef (clear in
// place), refill (write into a cleared slot), row-overwrite (whole-slot BU1),
// patch-batch (multi-row BU1 via patch()), and mid-insert (positional array
// insert) — plus the trailing-excluded `lt→…` scenarios (the C13 shape).
//
// Every entry below is a real, reproduced bug from the re-examination, parked
// here while its wave of fixes lands (finding ids in brackets — see the
// re-examination report). The registry asserts each listed case still FAILS:
// the moment a fix makes one pass, the loop below errors until the entry is
// deleted, so this list burns down monotonically and can't silently rot.
// Target state: empty.
const KNOWN_FAILURES = new Set([
  // — core refill-as-splice [1] + RowOperator hole/XU0/undefined guards [9,10] (Waves C/D)
  // — trailing-excluded RowOperator over array, the C13 shape [25] (Wave D)
  // — sort: undefined-leave ghosts [15], patch-batch bisect [14], limit undefined [16] (Wave E)
  // — between over an array source under slot-undef/refill/patch churn [21] (Wave F)
  'between→az [array]',
  'between→filter [array]',
  'between→map [array]',
  'between→za [array]',
  // — intersect/union/except under the widened churn [22,23,24,27] (Wave F)
  'except [array]',
  'intersect [array]',
  'intersect-between [array]',
  'intersect2 [array]',
  'union [array]',
  // — group/length/keys/values/reverse/reduce3 [28,29,30,31,33] (Wave G)
  'group [array]',
  'group [object]',
  'keys [object]',
  'length [array]',
  'length [object]',
  'length-fn [array]',
  'length-fn [object]',
  'reduce3 [array]',
  'reverse [object]',
  'values [object]',
])

for (const scn of SCENARIOS) {
  for (const shape of ['array', 'object']) {
    const key = `${scn.tag} [${shape}]`
    test(`diff: ${key}`, () => {
      let firstFail = null
      // a few seeds so a single lucky/unlucky sequence doesn't hide a bug
      for (const seed of [1, 7, 42, 99]) {
        // A throw (e.g. an accessor reading a hole) is a failure too — catch it
        // so it can be xfail'd rather than escaping the registry check.
        let r
        try { r = runScenario(scn, shape, seed) }
        catch (e) { r = { ok: false, step: 'threw', live: String(e?.message || e), want: '(no throw)' } }
        if (!r.ok && !firstFail) firstFail = r
      }
      if (KNOWN_FAILURES.has(key)) {
        ok(firstFail, `"${key}" is listed in KNOWN_FAILURES but now PASSES — delete it from the registry`)
      } else {
        ok(
          !firstFail,
          firstFail && `${key} @ ${firstFail.step}\n  live = ${JSON.stringify(firstFail.live)}\n  want = ${JSON.stringify(firstFail.want)}`,
        )
      }
    })
  }
}
