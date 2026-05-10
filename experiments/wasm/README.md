# WASM experiment — would this library benefit from WebAssembly?

**Short answer: yes, but most of the win is actually a data-structure fix that needs no WASM. WASM adds another 30–40% on top of that.**

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

Per-tick latency (µs), median over 5 runs:

| N       | JS (existing) | JS-typed | WASM | typed/JS | WASM/typed (incremental WASM win) |
|--------:|----:|----:|----:|----:|----:|
| 1 000   | 20.6 | 6.7 | 5.2 | **3.1×** | 1.29× |
| 10 000  | 227.0 | 27.8 | 21.5 | **8.2×** | 1.29× |
| 50 000  | 736.6 | 86.8 | 66.1 | **8.5×** | 1.31× |
| 100 000 | 2086.5 | 209.6 | 147.8 | **9.96×** | 1.42× |

All three paths produce identical max values (verified per run).

## What the numbers say

**The 11× speedup at N=100k decomposes cleanly:**

```
JS existing  → JS-typed  : ~10× win  ←  data-structure fix (eliminating Object.values allocation)
JS-typed     → WASM      : ~1.4× win ←  the WASM kernel
```

**Why is `Object.values` so expensive?** Every `_publish` call allocates a fresh array containing all currently-tracked values. At 100k rows, that's a 100k-element allocation per tick. 1000 ticks × 100k allocations = 100M elements of GC pressure. The variance pattern in the raw runs (JS path: 1583–2305 ms, range 46%) vs WASM (110–283 ms, range 61% but lower median) is consistent with GC dominating the JS baseline.

**Why doesn't WASM win more?** Because once the data lives in a packed Float64Array, the JS `for (i=0; i<n; i++) if (arr[i] > m) m = arr[i]` loop is genuinely fast (~1–3 ns/elem in the steady state). WASM does the same loop with slightly tighter codegen and no JIT warmup, but it's not a fundamentally different algorithm.

## Implications for the library

**Without changing the public API, this experiment surfaces a real ~10× improvement available at the aggregate operator** — but **WASM is not the load-bearing piece of it**. The data-structure refactor is.

A pure-JS rewrite of [`operators/aggregate/index.ts`](../../operators/aggregate/index.ts) that replaces the `tracked: { [key]: number }` object with a packed `Float64Array` + `Map<key, slot>` would:

- Remove the per-tick `Object.values()` allocation,
- Eliminate the GC pressure,
- Reach ~80–90% of the speedup demonstrated here,
- Require **zero WASM toolchain**, no devDep, no build step.

The same pattern likely applies to `Sum`/`Avg`/`Min`/`Some`/`Every`'s `_afterReset` (they all iterate `Object.values(this.tracked)`), although those run only on full reset, not per delta — so the win is concentrated in `Max` and `Min`'s `_publish`.

WASM's incremental contribution after that fix is **1.3× at small N, 1.4× at large N**. That's a real win, but it's the kind of marginal optimization that doesn't usually justify a build-step + WASM toolchain dependency on its own.

## Recommendation

Three reasonable courses of action, in order of value:

1. **Fix the data structure (no WASM).** Refactor `AggregateValue` to use a packed `Float64Array` + slot map instead of a sparse object. ~10× speedup on the aggregate-heavy hot path. No public API change. No new dependencies. This is the actual answer to the question.
2. **Land the data-structure fix, then consider WASM.** Once the column is packed, plugging in a WASM kernel is incremental — at large N, the extra 30–40% is real, and the wasm artifact is small (454 bytes for our three kernels). Worth doing only if a target user has a 100k+-row aggregate workload where the 30% matters.
3. **Don't bother with WASM at all.** For the workloads currently in the perf suite (mostly ≤10 000 rows) and for the operators where the hot path is a user JS callback (filter/map/group/reduce/distinct/to/sort with comparator), WASM offers no meaningful benefit. The boundary cost dominates and you can't put user closures inside a WASM module.

The `between` operator and the `intersect`/`union` bitmask path (the other plausible WASM targets identified during planning) were not implemented in Layer 2, but Layer 1's `wasm-extract` numbers strongly suggest they'd land in the same place — break-even or modest win, dominated by the cost of getting JS-shaped data into wasm memory.

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
