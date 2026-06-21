// Automatic-runtime JSX fixture (jsxImportSource "data" / jsx "react-jsx") — the
// PUBLISHED consumer path. Compiled by tsc -p tsconfig.typecheck.auto.json with
// a `paths` map so `data/jsx-runtime` resolves to the source (not stale dist).
//
// Before B5 the automatic runtime was an all-`any` prop bag and caught NOTHING;
// it now shares jsx/intrinsics.ts with the classic transform, so per-tag
// narrowing applies here too. No manual import — the runtime is auto-injected.

const view = (
  <div className="wrap" id="root">
    <input type="checkbox" checked={true} />
    <button type="submit" disabled={false}>go</button>
    <svg viewBox="0 0 10 10"><circle cx={5} cy={5} r={4} fill="red" /></svg>
  </div>
)
void view

// NEGATIVE: per-tag narrowing has teeth on the automatic runtime now too.
// @ts-expect-error — 'bogus' is not a valid <input type>
const bad = <input type="bogus" />
void bad
