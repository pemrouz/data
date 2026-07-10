// Per-engine child of corpus.bench.ts — the v2-vs-v3 OPERATOR PERF CORPUS.
// Run only via the orchestrator:
//   node --experimental-strip-types --no-warnings --expose-gc v3/perf/corpus.bench.ts
// (or standalone for debugging: `... corpus.child.ts v2` / `... corpus.child.ts v3`).
//
// WHAT RUNS
// - v2 mode: imports perf/workloads.ts (the ONE definition of every v2 operator
//   workload) and measures its REAL closures with benchMeasure — exactly what
//   perf/run-report.ts's ops backfill does. No re-implementation.
// - v3 mode: a parallel spec table below maps every workload to the equivalent
//   v3 chain per v3/MIGRATION.md §3 — SAME N, SAME deterministic source data,
//   SAME write sequence (write-for-write where the surface allows; documented
//   per case where the idiom necessarily differs), SAME selectivity.
//
// METHODOLOGY (inherited from m2-gate.ts / crossfilter-example.child.ts):
// 1. One ENGINE per PROCESS — the parent spawns v2/v3 ABAB; module state and
//    JIT profiles never mix. Only the selected engine is imported (v3 mode
//    never touches perf/workloads.ts, which would drag full.ts in-process).
// 2. Sampling = benchMeasure (perf/measure.ts): 1 discarded warmup rep + gc()
//    before each measured rep, median of the case's own rep count (w.reps ?? 5
//    — per-case reps are part of the workload's source-sizing contract, e.g.
//    between/remove holds exactly warmup+5 reps of distinct keys). This is the
//    same rigor the v2 perf report uses, applied identically to both engines.
// 3. Monotonic never-repeating writes: the v2 closures already alternate bases
//    / grow counters so no rep re-writes a value Object.is-equal to the current
//    one; the v3 mirrors reproduce the exact same value sequences.
// 4. Math.random is replaced by a seeded PRNG (mulberry32), reseeded per op
//    with the same constants in both modes, so the between/sort sources (the
//    only Math.random consumers — both engines' internals are verified clean)
//    hold byte-identical data across engines. During the EQUIVALENCE pass the
//    v2 minted-insert key source ($.random) is additionally overridden with a
//    per-source counter that reproduces v3's autoObjectKey scheme
//    (String(size), advancing), so minted keys align too; it is RESTORED for
//    the timing pass (v2 pays its native crypto.randomUUID minting cost).
//
// EQUIVALENCE (CORPUS_EQ=1, the orchestrator enables it on replicate 1):
// before timing, both modes build every case's graph at EQ_N, apply the SAME
// write sequence (EQ_WRITES runs of the case's run closure), materialize the
// derived view's END STATE and emit a checksum; the orchestrator asserts
// v2 ≡ v3 per case. Normalizations for legitimately engine-different shapes
// (documented at `canon`/`EQ_NORM` below): sparse v2 arrays/objects densify
// (explicit-undefined slots drop — v3 views are dense by construction), object
// keys sort, `values`/`keys` compare as multisets (v2 emits ordered arrays,
// v3 unordered keyed views), `distinct` compares the projected value set (v2
// exposes representative ROWS, v3 exposes the PROJECTED VALUES). Setup cases
// build-and-discard, so they carry no end state — eq is n/a for them (each
// op's retained cases cover the same chain; length(fn), whose only case is a
// setup, gets a dedicated eq builder so no op goes entirely unchecked).
//
// COVERAGE / SKIPS: every perf/workloads.ts export is either mirrored or in
// the explicit skip tables below (the v2 driver throws if workloads.ts grows
// an export this file doesn't know). Skips at the flip:
// - reverse/*: v3 reserves `reverse` — unimplemented, throws at call.
// - filter/value-move: v2's reactive equality-value filter('k', $(v)) has no
//   v3 operator counterpart (the v3 idiom is a transient filter + mirror +
//   dispose — a structurally different graph, not comparable 1:1).
// Cases whose v2 closures hard-code absolute key ranges (gt-batch 4500–5499,
// reduce/inc-remove base 9900, between/remove 6×1000 distinct keys …) are
// auto-skipped below their MIN_N when a small-N override is in play — v3's
// deep-write-to-missing-key throws where v2 silently creates, so running them
// under-sized would measure fiction.
//
// Env: CORPUS_N (timing N, default 10000 — the corpus default), CORPUS_EQ_N
// (equivalence N, default 10000; below 10000 the MIN_N cases lose eq
// coverage), EQ_WRITES (runs per case in the eq pass, default 2), CORPUS_EQ
// (1 = run the eq pass), CASES (csv filter: `op` or `op/case`).
// Output: ONE JSON line on stdout (the orchestrator parses the last line).

const mode = process.argv[2]
if (mode !== 'v2' && mode !== 'v3') {
  console.error('usage: corpus.child.ts <v2|v3>')
  process.exit(2)
}

declare const gc: (() => void) | undefined
const gcSync = typeof gc === 'function' ? gc : null

import { benchMeasure } from '../../perf/measure.ts'

