# Architecture reference → moved

The architecture & notification-protocol reference now lives at the repo root as a human-facing doc:

➜ **[../PROTOCOL.md](../PROTOCOL.md)**

It was promoted out of `.claude/` so it's discoverable from the README — not just by Claude sessions. The View / Sink contract, the full notification-code legend (`XU0`/`BU1`/`BI0`/`BH1`/`BF0`/`BMV1`/`BR1A`/`BI0A`/…), propagation rules, the array-source shift contract, operator dedup, WeakRef sink cleanup, and the render/devtools internals all live there now.

This file is kept only as a pointer because several docs still link here. **Edit [../PROTOCOL.md](../PROTOCOL.md)** (the canonical source), not this stub.
