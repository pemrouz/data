# site/ — the landing page

The page at https://pemrouz.github.io/data/ runs the REAL v4 engine in the browser: the api
cone and the conformance suite are type-stripped file-for-file into `lib/` by `strip.mjs`
(Node's `stripTypeScriptTypes`, zero dependencies), and every figure the page prints is
measured or read from the runtime in the visitor's own tab. The rule is `REAL.md`: every
printed digit carries `data-attested="runtime|measured|build"`, nothing is canned, peers load
only when selected — and `tools/audit.mjs` fails the page otherwise.

Build & serve, from the repo root:

    node site/strip.mjs                     # lib/ + gen/ (gitignored) — re-run after any engine change
    node site/build.mjs                     # index.html ← page.html + sections/*.html (gitignored)
    node site/tools/serve.mjs site 4176     # → http://localhost:4176/
    node site/tools/audit.mjs http://localhost:4176/ --proofs 18   # the honesty gate: must be 0 problems

Deploy: `.github/workflows/pages.yml` runs exactly that build on push and publishes `site/`
minus the dev-only material (shots/, ref/, tools/, the notes, the two build scripts).

Layout: `page.html` (masthead, footer, the importmap markers) · `sections/<name>.{html,css,js}`
in the order lede · race · argument · operators · start · devtools · contract · wire · gallery
(`sections/<name>.md` = that section's notes, attestation map and measurements) · `engine.js`
(boots the engine once; `attest` / `put` / `fmt` / `fps`) · `variants.*` (the design round's
options bar: `?bar=1` shows it, `?<section>=<v>` picks an unpicked variant; the picked ones are
the defaults) · `data/flights.js` (the real 231,083 flights, 37 MB, fetched by the race's worker)
· `shim/` (node:test / node:assert for the in-browser conformance run) · `ref/` (the old site's
pieces the sections were ported from) · `shots/` (review screenshots, local only).