const DEFAULT_N = 10_000
const timingN = Number(process.env.CORPUS_N ?? DEFAULT_N)
const eqN = Number(process.env.CORPUS_EQ_N ?? DEFAULT_N)
const EQ_WRITES = Number(process.env.EQ_WRITES ?? 2)
const RUN_EQ = process.env.CORPUS_EQ === '1'
const CASES = (process.env.CASES ?? '').split(',').map((s) => s.trim()).filter(Boolean)

// ── fixed op order (must cover every perf/workloads.ts export) ───────────────

const OPS = [
  'filter', 'map', 'to', 'length', 'lengthFn', 'keys', 'values', 'tap', 'reverse',
  'distinct', 'group', 'compare', 'between', 'sort', 'aggregate', 'union',
  'intersect', 'except', 'reduce',
] as const

const OP_SKIPS: Record<string, string> = {
  reverse: 'v3 reserves `reverse` (unimplemented at the flip — throws "reserved name reverse has no implementation yet"); no counterpart to time',
}
const CASE_SKIPS: Record<string, string> = {
  'filter/value-move':
    "v2's reactive equality-value filter('active', $(bool)) has no v3 operator counterpart — the v3 idiom (transient filter + mirror() + dispose(), MIGRATION §3.1/§5.2) is a structurally different graph, not comparable 1:1",
}
// Cases whose v2 closures hard-code absolute key ranges; below these N the two
// engines diverge (v3 deep-writes to missing keys THROW; v2 silently creates)
// or the writes degrade to no-ops — skipped in BOTH modes with a report entry.
const MIN_N: Record<string, number> = {
  'filter/batch': 1000, 'to/batch': 1000, 'values/batch': 100,
  'tap/batch': 1000, 'tap/bare': 1000, 'distinct/batch': 100,
  'group/churn': 200, 'compare/gt-batch': 5500,
  'between/remove': 6000, // warmup + 5 reps × 1000 distinct keys
  'aggregate/avg-batch': 1000, 'aggregate/min-batch': 100, 'aggregate/every-batch': 1000,
  'reduce/batch': 100, 'reduce/inc-remove': 10_000, // rbase hard-coded at 9900
  'union/churn': 1000, // deletes b[5000..5999]; b holds 5000..5000+N-1
}

const opSelected = (op: string) =>
  CASES.length === 0 || CASES.some((t) => t === op || t.startsWith(op + '/'))
const caseSelected = (op: string, kase: string) =>
  CASES.length === 0 || CASES.some((t) => t === op || t === `${op}/${kase}`)

// ── seeded PRNG over Math.random (both modes — identical streams) ────────────

