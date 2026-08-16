# v4 — status

*v4 = v3 + the fero wishlist, NOW THE REPO ROOT (promoted 2026-08-16; the v2
root surface, the frozen v3/ tree, the site, examples, and e2e layer live on
at the `v3` branch tip). Scaffolded 2026-08-01 as a full copy of `v3/` (v3
tip `ac37717`) with identities rebranded `data.v3` → `data.v4`. The wishlist
source of truth is fero-v2's DESIGN-DATA3.md (at fero's `master` branch tip
under `v3/` — retired from its v4 root, promoted the same day as ours)
(W1–W17); this file tracks their landing. Consumer: fero v4 (`../fero-v2`,
its repo root), whose substrate imports `../../data/api/index.ts`.*

Run: `npm test` / `npm run typecheck` / `npm run perf`.

## Wishlist ledger

| # | P | Item | State |
|---|---|---|---|
| W1 | P2 | Native wire egress (CommitBatch→WireRecord emitter + keyDomain batch header) | DONE — wireSink() + WireBatch; leaf-at-path settled |
| W2 | P1 | Origin-capable clone-free public subscription (connect opts / sink()) | DONE — sink() + connect opts |
| W3 | P1 | Deep-path law: (a) nested-field remove IMPL; (b) absent-remove no-op SPEC-PIN; (c) vivify-under-null/scalar SPEC-PIN; (d) per-record ingest isolation IMPL | DONE — SCHEDULE clause 10, VERSION 2 |
| W4 | P1 | Executable SCHEDULE suite (conformance/schedule.test.ts) + SCHEDULE_VERSION export | DONE — 16 tests over the 11 clauses (grown by W3/W15) |
| W5 | P3 | Backing-mounted sources ($(backing)) | DONE — mount(runtime, backing) live mirror |
| W6 | P3 | Pre-commit veto — doc-only under fero §4.1 | DONE (doc): fero owns the write trap (DESIGN-DATA3 §4.1) — every fero-side validation/auth bounce happens BEFORE data sees the write; no data-side veto hook needed. Returns as a real ask only if fero abandons §4.1. |
| W7 | P1 | Hot ingest lane (pre-declared profile, numeric type tags, lazy records) + replication corpus row + remove-floor statement | DONE — lane() + m3 gate (0.171× at frame-16) |
| W8 | P1 | Alloc + sink-cost budgets, gated, joint methodology; onCommit zero-cost-unhooked clause | DONE — m4-budgets gate (5 sections) + push-time suppression |
| W9 | P2 | Public each()/rowCount() + safe (COW/frozen-rows) snapshot | DONE — handle protocol + freeze opt |
| W10 | P3 | Re-scopable filter(fn, dep) via the reactive binder | DONE — RescopeFilterNode (dep = second parent) |
| W11 | P2 | Public promote()/adoption control | DONE — kernel + api + types |
| W12 | P2 | some(col)/every(col) overloads | DONE — col form + dedup |
| W13 | P3 | median/percentile/quantile | DONE — sorted-multiset QuantileNode, R-type-7 |
| W14 | P3 | Per-path connect() / deep-scalar emission | DONE — connectPath on source children |
| W15 | P3 | Value-domain portability clauses + NUL-key conformance | DONE — SCHEDULE clause 11 (VERSION 3) + conformance |
| W16 | P3 | Cancel "Phase 0.5 on v2" (docs) | DONE: the v2-side additive ingress (v3/STATUS.md:438 'fero Phase 0.5 items remain undone') is FORMALLY CANCELLED — fero migrates straight onto v4; nobody builds the v2-side apply()/clone:false/TIMING.md items. |
| W17 | P3 | fero-facing tracking artifact (this file IS it — keep current) | done (this file) |

## Baseline

- 2026-08-01 scaffold run: **test:v4 286/286 PASS** (byte-identical inherit
  from v3 apart from the identity rebrand). typecheck:v4 / perf:v4 verification
  pending in the log below.
- Copy caveats to watch: typecheck programs (`data/v4` importSource
  self-resolves via the tsconfig paths map).
- 2026-08-03 — the perf gates are SELF-CONTAINED: m1/m2/m3's v2-comparative
  referents were retired ahead of the v4 root promotion (final recorded A/B:
  m1 bare 0.65×/chain 0.77×, m2 brush 1.11×/batch 0.76×, m3 frame-16 0.151×
  of fero's v2 terminal apply — all under the 1.15× gates). They now gate on
  machine-calibrated absolute ceilings + the m1 chain/bare ratio + m3's
  cross-lane state equality; m4-budgets unchanged. The informational
  v2-comparison benches (corpus.bench, crossfilter-example.bench + children)
  were deleted with their referent.

## Log

- 2026-08-01 — scaffold: `cp -r v3 v4`, symbol/entry rebrand sed (0 residual
  `data.v3` refs), root scripts `test:v4`/`typecheck:v4`/`perf:v4` added;
  test:v4 286/286.
- 2026-08-03..16 — the ADVERSARIAL RE-EVALUATION (28-agent review, every
  serious finding double-verified) and its fix series, 7 data-side commits:
  wireSink application-order emission + keyDomain-from-key-identity (W1
  egress was desyncing replicas on compound array-born batches and
  mislabeling derived views); clause-7 mid-batch attach deferral
  (`attachSettled` — SCHEDULE_VERSION 3 → 4); ingest/lane reject delivery
  surviving a throwing effect sink; clause-10 edge pins (clean string-vivify,
  array-delete precedence, the four deleted-marker merges); the shipped-types
  catch-up (Reserved +7, some/every col overloads, promote → Writes,
  module-level ingest/lane/HOT/mount declared, surface.ts synced, fixtures);
  SCHEDULE.md drift repairs (header version, CI claim, clause-6 origin
  wording). Suite 330/330. fero-side: the lens write-builtin backdoor closed
  (set/update/patch/remove route through issue(); insert/ingest/raf/dispose
  throw; first()/last() wrap as lenses) and the ./internals entry repaired —
  fero 299/299 + 18/18 contract clauses.
- 2026-08-16 — THE ROOT PROMOTION: perf gates made self-contained (see
  Baseline), then the v4 tree moved to the repo root and everything else
  retired (v2 surface, v3/, site, examples, e2e, benches, dist, tsup,
  Playwright; package.json → name `data` v4.0.0, source-served exports, CI =
  test+typecheck, hook = the four-program type gate). fero re-pointed to
  `../../data/api/index.ts` + `../../data/conformance/schedule.test.ts`.
  Full battery green in both repos post-move.
- 2026-08-16 (later) — FERO'S OWN ROOT PROMOTION: fero-v2 moved its v4 tree
  to its repo root too (branch `v4`, package `fero` 4.0.0; its v2 surface +
  frozen v3 tree — incl. DESIGN-DATA3.md — live on at its `master` tip). The
  seam is now exactly one directory apart: substrate imports
  `../../data/api/index.ts`, contract ride
  `../data/conformance/schedule.test.ts`. fero battery green post-move
  (299/299 + 18/18 + perf 36/36).
