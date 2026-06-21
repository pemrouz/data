// Consumer JSX type-check fixture — the CLASSIC transform (jsxFactory `h`,
// jsxFragmentFactory `Fragment`), the same transform the example projects use.
// Compiled by `tsc -p tsconfig.typecheck.jsx.json` with noCheck:false so the
// global JSX namespace in jsx/jsx.d.ts and the h/Fragment/For factories are
// actually validated — the example tsconfigs inherit noCheck:true, so until now
// NOTHING ever type-checked the JSX surface.
//
// NB this gates the CLASSIC surface (per-tag IntrinsicElements narrowing works
// here). The AUTOMATIC runtime (jsxImportSource:"data") is currently an
// all-`any` bag that catches nothing; it gets its own fixture once B5 lifts it
// to parity with these per-tag interfaces.
import { h, Fragment, For, $ } from '../full.ts'
void h; void Fragment // referenced by the classic transform, not directly here

const items = $([{ id: 1, label: 'a' }, { id: 2, label: 'b' }])

// Per-tag attribute narrowing: each tag's explicit props are validated even
// though IntrinsicElements keeps an open `[tag]: any` index signature (an
// explicit interface member wins over the index signature).
const view = (
  <div className="wrap" id="root">
    <input type="checkbox" checked={true} />
    <button type="submit" disabled={false} onClick={() => {}}>go</button>
    <label htmlFor="name-field">name</label>
    {/* <For> children arrow: `item` must be annotated until B4 adds generics. */}
    <For each={items}>
      {(item: { id: number; label: string }) => <li>{item.label}</li>}
    </For>
  </div>
)
void view

// Fragment shorthand (`<>…</>` → Fragment(null, …)).
const frag = (
  <>
    <span>a</span>
    <span>b</span>
  </>
)
void frag

// SVG presentation/geometry attrs are typed via the SVGAttributes interface.
const svg = (
  <svg viewBox="0 0 10 10">
    <circle cx={5} cy={5} r={4} fill="red" />
  </svg>
)
void svg

// --- NEGATIVE: per-tag narrowing has teeth (proves it's not all-`any`) ---
// @ts-expect-error — 'bogus' is not a valid <input type>
const badInput = <input type="bogus" />
void badInput
