# v3 rewrite — status

*Updated 2026-07-02 (autonomous session on branch `v3`). Plan: [plans/v3/PLAN.md](../plans/v3/PLAN.md);
architecture detail: [plans/v3/concepts/keyed-delta.md](../plans/v3/concepts/keyed-delta.md).*

## Where things stand

| Milestone | State | Commit | Gate |
|---|---|---|---|
| Plan + audit docs | done | `b963b66` | — |
| **M0** contract + conformance kit | done | `122895c` | kit red/green on toy ops — PASS |
| **M1** kernel + filter/map/compare + sum/avg/length + v2-record sink | done | `219897d` | legality+replay everywhere; single-tick 0.91–1.04× v2 (≤1.15) — PASS |
| **M2** hard ports (ordered/between/setops/bucket/misc) + differential fuzz | done | `ac3b16b` | C-series scenario family exact-equal; brush 0.98–1.04×, batch 0.74–0.86× v2 — PASS |
| **M3** public API (non-callable handle, RESERVED dispatch, methods-only writes) | done | `faac6f8` | 117 tests incl. collision/thenable/dedup semantics |
| **M4** keyed render + reactive args + seam | core done | (this commit) | 169 tests; keyed DOM identity, mirror/raf/ingest live |
| M4.5 builders/JSX + devtools panel port | not started | | |
| M5 examples migration + flip | not started | | |

Run everything: `node --experimental-strip-types --no-warnings --test v3/**/*.test.ts` (117 tests).
Perf gates: `node --experimental-strip-types --no-warnings v3/perf/m1-gate.ts` and
`... --expose-gc v3/perf/m2-gate.ts`. v2's `npm test` is untouched and green (v2 files unmodified).

## Layout

- `v3/contract/` — the closed delta algebra ([delta.ts](contract/delta.ts)), wire profiles +
  RESERVED + foldSnapshot ([index.ts](contract/index.ts)), the versioned timing contract
  ([SCHEDULE.md](contract/SCHEDULE.md)).
- `v3/conformance/` — legality checker, replay sink, harness (`conform`/`conformScalar`/
  `assertOracle`), the cross-op differential fuzz ([differential.test.ts](conformance/differential.test.ts)).
- `v3/kernel/` — Store, SourceNode (path-copy writes, consolidation, order channel), Scope,
  Runtime (two-phase commit, height-order flush, origin tokens, graph registry + onCommit hook).
- `v3/ops/` — registry + all operator families. Every op conformance-wrapped in its tests.
- `v3/api/` — `$()`, the non-callable handle, RESERVED dispatch, scope-owned dedup.
- `v3/compat/` — the permanent v2 ChangeRecord profile.
- `v3/perf/` — m1/m2 gates (read their METHODOLOGY comments before touching numbers —
  three measurement traps are documented there and each one produced a wrong verdict first).

## Decisions made en route (beyond the plan)

- **Native addressing is by KEY, everywhere** (sugar, `get()`, `patch`). After a mid-insert,
  positions ≠ keys; positional addressing belongs to the v2-compat lens and the DOM sink.
- **Ordered views materialize as arrays in rank order** (the v2 sort shape).
- **Windowed-sort tie order = view-arrival seq** (re-entry appends): deterministic and
  compositional; pinned by a double-run byte-equality test, checked up-to-ties by the oracle.
- **Consolidation annihilates net-zero updates** (flip A→B→A in one batch emits nothing).
- **between's bounds are a hidden input SourceNode** — the reactive-value-arg pattern
  (uniform binder for filter/compare/sort args should reuse this shape).
- **Operator-view children are read-only projections** (writes throw, pointing at the source).

## M4 state (this commit)

- `v3/render/`: ordered-children AST (el/text/rtext/list — the single-static-slot trap is
  structurally dead), render() with per-mount + per-row scopes, the KEYED list sink
  (Map<RowKey, Element>; orderMove = one insertBefore of the EXISTING element — identity
  survives, asserted), MirrorNode (the $(view)-swap replacement: a repoint is one
  consolidated diff commit; overlapping keys emit nothing so DOM survives) and raf().
- `v3/ops/reactive.ts`: the uniform reactive value-slot binder — gt/lt/gte/lte/za/az/top/
  limit/sum/avg accept reactive args (handles or nodes) via registry wrapping; dedup by
  bound-node identity; param subscriptions die with the operator.
- `v3/seam/`: public ingest() (both wire profiles, origin-token echo suppression round-trip
  tested, live-key add tolerance for LWW), fromAsync (pending/ready/error, batch-per-drain,
  dispose-cancels), SourceBacking interface + InMemoryBacking proof, exportContract() (the
  machine-readable manifest — fero deletes its hand-copied BUILTIN set against it).
- Kernel fix (seam agent's find): batch(fn, origin) restored the origin BEFORE flushing —
  batch-level echo suppression was silently dead; queued re-entrant writes now also capture
  their issue-time origin. Regression test in kernel.test.ts.

## Known gaps / next work (M4.5+)

1. **Builders/JSX** (M4.5): the full HTML.*/SVG.* DSL + h/Fragment/For over the AST;
  per-binding surgical PROP updates (render currently re-runs a row's text bindings);
  structural row diff; components/onCleanup/error-boundary scopes.
2. **Devtools**: consume runtime.graph() + onCommit (both implemented, unconsumed).
3. **v2-recorded-stream byte parity** — capture real v2 streams from the examples and
  parity-test compat/v2-records.ts against them (only shape-level tests exist).
4. **Types-first surface** (`Data<T>`/`Ops<T>` generated from the registry) + tsconfig
  wiring (v3 files are outside all typecheck gates — strip-types only).
5. Kernel niceties flagged by agents: reparent()/adoptParent() helpers (mirror/reactive
  cast into parents today); height re-propagation after repoint (stale-height edge — not
  reachable in shipped tests but real); a ScalarSource cell primitive; SourceNode.move()
  for ingest's deferred 'move' records; export ProjectionAggregate; deep-scalar emission
  mode; per-path connect(); positional limit(); page().
6. **M5**: example migrations (todo first), v2 perf corpus re-baseline, MIGRATION.md,
  the flip. fero Phase 0.5 items on the v2 side remain undone.

## Standing methodology rules (hard-won; do not regress)

- Perf: monotonic write values (never measure the no-op path); one engine per process;
  deep warmup (10× inner); per-sample `gc()`; median-of-replicate-ratios.
- Every new operator: conformance-wrap every node in its tests + oracle every step + a
  seeded LCG churn ≥300 steps; add a composition case to differential.test.ts.
- v2 stays untouched on this branch until the M5 flip; every v2 bugfix during the window
  must add a differential scenario v3 also passes.
