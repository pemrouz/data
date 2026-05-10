# WASM experiment — would this library benefit from WebAssembly?

**Short answer: no. The available speedup was real (~12–19× on a max-aggregate-bound workload at N=50k–100k) but it all came from data-structure fixes in pure JS. With both fixes landed, the remaining WASM advantage is in the noise.**

**Status:** both data-structure fixes have been landed in [operators/aggregate/index.ts](../../operators/aggregate/index.ts):
- `AggregateValue.tracked` is now a `Map` (was a plain object). Per-publish iteration uses `tracked.values()` instead of allocating a fresh `Object.values()` array. ~2.5–3× win at N=50k–100k.
- `MaxValue`/`MinValue` additionally maintain a parallel `Float64Array` keyed by a `key→slot` map, with a sticky fallback to `Map.values()` iteration the moment a non-numeric value arrives (preserves the `max('date')` use case). Another ~5–6× on top.

After both fixes, the WASM kernel's incremental win at the same workload is ~1.0–1.25× — essentially measurement noise. **WASM is no longer worth pursuing for this library.**

## What this is

A self-contained empirical experiment that asks: if we plug WebAssembly kernels into the hot paths of this reactive library, do we get a real-world speedup, or does the JS↔WASM boundary cost eat the gain?

Two layers of measurement:

1. **Layer 1 (`bench-kernels.ts`)** — pure microbenchmarks. WASM kernels (`max_f64`, `between_f64`, `bitmask_and`) vs equivalent JS, sweeping N from 100 to 1 000 000.
2. **Layer 2 (`bench-pipeline.ts`)** — a real reactive pipeline (`data.max('val')` over N rows × 1000 single-row mutations) running through three operator implementations to isolate where the win comes from.

## How to run

```bash
npm run bench:wasm:build       # compile AssemblyScript → release.wasm
npm run bench:wasm:kernels     # Layer 1
npm run bench:wasm:pipeline    # Layer 2 (default N=50000)
BENCH_N=100000 npm run bench:wasm:pipeline   # scale up
```

Outputs: `results-kernels.md`, `results-pipeline.md`. Both also print to stdout.

## Layer 1 result — kernel only

`max` over a Float64Array, ns/element (lower is better):

| N         | js-naive (objs) | js-typed (typed array) | wasm-warm (data in wasm) | wasm-load (typed→wasm/call) | wasm-extract (objs→wasm/call) |
|----------:|----:|----:|----:|----:|----:|
| 100       | 2.24 | 8.17 | **0.74** | 1.07 | 2.01 |
| 1 000     | 1.95 | 6.91 | **0.60** | 0.72 | 2.46 |
| 10 000    | 2.36 | 6.89 | **0.67** | 0.83 | 2.89 |
| 100 000   | 3.84 | 7.73 | **0.69** | 1.30 | 4.19 |
| 1 000 000 | 4.81 | 2.47 | **0.85** | 1.94 | 7.80 |

Two observations:

- The WASM kernel itself (**wasm-warm**) is **3–10× faster** than the best JS path at every N tested.
- But **wasm-extract** (which is what any realistic integration in this library has to do — extract a column from JS objects into wasm memory per call) is barely competitive with **js-naive** (the current path). At N=100k they're tied; at N=1M, JS wins.

So the kernel is great in isolation, but the data-marshalling cost typically destroys the win. **WASM only delivers if you can amortize the column extraction across many calls** — which means changing the library's internal data structure, not just plugging in a kernel.

Full table including `between` and `bitmask_and` and the per-call boundary cost in µs is in [results-kernels.md](./results-kernels.md).

## Layer 2 result — actual pipeline

Workload: `data.max('val')` over N rows, then 1000 single-row updates. Median of 5 runs.

Three implementations:

- **JS aggregate (existing)** — what the lib ships today. `_publish` does `for (const v of Object.values(this.tracked)) ...`.
- **JS-typed aggregate** — same packed `Float64Array` layout as the WASM version, but the max scan happens in pure JS. Isolates the data-structure win.
- **WASM aggregate** — packed `Float64Array` is a slice of wasm linear memory; `_publish` calls the WASM kernel.

Per-tick latency (µs), median over 5 runs.

**Stage 1 — pre-refactor (baseline = `Object.values(tracked)` per publish):**

| N       | JS (existing) | JS-typed | WASM | typed/JS | WASM/typed |
|--------:|----:|----:|----:|----:|----:|
| 1 000   | 20.6 | 6.7 | 5.2 | **3.1×** | 1.29× |
| 10 000  | 227.0 | 27.8 | 21.5 | **8.2×** | 1.29× |
| 50 000  | 736.6 | 86.8 | 66.1 | **8.5×** | 1.31× |
| 100 000 | 2086.5 | 209.6 | 147.8 | **9.96×** | 1.42× |

**Stage 2 — after `tracked → Map` (intermediate):**

| N       | JS (Map.values) | JS-typed | WASM | typed/JS | WASM/typed |
|--------:|----:|----:|----:|----:|----:|
| 50 000  | 292.4 | 68.3 | 43.8 | **4.28×** | 1.56× |
| 100 000 | 661.0 | 127.1 | 86.5 | **5.20×** | 1.47× |

**Stage 3 — after `MaxValue` Float64Array fast path (current):**

