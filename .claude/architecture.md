# Architecture pointer

The canonical internals references are:

- [contract/SCHEDULE.md](../contract/SCHEDULE.md) — the executable timing &
  consistency contract (SCHEDULE_VERSION; conformance tests per clause in
  [conformance/schedule.test.ts](../conformance/schedule.test.ts)).
- [contract/delta.ts](../contract/delta.ts) — the closed delta algebra (the
  WHOLE verb surface: three row verbs, three order verbs, one scalar shape,
  one batch envelope).
- [kernel/](../kernel) — Runtime (two-phase batch commit), DataNode/SourceNode,
  Store. [ops/](../ops) — the operator registry + implementations.
  [seam/](../seam) — ingest/lane/wireSink/mount, the outside-world boundary.
- [STATUS.md](../STATUS.md) — the wishlist ledger and promotion history.

See CLAUDE.md at the repo root for the working guide.
