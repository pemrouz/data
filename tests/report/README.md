# Test report — Subject × Guarantee explorer

A self-contained HTML view over the whole test suite, organised **top-down**
(by behaviour) rather than by file. Opens on a **Subject × Guarantee** coverage
matrix; click a cell / row / column to drill into Trigger → assertion, with live
pass/fail + timing from the last run.

## Build it

```sh
npm run report        # run the unit suite, capture results, rebuild explorer.html
npm run report:build  # rebuild from the last results.json only (no test run)
```

Then open [tests/report/explorer.html](explorer.html) (a single self-contained
file — no server needed; `localhost:PORT/tests/report/explorer.html` also works).

## How it works

| File | Role |
|---|---|
| [run.mjs](run.mjs) | Runs the unit suite (`node --test`, **same scope as `npm test`**) with the TAP reporter, parses pass/fail + `duration_ms` per test, writes `results.json` (gitignored). |
| [build.mjs](build.mjs) | Merges three sources into one record per test, then inlines everything into `explorer.html`. |
| [report.css](report.css) / [app.js](app.js) | Styles + client logic, inlined into the built HTML. |
| `explorer.html` | The built artifact (committed so it opens without a build). |

Each test gets a **coordinate**: `Subject · Guarantee · Trigger · Shape · via · issue — assertion`.
The data comes from two places:

- **Authoritative** — files migrated to the `spec()` format (see [../../tests/spec.ts](../../tests/spec.ts))
  contribute exact facets via [../../tests/registry.json](../../tests/registry.json). These rows
  carry a `✓`. Regenerate the registry with
  `SPEC_COLLECT=1 node --experimental-strip-types tests/collect-registry.ts`.
- **Heuristic** — un-migrated files have their facets inferred from the test title
  (directionally right, not exact). Migrating a file to `spec()` makes its row exact.

## Notes / limits

- Live status covers the **unit** suite only; perf/e2e/experiments render as *unrun*
  (they're not part of the unit gate).
- Results are **baked at build time**, not auto-watched. Re-run `npm run report` to refresh.
- Results are keyed by test title; the rare duplicate title across files shares a status.