let prngState = 0
Math.random = () => {
  prngState = (prngState + 0x6d2b79f5) | 0
  let t = Math.imul(prngState ^ (prngState >>> 15), 1 | prngState)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const reseed = (s: number) => {
  prngState = s | 0
}

// ── canonicalization + checksum ───────────────────────────────────────────────
// Normalization for engine-different shapes (each documented in the header):
// - objects: keys sorted; keys whose value is undefined DROPPED (v2's sparse
//   producers leave excluded keys present-with-undefined; v3 views are dense).
// - arrays: undefined entries DROPPED (v2 sparse-array slots).
// - NaN serialized as "NaN" (JSON.stringify would null it).
function canon(x: unknown): string {
  if (x === undefined) return 'undefined'
  if (x === null) return 'null'
  if (typeof x === 'number') return Number.isNaN(x) ? 'NaN' : String(x)
  if (typeof x !== 'object') return JSON.stringify(x)
  if (Array.isArray(x)) return '[' + x.filter((e) => e !== undefined).map(canon).join(',') + ']'
  const o = x as Record<string, unknown>
  const ks = Object.keys(o).filter((k) => o[k] !== undefined).sort()
  return '{' + ks.map((k) => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}'
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// Per-op eq normalization mode:
// - snap (default): canon of the view's materialized value.
// - multiset: order-insensitive item comparison — `keys` (v2 array of key
//   strings vs v3 keyed {k: String(k)} view) and `values` (v2 dense array in
//   iteration order vs v3 UNORDERED identity view).
// - distinct: v2 exposes representative ROWS (first-seen holder), v3 exposes
//   the PROJECTED VALUES keyed by String(value) — compare the projected value
//   set. Hard-wired to this corpus's projection (r => r.cat).
// - buckets (`group`): bucket keys compare exactly, bucket MEMBERS compare as
//   row multisets — over an array-shaped parent (the churn case's limit(100))
//   v2 keys members POSITIONALLY within the bucket (0..9) while v3 keeps the
//   stable SOURCE row keys (MIGRATION §1); the member ROWS are identical.
const EQ_NORM: Record<string, 'snap' | 'multiset' | 'distinct' | 'buckets'> = {
  keys: 'multiset',
  values: 'multiset',
  distinct: 'distinct',
  group: 'buckets',
}

function checksum(op: string, val: unknown): string {
  const kind = EQ_NORM[op] ?? 'snap'
  let s: string
  if (kind === 'snap') {
    s = canon(val)
  } else if (kind === 'buckets') {
    const o = (val ?? {}) as Record<string, object>
    const ks = Object.keys(o).filter((k) => o[k] !== undefined).sort()
    s =
      '{' +
      ks
        .map(
          (k) =>
            JSON.stringify(k) +
            ':[' +
            Object.values(o[k]).filter((r) => r !== undefined).map(canon).sort().join(',') +
            ']',
        )
        .join(',') +
      '}'
  } else {
    let items: unknown[]
    if (kind === 'distinct')
      items = mode === 'v2' ? (val as any[]).map((r: any) => r?.cat) : Object.values(val as object)
    else items = Array.isArray(val) ? val : Object.values((val ?? {}) as object)
    s = '[' + items.filter((x) => x !== undefined).map(canon).sort().join(',') + ']'
  }
  return fnv1a(s).toString(16) + ':' + s.length
}

// ── engine import (ONLY the selected engine touches this process) ────────────

const engine: any = mode === 'v2' ? await import('../../full.ts') : await import('../api/index.ts')
const WL: any = mode === 'v2' ? await import('../../perf/workloads.ts') : null
const $: any = engine.$
const V: any = engine.value

if (mode === 'v2') {
  // Coverage guard: a new workloads.ts export must be added to OPS (with a v3
  // mirror or an explicit skip) — no silent corpus gaps.
  for (const k of Object.keys(WL))
    if (!(OPS as readonly string[]).includes(k))
      throw new Error(
        `corpus: perf/workloads.ts export "${k}" is not in this corpus — add it to OPS in corpus.child.ts (v3 mirror or skip entry)`,
      )
}

// ── deterministic source builders (v3 mirrors of workloads.ts's sources) ─────
// Byte-identical generation logic; between/sort draw from the seeded PRNG in
// the same order the v2 workloads() builds its sources.

const srcActive = (n: number) => {
  const o: any = {}
  for (let i = 0; i < n; i++) o[i] = { active: i % 2 === 0, val: i }
  return o
}
const srcXY = (n: number) => {
  const o: any = {}
  for (let i = 0; i < n; i++) o[i] = { x: i, y: i * 2 }
  return o
}
const srcBucket = (n: number) => {
  const o: any = {}
  for (let i = 0; i < n; i++) o[i] = { bucket: Math.floor(i / 100), val: i }
  return o
}
const srcCat100 = (n: number) => {
  const o: any = {}
  for (let i = 0; i < n; i++) o[i] = { cat: i % 100, val: i }
  return o
}
const srcCat10 = (n: number) => {
  const o: any = {}
  for (let i = 0; i < n; i++) o[i] = { cat: i % 10, val: i }
  return o
}
const srcVal = (n: number) => {
  const o: any = {}
  for (let i = 0; i < n; i++) o[i] = { val: Math.random() * 1000 }
  return o
}
const srcScore = (n: number) => {
  const o: any = {}
  for (let i = 0; i < n; i++) o[i] = { score: Math.random() * 1000, id: i }
  return o
}
const srcRange = (start: number, n: number) => {
  const o: any = {}
  for (let i = 0; i < n; i++) o[start + i] = `v${start + i}`
  return o
}
const srcSeq = (n: number) => srcRange(0, n)

// ── the v3 spec table — one entry per workloads.ts export ────────────────────
// Each `workloads(n)` mirrors the v2 workloads() body: same source-build
// ORDER (PRNG alignment), same counters/toggles, same per-case write loops.
// `view` is the derived view whose end state the eq pass checksums (v2 reads
// it off the workload's `keep` — bundle-lists-the-view-LAST convention).
// Where the v3 write surface differs, the mirror is the per-write translation:
//   d[k].f = v         → d.get(k).set('f', v)         (one commit per write)
//   d[k] = row         → d.set(k, row)
//   delete d[k]        → d.get(k).remove()
//   two-VP between     → ONE bounds child holding [lo, hi]; v2's per-bound
//     single writes become tuple writes reproducing the SAME intermediate
//     bound states (4 writes → 4 commits, both engines)
//   reactive threshold/window/column $(x) → param source child handle p.get(k)
// NOTE deliberately NOT batched: v2's 1000-write loops dispatch per write, so
// the v3 mirrors issue 1000 bare writes = 1000 commits — write-for-write
// parity. v3's idiomatic batch()/patch() for such loops is a different
// (cheaper) workload and is NOT what this corpus measures.
//
// Known inherent-work asymmetries (each side runs its engine's REAL
// counterpart — engine design, not mapping bias; adversarially verified by a
// per-write intermediate-state diff at review time: between/narrow,
// gt-threshold-move, sort/brush, sort/window-move, sum-column-move,
// filter/batch, union/churn and reduce/inc-overwrite hold IDENTICAL view
// states after every individual write in both engines):
// - reactive value moves ride v3's param bridge (ops/reactive.ts): each move
//   settles as TWO commits (the arg source, then the queued hidden-param
//   write) vs v2's single cascade — same recompute, same intermediate states.
// - values(): v2 maintains a dense output array per write; v3's ValuesNode is
//   an identity passthrough (forwards parent deltas, snapshot delegates to
//   the parent) — an extreme values/* ratio is real design asymmetry, not a
//   no-op mapping (the eq pass materializes and compares the same end state).
// - minted-key inserts: the timing pass keeps v2's native crypto.randomUUID
//   mint vs v3's String(size) counter (see the PRNG note in the header).

interface CaseSpec {
  run: () => void
  reps?: number
  batch?: number
  keep?: any
  view?: any
}
interface OpSpec {
  N: number
  label?: string
  workloads(n?: number): Record<string, CaseSpec>
  [k: string]: any
}

function buildV3Specs(): Record<string, OpSpec> {
  return {
    filter: {
      N: DEFAULT_N,
      workloads(this: any, n = this.N) {
        const mk = () => {
          const s = $(srcActive(n))
          const f = s.filter((d: any) => d.active)
          return { s, f }
        }
        const single = mk()
        const batch = mk()
        let toggle = false
        return {
          setup: { run: () => { const s = $(srcActive(n)); s.filter((d: any) => d.active) } },
          single: { keep: single, view: single.f, run: () => { single.s.insert({ active: true, val: 99999 }) } },
          batch: {
            batch: 1000, keep: batch, view: batch.f,
            run: () => { toggle = !toggle; for (let i = 0; i < 1000; i++) batch.s.get(i).set('active', toggle) },
          },
        }
      },
    },
    map: {
      N: DEFAULT_N, label: 'map',
      workloads(this: any, n = this.N) {
        const mk = () => { const s = $(srcXY(n)); const m = s.map((d: any) => d.x + d.y); return { s, m } }
        const ins = mk()
        let i = n
        return {
          setup: { run: () => { const s = $(srcXY(n)); s.map((d: any) => d.x + d.y) } },
          insert: { keep: ins, view: ins.m, run: () => { ins.s.insert({ x: i, y: i * 2 }); i++ } },
        }
      },
    },
    to: {
      N: DEFAULT_N, label: 'to',
      workloads(this: any, n = this.N) {
        const proj = (d: any) => Object.values(d).filter((r: any) => r.active).length
        const mk = () => { const s = $(srcActive(n)); const t = s.to(proj); return { s, t } }
        const ins = mk()
        const bat = mk()
        let i = n
        let toggle = false
        return {
          setup: { run: () => { const s = $(srcActive(n)); s.to(proj) } },
          insert: { keep: ins, view: ins.t, run: () => { ins.s.insert({ active: true, val: i++ }) } },
          batch: {
            batch: 1000, keep: bat, view: bat.t,
            run: () => { toggle = !toggle; for (let k = 0; k < 1000; k++) bat.s.get(k).set('active', toggle) },
          },
        }
      },
    },
    length: {
      N: DEFAULT_N, label: 'length',
      workloads(this: any, n = this.N) {
        const mk = () => { const s = $(srcBucket(n)); const c = s.length(); return { s, c } }
        const ins = mk()
        let i = n
        return {
          insert: { keep: ins, view: ins.c, run: () => { ins.s.insert({ bucket: 0, val: i++ }) } },
        }
      },
    },
    lengthFn: {
      N: DEFAULT_N, label: 'length(fn)',
      workloads(this: any, n = this.N) {
        return {
          setup: { run: () => { const s = $(srcBucket(n)); s.length((d: any) => d.bucket) } },
        }
      },
    },
    keys: {
      N: DEFAULT_N, label: 'keys',
      workloads(this: any, n = this.N) {
        const mk = () => { const s = $(srcActive(n)); const k = s.keys(); return { s, k } }
        const ins = mk()
        let i = n
        return {
          setup: { run: () => { const s = $(srcActive(n)); s.keys() } },
          insert: { keep: ins, view: ins.k, run: () => { ins.s.insert({ active: true, val: i++ }) } },
        }
      },
    },
    values: {
      N: DEFAULT_N, label: 'values',
      workloads(this: any, n = this.N) {
        const mk = () => { const s = $(srcActive(n)); const v = s.values(); return { s, v } }
        const bat = mk()
        let toggle = false
        return {
          setup: { run: () => { const s = $(srcActive(n)); s.values() } },
          batch: {
            batch: 100, keep: bat, view: bat.v,
            run: () => { toggle = !toggle; const base = toggle ? 1 : 2; for (let i = 0; i < 100; i++) bat.s.get(i).set('val', i + base) },
          },
        }
      },
    },
    tap: {
      N: DEFAULT_N, label: 'tap',
      workloads(this: any, n = this.N) {
        // 1-param fn → full per-row cloned records; 0-param → bare per-batch
        // (v3 ports the v2 param-presence dispatch verbatim, MIGRATION §3.10)
        const mkFull = () => { const s = $(srcActive(n)); let c = 0; const t = s.tap((ch: any) => { c++ }); return { s, t } }
        const mkBare = () => { const s = $(srcActive(n)); let c = 0; const t = s.tap(() => { c++ }); return { s, t } }
        const ins = mkFull()
        const bat = mkFull()
        const bare = mkBare()
        let i = n
        let tb = false
        let tbare = false
        return {
          setup: { run: () => { const s = $(srcActive(n)); let c = 0; s.tap(() => { c++ }) } },
          insert: { keep: ins, view: ins.t, run: () => { ins.s.insert({ active: true, val: i++ }) } },
          batch: {
            batch: 1000, keep: bat, view: bat.t,
            run: () => { tb = !tb; for (let k = 0; k < 1000; k++) bat.s.get(k).set('active', tb) },
          },
          bare: {
            batch: 1000, keep: bare, view: bare.t,
            run: () => { tbare = !tbare; for (let k = 0; k < 1000; k++) bare.s.get(k).set('active', tbare) },
          },
        }
      },
    },
    reverse: { N: DEFAULT_N, label: 'reverse', workloads: () => ({}) }, // OP_SKIPS
    distinct: {
      N: DEFAULT_N, label: 'distinct',
      workloads(this: any, n = this.N) {
        const mk = () => { const s = $(srcCat100(n)); const d = s.distinct((r: any) => r.cat); return { s, d } }
        const ins = mk()
        const bat = mk()
        let i = n
        let toggle = false
        return {
          setup: { run: () => { const s = $(srcCat100(n)); s.distinct((r: any) => r.cat) } },
          insert: { keep: ins, view: ins.d, run: () => { ins.s.insert({ cat: i % 100, val: i }); i++ } },
          batch: {
            batch: 100, keep: bat, view: bat.d,
            run: () => { toggle = !toggle; const base = toggle ? 1 : 2; for (let k = 0; k < 100; k++) bat.s.get(k).set('val', k + base) },
          },
        }
      },
    },
    group: {
      N: DEFAULT_N, label: 'group',
      workloads(this: any, n = this.N) {
        const mk = () => { const s = $(srcCat10(n)); const g = s.group((d: any) => d.cat); return { s, g } }
        const ins = mk()
        let i = n
        const cs = $(srcCat10(n))
        const cg = cs.limit(100).group((d: any) => d.cat)
        let removed = 100
        return {
          setup: { run: () => { const s = $(srcCat10(n)); s.group((d: any) => d.cat) } },
          insert: { keep: ins, view: ins.g, run: () => { ins.s.insert({ cat: i % 10, val: i }); i++ } },
          churn: { keep: { cs, cg }, view: cg, run: () => { cs.get(removed).remove(); removed++ } },
        }
      },
    },
    compare: {
      N: DEFAULT_N, label: 'compare',
      workloads(this: any, n = this.N) {
        const mkGt = () => { const s = $(srcActive(n)); const f = s.gt('val', 5000); return { s, f } }
        const ins = mkGt()
        const bat = mkGt()
        let bump = 0
        // reactive threshold: v2's $(5000) scalar root becomes a param-source
        // child handle (the v3 reactive value-slot form, MIGRATION §3.3)
        const tS = $(srcActive(n))
        const tP = $({ t: 5000 })
        const tV = tS.gt('val', tP.get('t'))
        return {
          'gt-setup': { run: () => { const s = $(srcActive(n)); s.gt('val', 5000) } },
          'gt-insert': { keep: ins, view: ins.f, run: () => { ins.s.insert({ active: true, val: 99999 }) } },
          'gt-batch': {
            batch: 1000, keep: bat, view: bat.f,
            run: () => { bump++; for (let i = 4500; i < 5500; i++) bat.s.get(i).set('val', bump * 10000 + i) },
          },
          'gt-threshold-move': { keep: { tS, tP, tV }, view: tV, run: () => { tP.set('t', 2500); tP.set('t', 5000) } },
          'lt-setup': { run: () => { const s = $(srcActive(n)); s.lt('val', 5000) } },
          'gte-setup': { run: () => { const s = $(srcActive(n)); s.gte('val', 5000) } },
          'lte-setup': { run: () => { const s = $(srcActive(n)); s.lte('val', 5000) } },
        }
      },
    },
    between: {
      N: DEFAULT_N, label: 'between',
      workloads(this: any, n = this.N) {
        // v2's two-handle tuple [$(lo), $(hi)] is gone (throws at construction)
        // — ONE bounds child holds the [lo, hi] tuple (MIGRATION §3.2). v2's
        // narrow writes each bound separately (4 single-bound writes); the v3
        // mirror issues 4 tuple writes reproducing the SAME intermediate bound
        // states — 4 recomputes in both engines.
        const nS = $(srcVal(n))
        const nb = $({ r: [0, 1000] })
        const nV = nS.between('val', nb.get('r'))
        const iS = $(srcVal(n))
        const ib = $({ r: [200, 800] })
        const iV = iS.between('val', ib.get('r'))
        let id = 100000
        const rS = $(srcVal(n))
        const rb = $({ r: [200, 800] })
        const rV = rS.between('val', rb.get('r'))
        let base = 0
        return {
          setup: { run: () => { const s = $(srcVal(n)); const b = $({ r: [200, 800] }); s.between('val', b.get('r')) } },
          narrow: {
            keep: { nS, nb, nV }, view: nV,
            run: () => { nb.set('r', [400, 1000]); nb.set('r', [400, 600]); nb.set('r', [0, 600]); nb.set('r', [0, 1000]) },
          },
          insert: {
            reps: 3, batch: 1000, keep: { iS, ib, iV }, view: iV,
            run: () => { for (let i = 0; i < 1000; i++) iS.set('n' + (id++), { val: Math.random() * 1000 }) },
          },
          remove: {
            reps: 5, batch: 1000, keep: { rS, rb, rV }, view: rV,
            run: () => { for (let i = 0; i < 1000; i++) rS.get(base + i).remove(); base += 1000 },
          },
        }
      },
    },
    sort: {
      N: DEFAULT_N, label: 'sort',
      workloads(this: any, n = this.N) {
        const iS = $(srcScore(n))
        const iV = iS.za('score', 100)
        let i = n
        const rS = $(srcScore(n))
        const rV = rS.za('score', 100)
        const rArr: any[] = rV[V]
        const lastId = rArr[rArr.length - 1].id
        let bump = Math.max(...rArr.map((r: any) => r.score)) + 1
        // brush: v2's single reactive VP extent $([0,1]) becomes a bounds child
        const bo: any = {}
        for (let k = 0; k < n; k++) bo['v' + k] = { r: Math.random(), id: k }
        const bS = $(bo)
        const bB = $({ r: [0, 1] })
        const bV = bS.between('r', bB.get('r')).za('r', 100)
        // window-move: v2's reactive size $(50) becomes a param child handle
        const wS = $(srcScore(n))
        const wn = $({ n: 50 })
        const wV = wS.za('score', wn.get('n'))
        return {
          setup: { run: () => { const s = $(srcScore(n)); s.za('score', 100) } },
          insert: { keep: { iS, iV }, view: iV, run: () => { iS.insert({ score: Math.random() * 1000, id: i++ }) } },
          rotate: { keep: { rS, rV }, view: rV, run: () => { rS.get(lastId).set('score', bump++) } },
          brush: { keep: { bS, bB, bV }, view: bV, run: () => { bB.set('r', [0, 0.5]); bB.set('r', [0, 1]) } },
          'window-move': { keep: { wS, wn, wV }, view: wV, run: () => { wn.set('n', 200); wn.set('n', 50) } },
        }
      },
    },
    aggregate: {
      N: DEFAULT_N, label: 'aggregate',
      workloads(this: any, n = this.N) {
        const mk = (build: (s: any) => any) => { const s = $(srcActive(n)); const a = build(s); return { s, a } }
        const sumIns = mk((s) => s.sum('val'))
        const maxIns = mk((s) => s.max('val'))
        const avgBat = mk((s) => s.avg('val'))
        const minBat = mk((s) => s.min('val'))
        const everyBat = mk((s) => s.every((r: any) => r.active))
        let si = n
        let mi = n
        let ta = false
        let tm = false
        let te = false
        // reactive column: v2's $('a') scalar root becomes a param child handle
        const cO: any = {}
        for (let k = 0; k < n; k++) cO[k] = { a: k, b: k * 2 }
        const cS = $(cO)
        const cP = $({ c: 'a' })
        const cV = cS.sum(cP.get('c'))
        return {
          'sum-setup': { run: () => { const s = $(srcActive(n)); s.sum('val') } },
          'sum-insert': { keep: sumIns, view: sumIns.a, run: () => { sumIns.s.insert({ active: true, val: si++ }) } },
          'avg-batch': {
            batch: 1000, keep: avgBat, view: avgBat.a,
            run: () => { ta = !ta; const b = ta ? 1 : 2; for (let i = 0; i < 1000; i++) avgBat.s.get(i).set('val', i + b) },
          },
          'max-setup': { run: () => { const s = $(srcActive(n)); s.max('val') } },
          'max-insert': { keep: maxIns, view: maxIns.a, run: () => { maxIns.s.insert({ active: true, val: mi++ }) } },
          'min-batch': {
            batch: 100, keep: minBat, view: minBat.a,
            run: () => { tm = !tm; const b = tm ? 1 : 2; for (let i = 0; i < 100; i++) minBat.s.get(i).set('val', i + b) },
          },
          'some-setup': { run: () => { const s = $(srcActive(n)); s.some((r: any) => r.active) } },
          'every-batch': {
            batch: 1000, keep: everyBat, view: everyBat.a,
            run: () => { te = !te; for (let i = 0; i < 1000; i++) everyBat.s.get(i).set('active', te) },
          },
          'sum-column-move': { keep: { cS, cP, cV }, view: cV, run: () => { cP.set('c', 'b'); cP.set('c', 'a') } },
        }
      },
    },
    union: {
      N: DEFAULT_N, label: 'union',
      workloads(this: any) {
        const N = this.N
        const build = () => {
          const a = $(srcRange(0, N))
          const b = $(srcRange(5000, N))
          const c = $(srcRange(10000, N))
          const u = a.union(b, c) // view operands (MIGRATION §3.8)
          return { a, b, c, u }
        }
        const churnG = build()
        const insG = build()
        let ins = 25000
        return {
          setup: { run: () => { const a = $(srcRange(0, N)); const b = $(srcRange(5000, N)); const c = $(srcRange(10000, N)); a.union(b, c) } },
          churn: {
            batch: 1000, keep: churnG, view: churnG.u,
            run: () => {
              for (let i = 0; i < 1000; i++) churnG.b.get(5000 + i).remove()
              for (let i = 0; i < 1000; i++) churnG.b.set(5000 + i, `v${5000 + i}`)
            },
          },
          insert: {
            batch: 1000, keep: insG, view: insG.u,
            run: () => { for (let k = 0; k < 1000; k++) { insG.a.set(ins, `v${ins}`); ins++ } },
          },
        }
      },
    },
    intersect: {
      N: DEFAULT_N, label: 'intersect',
      workloads(this: any) {
        const N = this.N
        const build = () => {
          const a = $(srcSeq(N))
          const b = $(srcSeq(8000))
          const c = $(srcSeq(6000))
          const x = a.intersect(b, c)
          return { a, b, c, x }
        }
        const churnG = build()
        return {
          setup: { run: () => { const a = $(srcSeq(N)); const b = $(srcSeq(8000)); const c = $(srcSeq(6000)); a.intersect(b, c) } },
          churn: {
            batch: 1000, keep: churnG, view: churnG.x,
            run: () => {
              for (let i = 0; i < 1000; i++) churnG.b.get(i).remove()
              for (let i = 0; i < 1000; i++) churnG.b.set(i, `v${i}`)
            },
          },
        }
      },
    },
    except: {
      N: DEFAULT_N, label: 'except',
      workloads(this: any) {
        const N = this.N
        const insG = (() => { const a = $(srcRange(0, N)); const b = $(srcRange(0, 5000)); const x = a.except(b); return { a, b, x } })()
        const remG = (() => { const a = $(srcRange(0, N)); const b = $(srcRange(0, 6000)); const x = a.except(b); return { a, b, x } })()
        let ins = 5000
        let base = 0
        return {
          setup: { run: () => { const a = $(srcRange(0, N)); const b = $(srcRange(0, 5000)); a.except(b) } },
          'insert-other': {
            batch: 1000, keep: insG, view: insG.x,
            run: () => { for (let k = 0; k < 1000; k++) { insG.b.set(ins, `v${ins}`); ins++ } },
          },
          'remove-other': {
            batch: 1000, keep: remG, view: remG.x,
            run: () => { for (let i = 0; i < 1000; i++) remG.b.get(base + i).remove(); base += 1000 },
          },
        }
      },
    },
    reduce: {
      N: DEFAULT_N, label: 'reduce',
      workloads(this: any, n = this.N) {
        const add = (acc: any, r: any) => acc + r.val
        const sub = (acc: any, r: any) => acc - r.val
        const mkFull = () => { const s = $(srcActive(n)); const a = s.reduce(add, 0); return { s, a } }
        const mkInc = () => { const s = $(srcActive(n)); const a = s.reduce(add, sub, 0); return { s, a } }
        const fIns = mkFull()
        const fBat = mkFull()
        const iIns = mkInc()
        const iOvr = mkInc()
        const iRem = mkInc()
        let fi = n
        let ii = n
        let toggle = false
        let j = 0
        let rbase = 9900
        return {
          setup: { run: () => { const s = $(srcActive(n)); s.reduce(add, 0) } },
          insert: { keep: fIns, view: fIns.a, run: () => { fIns.s.insert({ active: true, val: fi++ }) } },
          batch: {
            batch: 100, keep: fBat, view: fBat.a,
            run: () => { toggle = !toggle; const b = toggle ? 1 : 2; for (let i = 0; i < 100; i++) fBat.s.get(i).set('val', i + b) },
          },
          'inc-setup': { run: () => { const s = $(srcActive(n)); s.reduce(add, sub, 0) } },
          'inc-insert': { keep: iIns, view: iIns.a, run: () => { iIns.s.insert({ active: true, val: ii++ }) } },
          'inc-overwrite': {
            batch: 100, keep: iOvr, view: iOvr.a,
            run: () => { for (let i = 0; i < 100; i++) iOvr.s.set(i, { active: true, val: 100000 + (j++) }) },
          },
          'inc-remove': {
            batch: 100, reps: 5, keep: iRem, view: iRem.a,
            run: () => { for (let i = 0; i < 100; i++) iRem.s.get(rbase + i).remove(); rbase -= 100 },
          },
        }
      },
    },
  }
}

const specs: Record<string, OpSpec> = mode === 'v2' ? (WL as Record<string, OpSpec>) : buildV3Specs()

// ── eq-pass v2 minted-key alignment ──────────────────────────────────────────
// v2 mints insert keys via `''+$.random(sourceValue)`; v3's autoObjectKey is
// String(store.size) advancing past collisions. A per-source counter seeded at
// Object.keys(o).length reproduces v3's scheme exactly for these workloads
// (dense 0..n-1 numeric-keyed sources), so filter/single, map/insert,
// keys/insert, tap/insert, group/insert compare key-for-key. Restored after
// the eq pass — the timing pass keeps v2's native crypto.randomUUID cost.
let savedRandom: any = null
function installDetRandom(): void {
  savedRandom = $.random
  const ctr = new WeakMap<object, number>()
  $.random = (o: any) => {
    let c = ctr.get(o)
    if (c === undefined) c = Object.keys(o).length
    ctr.set(o, c + 1)
    return c
  }
}
function restoreRandom(): void {
  if (savedRandom) $.random = savedRandom
  savedRandom = null
}

// The eq view: v3 cases carry it explicitly; v2 extracts it from the
// workload's `keep` — a bare keep IS the view (ViewProxy = callable), a bundle
// keep lists the derived view LAST (true for every current workloads.ts case;
// verified export-by-export when this corpus was written).
function eqView(c: CaseSpec): any {
  if (c.view !== undefined) return c.view
  if (mode !== 'v2' || c.keep === undefined) return undefined
  if (typeof c.keep === 'function') return c.keep
  const vals = Object.values(c.keep)
  return vals[vals.length - 1]
}

// Ops whose only case is a setup get a dedicated eq builder so no op goes
// entirely unchecked (build-only, no writes — PRNG-neutral in both modes).
const EQ_SPECIAL: Record<string, () => unknown> = {
  'lengthFn/setup': () => {
    const src = mode === 'v2' ? WL.lengthFn.source(eqN) : srcBucket(eqN)
    const s = $(src)
    const h = s.length((d: any) => d.bucket)
    return h[V]
  },
}

// ── phases ────────────────────────────────────────────────────────────────────

interface EqRow { op: string; case: string; sum: string | null; note?: string }
interface TimingRow { op: string; case: string; label: string; ms: number; reps: number; batch?: number }
interface SkipRow { op: string; case: string; reason: string }

const skips: SkipRow[] = []
for (const [op, reason] of Object.entries(OP_SKIPS)) skips.push({ op, case: '*', reason })
for (const [id, reason] of Object.entries(CASE_SKIPS)) {
  const [op, kase] = id.split('/')
  skips.push({ op, case: kase, reason })
}

// Per-op reseed constants — identical across modes/phases by construction.
const opSeed = (oi: number, phase: number) => (0x9e3779b9 ^ Math.imul(oi + 1, 2654435761) ^ Math.imul(phase, 40503)) | 0

function runEqPass(): EqRow[] {
  const out: EqRow[] = []
  OPS.forEach((op, oi) => {
    if (!opSelected(op) || OP_SKIPS[op] !== undefined) return
    const spec = specs[op]
    reseed(opSeed(oi, 0))
    if (mode === 'v2') installDetRandom()
    try {
      spec.N = eqN
      const cases = spec.workloads()
      for (const [kase, c] of Object.entries(cases)) {
        if (!caseSelected(op, kase)) continue
        const id = `${op}/${kase}`
        if (CASE_SKIPS[id] !== undefined) continue
        const minN = MIN_N[id] ?? 1
        if (eqN < minN) {
          out.push({ op, case: kase, sum: null, note: `eq skipped: needs N >= ${minN} (hard-coded key range)` })
          continue
        }
        const special = EQ_SPECIAL[id]
        if (special !== undefined) {
          out.push({ op, case: kase, sum: checksum(op, special()) })
          continue
        }
        const view = eqView(c)
        if (view === undefined) {
          out.push({ op, case: kase, sum: null, note: 'setup case — build-and-discard, no retained end state' })
          continue
        }
        for (let w = 0; w < EQ_WRITES; w++) c.run()
        out.push({ op, case: kase, sum: checksum(op, view[V]) })
      }
    } finally {
      if (mode === 'v2') restoreRandom()
    }
  })
  return out
}

function runTimingPass(): TimingRow[] {
  const rows: TimingRow[] = []
  OPS.forEach((op, oi) => {
    if (!opSelected(op) || OP_SKIPS[op] !== undefined) return
    const spec = specs[op]
    reseed(opSeed(oi, 1))
    spec.N = timingN
    const cases = spec.workloads()
    const label = spec.label ?? op
    for (const [kase, c] of Object.entries(cases)) {
      if (!caseSelected(op, kase)) continue
      const id = `${op}/${kase}`
      if (CASE_SKIPS[id] !== undefined) continue
      const minN = MIN_N[id] ?? 1
      if (timingN < minN) {
        skips.push({ op, case: kase, reason: `N=${timingN} < ${minN} (hard-coded key range in the v2 closure; v3 deep-writes to missing keys throw)` })
        continue
      }
      rows.push({
        op, case: kase, label,
        ms: benchMeasure(c.run, c.reps),
        reps: c.reps ?? 5,
        ...(c.batch !== undefined ? { batch: c.batch } : {}),
      })
    }
  })
  return rows
}

const eq = RUN_EQ ? runEqPass() : []
gcSync?.()
const timing = runTimingPass()

console.log(
  JSON.stringify({
    mode,
    node: process.version,
    n: timingN,
    eqN,
    eqWrites: EQ_WRITES,
    eq,
    timing,
    skips,
  }),
)
