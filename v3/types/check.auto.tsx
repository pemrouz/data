// v3/types/check.auto.tsx — AUTOMATIC-transform JSX fixtures (jsx
// "react-jsx", jsxImportSource "data/v3"). Compiled by `npx tsc -p
// v3/types/tsconfig.auto.json` (noCheck:false): the transform resolves
// `data/v3/jsx-runtime` through the paths map to ./jsx-runtime-decl.d.ts,
// whose exported JSX namespace aliases the SAME ../jsx/intrinsics.ts the
// classic gate checks — so this file re-runs the SAME fixture shapes under
// the other transform and proves the two surfaces narrow identically. No h
// import — the runtime is auto-injected; For/bind/text still import from
// the declaration facades. Positives must compile; every @ts-expect-error
// line must NOT (a quiet directive fails as TS2578). Never executed.

import { For, bind, text, onCleanup, ErrorBoundary } from './jsx-surface.ts'
import { typedDollar as $ } from './surface.ts'

const todos = $({
  t1: { title: 'ship the gate', done: false, priority: 2 },
  t2: { title: 'write the fixtures', done: true, priority: 1 },
})

// ── per-tag narrowing: known props on known tags stay strictly checked ───────
const form = (
  <div class="wrap" id="root">
    <input type="text" placeholder="search" />
    <input type="checkbox" checked={bind(todos.t1.done)} /> {/* bind over a View<boolean> */}
    <input type="checkbox" checked={todos.t1.done} /> {/* a bare handle prop auto-binds */}
    <a href="https://example.com" target="_blank" rel="noreferrer">docs</a>
    <button type="submit" disabled={false} onClick={(e) => { void e }}>go</button>
  </div>
)
void form

// ── the open index signature: data-* / aria-* / unknown TAGS still pass ──────
const open = (
  <section data-pane="left" aria-label="tasks" aria-hidden={false} role="list">
    <custom-tag anything={1} />
  </section>
)
void open

// ── class as a static string AND as a reactive value ─────────────────────────
const cls = <div class="static" />
const rcls = <div class={todos.t1.title} /> // a DataChild<string> is a ViewLike
void cls; void rcls

// ── static + reactive text SIBLINGS + the accepted-and-ignored JSX key ───────
const counter = <span>total: {todos.length()} rows</span>
const keyed = <ul>{[<li key="a">a</li>, <li key="b">b</li>]}</ul>
void counter; void keyed

// ── <For>: the row type flows from each={view} with NO annotation ────────────
const board = (
  <ul>
    <For each={todos}>
      {(row, key) => <li id={String(key)} title={row.title.toUpperCase()}>{row.title}</li>}
    </For>
  </ul>
)
void board

// ── <For> over an ORDERED derived view (OrderedData lands on the same row) ───
const ranked = (
  <ol>
    <For each={todos.az('priority')}>{(row) => <li>{row.priority}</li>}</For>
  </ol>
)
void ranked

// ── text()/bind(): the format fn's param infers from the bound view ──────────
const fmt = (
  <div title={bind(todos.t1.priority, (n) => n.toFixed(1))}>
    {text(todos.t1.title, (s) => s.toUpperCase())}
  </div>
)
void fmt

// ── Fragment shorthand (auto-resolved from the runtime) + SVG attrs ──────────
const frag = (
  <>
    <span>a</span>
    {todos.t1.title}
  </>
)
void frag
const chart = (
  <svg viewBox="0 0 100 40">
    <path d={bind(todos.t1.title)} stroke-width={2} fill="none" />
    <circle cx={5} cy={5} r={4} />
  </svg>
)
void chart

// ── components + ErrorBoundary narrow identically under the AUTOMATIC transform
function Badge(props: { label: string; count: number; children?: unknown }) {
  onCleanup(() => {})
  return <span class="badge">{props.label}</span>
}
const badge = <Badge label="open" count={3} />
const guarded = (
  <ErrorBoundary fallback={(err, reset) => <button onClick={() => reset()}>{String(err)}</button>}>
    <Badge label="x" count={1} />
  </ErrorBoundary>
)
void badge; void guarded

// ── negatives: each marked line MUST error ───────────────────────────────────
// @ts-expect-error — a function child under a STRING tag mirrors normChildren's runtime throw (iteration is ONLY <For>)
const fnChild = <div>{() => 1}</div>
// @ts-expect-error — checked is Reactive<boolean>: a number is the wrong primitive
const badChecked = <input checked={5} />
// @ts-expect-error — <For> REQUIRES each={view} (the runtime throws without it)
const noEach = <For>{() => <li>x</li>}</For>
// @ts-expect-error — <For>'s single child must be the row FUNCTION, not text
const badKids = <For each={todos}>static text</For>
// @ts-expect-error — RowOf inference has teeth: 'nope' is not a field of the row
const badRow = <For each={todos}>{(row) => <li>{row.nope}</li>}</For>
// @ts-expect-error — class is Reactive<string>: v3 has NO class object-maps
const badClass = <div class={{ done: true }} />
// @ts-expect-error — style is a plain attr STRING in v3: no style objects
const badStyle = <div style={{ color: 'red' }} />
// @ts-expect-error — a component's REQUIRED prop is missing (count)
const badBadge = <Badge label="open" />
// @ts-expect-error — <ErrorBoundary> REQUIRES fallback (the runtime throws eagerly without it)
const badEB = <ErrorBoundary><div /></ErrorBoundary>
void fnChild; void badChecked; void noEach; void badKids; void badRow; void badClass; void badStyle
void badBadge; void badEB
