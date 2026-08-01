// v3/types/check.tsx — CLASSIC-transform JSX fixtures (jsxFactory "h",
// jsxFragmentFactory "Fragment"). Compiled by `npx tsc -p
// v3/types/tsconfig.jsx.json` (noCheck:false) against the GLOBAL JSX
// namespace (../jsx/jsx.d.ts → the shared ../jsx/intrinsics.ts) plus the
// declaration facades in ./jsx-surface.ts — so per-tag narrowing, the
// normChildren child vocabulary, and For/bind/text inference are all
// validated. Positives must compile; every @ts-expect-error line must NOT
// (a directive that goes quiet fails as TS2578 "Unused '@ts-expect-error'").
// Never executed — compile-only, the v2 types/check.tsx idiom carried to v3.

import { h, Fragment, For, bind, text, onCleanup, component, boundary, ErrorBoundary } from './jsx-surface.ts'
import { typedDollar as $ } from './surface.ts'
void h; void Fragment // resolved by the emitted classic transform, not called directly

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

// ── static + reactive text SIBLINGS in one element ───────────────────────────
// (ordered children in v3 — no v2 single-static-slot builder limitation)
const counter = <span>total: {todos.length()} rows</span>
void counter

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

// ── Fragment shorthand + SVG presentation attrs ──────────────────────────────
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

// ── the facades are directly callable too (the classic h signature) ──────────
const direct = h('div', { class: 'x' }, 'static', text(todos.t1.title))
void direct

// ── components: props type-check through the function tag; deferral is a
// runtime property, the TYPE surface is unchanged h<P> inference ─────────────
function Badge(props: { label: string; count: number; children?: unknown }) {
  return <span class="badge">{props.label}</span>
}
const badge = <Badge label="open" count={3} />
void badge

// ── onCleanup: the component-lifecycle hook types as () => void ──────────────
function Timer() {
  onCleanup(() => {})
  return <div class="timer" />
}
const timer = <Timer />
void timer

// ── ErrorBoundary: fallback REQUIRED, err/reset flow into the fallback ────────
const guarded = (
  <ErrorBoundary fallback={(err, reset) => <button onClick={() => reset()}>{String(err)}</button>}>
    <Badge label="x" count={1} />
  </ErrorBoundary>
)
void guarded

// ── the builder-DSL twins: component() / boundary() ──────────────────────────
const comp = component((p: { n: number }) => <i>{String(p.n)}</i>, { n: 1 })
const bnd = boundary(<div />, (err, reset) => {
  void err
  return <button onClick={() => reset()}>retry</button>
})
void comp; void bnd

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
// @ts-expect-error — onCleanup takes a FUNCTION
const badCleanup = onCleanup(123)
// @ts-expect-error — boundary's fallback is a FUNCTION (the runtime throws otherwise)
const badBoundary = boundary(<div />, 'oops')
void fnChild; void badChecked; void noEach; void badKids; void badRow; void badClass; void badStyle
void badBadge; void badEB; void badCleanup; void badBoundary
