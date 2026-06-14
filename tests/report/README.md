# Test report — Subject × Guarantee explorer

A self-contained HTML view over the whole test suite, organised **top-down**
(by behaviour) rather than by file. Opens on a **Subject × Guarantee** coverage
matrix; click a cell / row / column to drill into Trigger → assertion, with live
pass/fail + timing from the last run.

**Published** at [pemrouz.github.io/data/report/](https://pemrouz.github.io/data/report/)
— the build writes the artifact to a top-level `report/index.html` so GitHub Pages
serves it at that clean URL (outside `/examples/`). The sources that produce it
live here under `tests/report/`.

## Build it

```sh
npm run report        # run the unit suite, capture results, rebuild report/index.html
npm run report:build  # rebuild from the last results.json only (no test run)
```

Then open [report/index.html](../../report/index.html) (a single self-contained
file — no server needed; `localhost:PORT/report/` also works, and it's live on
Pages at [pemrouz.github.io/data/report/](https://pemrouz.github.io/data/report/)).

## How it works

| File | Role |
|---|---|
| [run.mjs](run.mjs) | Runs the unit suite (`node --test`, **same scope as `npm test`**) with the TAP reporter, parses pass/fail + `duration_ms` per test, writes `results.json` (gitignored). |
| [build.mjs](build.mjs) | Merges three sources into one record per test, then inlines everything into the top-level `report/index.html`. |
| [report.css](report.css) / [app.js](app.js) | Styles + client logic, inlined into the built HTML. |
| `../../report/index.html` | The built artifact (committed so it opens — and serves on Pages — without a build). |

Each test gets a **coordinate**: `Subject · Guarantee · Trigger · Shape · via · issue — assertion`.
The data comes from two places:

- **Authoritative** — files migrated to the `spec()` format (see [../../tests/spec.ts](../../tests/spec.ts))
  contribute exact facets via [../../tests/registry.json](../../tests/registry.json). These rows
  carry a `✓`. Regenerate the registry with
  `SPEC_COLLECT=1 node --experimental-strip-types tests/collect-registry.ts`.
- **Heuristic** — un-migrated files have their facets inferred from the test title
  (directionally right, not exact). Migrating a file to `spec()` makes its row exact.

As of now the **entire `npm test` unit suite is migrated** — every row is authoritative
(registry spec count == suite test count). The heuristic path remains for any *future*
un-migrated test file; the only non-authoritative rows today are perf/e2e (rendered *unrun*).
The full file list lives in [../collect-registry.ts](../collect-registry.ts) — add new test
files there when they're created.

## Auto-update on commit

A tracked git hook ([../../.githooks/pre-commit](../../.githooks/pre-commit)) keeps the report
in sync: when a commit stages any `.ts` file, it refreshes the registry, runs the unit suite,
rebuilds `report/index.html`, and includes both in that commit (docs-only commits skip it). It
**records** results — it does not block the commit on test failures.

The hook is enabled via `core.hooksPath` — set automatically on `npm install` (the `prepare`
script) or manually with:

```sh
git config core.hooksPath .githooks
```

- Bypass for one commit: `git commit --no-verify`
- Want fast commits instead? Change `npm run report` to `npm run report:build` in the hook
  (structure-only, ~0.5s; pass/fail then carries over from the last full `npm run report`).

## Notes / limits

- Live status covers the **unit** suite only; perf/e2e/experiments render as *unrun*
  (they're not part of the unit gate).
- Results are **baked at build time**, not auto-watched. Re-run `npm run report` to refresh.
- Results are keyed by test title; the rare duplicate title across files shares a status.