| N       | JS (Float64+fallback) | JS-typed (experiment) | WASM (experiment) | typed/JS | WASM/JS |
|--------:|----:|----:|----:|----:|----:|
| 1 000   | 5.3 | 8.3 | 4.3 | 0.64× | **1.23×** |
| 10 000  | 17.6 | 20.8 | 15.9 | 0.84× | **1.11×** |
| 50 000  | 61.7 | 84.0 | 55.6 | 0.73× | **1.11×** |
| 100 000 | 108.2 | 168.0 | 105.6 | 0.64× | **1.02×** |

The current JS path beats the experimental TypedMaxValue (because it uses the production AggregateValue's `tracked` Map for slot management instead of a separate Map keyed off wasm memory) and ties the WASM path within ~10% across all sizes. **The optimal-JS implementation is now within noise of WASM.**

All three paths produce identical max values (verified per run).

## What the numbers say

**The total speedup at N=100k decomposes cleanly:**

```
Object.values   → Map.values         : ~3.2× win   ←  Map fix (LANDED)
Map.values      → Float64Array+fallback: ~6.1× win  ←  Float64Array fix (LANDED)
Float64Array    → Float64Array+WASM   : ~1.0× win  ←  WASM kernel (NOT pursued)

Cumulative pure-JS win:  ~19× over original
Additional WASM win:     ~0% (in noise)
```

**Why is `Object.values` so expensive?** Every `_publish` call allocates a fresh array containing all currently-tracked values. At 100k rows, that's a 100k-element allocation per tick. 1000 ticks × 100k allocations = 100M elements of GC pressure. The variance pattern in the raw runs (JS path: 1583–2305 ms, range 46%) vs WASM (110–283 ms, range 61% but lower median) is consistent with GC dominating the JS baseline.

**Why doesn't WASM win more?** Because once the data lives in a packed Float64Array, the JS `for (i=0; i<n; i++) if (arr[i] > m) m = arr[i]` loop is genuinely fast (~1–3 ns/elem in the steady state). WASM does the same loop with slightly tighter codegen and no JIT warmup, but it's not a fundamentally different algorithm.

## Implications for the library

**The experiment surfaced a real ~19× improvement at the aggregate operator** — and **WASM was not the load-bearing piece of it**. The two data-structure fixes are.

Both fixes have landed in [`operators/aggregate/index.ts`](../../operators/aggregate/index.ts). The remaining WASM advantage on the same workload is in the noise (1.0–1.25× at N=1k–100k, with the gap shrinking as N grows because the optimal-JS tight loop becomes more amortizable).

## Recommendation

1. **(LANDED) `tracked: Map` instead of `{}`.** ~3× at N=100k.
2. **(LANDED) `MaxValue`/`MinValue` keep a parallel `Float64Array` with sticky fallback to `Map.values()` on non-numeric.** Another ~6× at N=100k. Fallback is exercised by the `max - col accessor + Date values` test ([aggregate.test.ts:95–103](../../operators/aggregate/aggregate.test.ts#L95-L103)) plus three new mode-flip regression tests added alongside.
3. **(NOT pursued) WASM kernel.** With both fixes landed, WASM's incremental contribution is ~1.0× at N=100k and ~1.1× at smaller N — within run-to-run variance. The cost (build step, ship-or-build a `.wasm` artifact, memory management surface, browser-compat surface) does not justify the noise-level win.

The `between`, `intersect`/`union`/`except` bitmask paths — the other plausible WASM targets identified during planning — were not implemented. Layer 1's `wasm-extract` numbers (table above) suggested they'd be similar — and given that the optimal-JS Float64Array path now ties WASM on the only operator where WASM had a measurable kernel-level advantage, there's little reason to expect the others would diverge.

## Files

- `assembly/index.ts` — AssemblyScript source for the three kernels.
- `asconfig.json` — `asc` build config (release target, `-O3`, runtime stub).
- `loader.ts` — Node-side wasm instantiation and memory-view helpers.
- `bench-kernels.ts` — Layer 1.
- `bench-pipeline.ts` — Layer 2.
- `operators/aggregate-wasm.ts` — `WasmMaxValue`, `TypedMaxValue` (the JS-typed reference), `WasmMinValue`. Read alongside [operators/aggregate/index.ts](../../operators/aggregate/index.ts) to see what the change would look like in-place.
- `build/release.wasm` — build artifact (gitignored). Re-create with `npm run bench:wasm:build`.
- `results-kernels.md`, `results-pipeline.md` — last run's full output.

## Caveats

- All measurements are on Node v25.9 / V8. Browser engines (especially Safari) may differ — V8 is generally one of the fastest JS engines for typed-array tight loops, so the WASM/JS gap could be wider on Safari or Firefox. Not tested.
- The pipeline benchmark exercises `max('val')` with **no upstream filter**, so all N rows are tracked. A brushed scenario (e.g. `between(...).max(...)` where only a small subset is tracked) would have a smaller `nextSlot` and therefore a smaller WASM win in absolute terms — though the relative ratio should hold.
- The experiment did not attempt SIMD-128 hand-tuning. AssemblyScript at `-O3` produces scalar f64 ops for `max_f64`; a hand-written WAT version using `f64x2.max`/`f64x2.pmax` could be ~2× faster on the kernel, possibly bumping the 1.4× pipeline win to 1.7–1.9×. Not pursued because the data-structure fix is the more impactful change.
