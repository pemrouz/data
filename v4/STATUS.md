# v4 — status

*v4 = v3 + the fero wishlist. Scaffolded 2026-08-01 as a full copy of `v3/`
(v3 tip `ac37717`) with the `data.v3`/`data/v3` identities rebranded to
`data.v4`/`data/v4`. v3 stays frozen-green as the A/B reference. The wishlist
source of truth is fero-v2's [v3/DESIGN-DATA3.md](../../fero-v2/v3/DESIGN-DATA3.md)
(W1–W17); this file tracks their landing here. Consumer: fero v4
(fero-v2/v4/), which migrates onto this tree once the P1 set lands.*

Run: `npm run test:v4` / `typecheck:v4` / `perf:v4` (root package.json).

## Wishlist ledger

| # | P | Item | State |
|---|---|---|---|
| W1 | P2 | Native wire egress (CommitBatch→WireRecord emitter + keyDomain batch header) | open |
| W2 | P1 | Origin-capable clone-free public subscription (connect opts / sink()) | DONE — sink() + connect opts |
| W3 | P1 | Deep-path law: (a) nested-field remove IMPL; (b) absent-remove no-op SPEC-PIN; (c) vivify-under-null/scalar SPEC-PIN; (d) per-record ingest isolation IMPL | DONE — SCHEDULE clause 10, VERSION 2 |
| W4 | P1 | Executable SCHEDULE suite (conformance/schedule.test.ts) + SCHEDULE_VERSION export | DONE — 11 tests, one per clause |
| W5 | P3 | Backing-mounted sources ($(backing)) | open |
| W6 | P3 | Pre-commit veto — doc-only under fero §4.1 | open |
| W7 | P1 | Hot ingest lane (pre-declared profile, numeric type tags, lazy records) + replication corpus row + remove-floor statement | DONE — lane() + m3 gate (0.171× at frame-16) |
| W8 | P1 | Alloc + sink-cost budgets, gated, joint methodology; onCommit zero-cost-unhooked clause | open |
| W9 | P2 | Public each()/rowCount() + safe (COW/frozen-rows) snapshot | open |
| W10 | P3 | Re-scopable filter(fn, dep) via the reactive binder | open |
| W11 | P2 | Public promote()/adoption control | open |
| W12 | P2 | some(col)/every(col) overloads | open |
| W13 | P3 | median/percentile/quantile | open |
| W14 | P3 | Per-path connect() / deep-scalar emission | open |
| W15 | P3 | Value-domain portability clauses + NUL-key conformance | open |
| W16 | P3 | Cancel "Phase 0.5 on v2" (docs) | open |
| W17 | P3 | fero-facing tracking artifact (this file IS it — keep current) | done (this file) |

## Baseline

- 2026-08-01 scaffold run: **test:v4 286/286 PASS** (byte-identical inherit
  from v3 apart from the identity rebrand). typecheck:v4 / perf:v4 verification
  pending in the log below.
- Copy caveats to watch: perf gate children (m1/m2 compare against v2 via
  dist — unchanged by copy), typecheck programs (`data/v4` importSource
  self-resolves via the tsconfig paths map).

## Log

- 2026-08-01 — scaffold: `cp -r v3 v4`, symbol/entry rebrand sed (0 residual
  `data.v3` refs), root scripts `test:v4`/`typecheck:v4`/`perf:v4` added;
  test:v4 286/286.
