/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
// types/check.public.classic.tsx — the SHIPPED CLASSIC-transform JSX fixture:
// `import { h, Fragment } from 'data'` with jsxFactory "h" — the README's
// "the classic h/Fragment/For/ErrorBoundary come off the main entry" path.
// Lives in the same program as check.public.tsx (jsx "react-jsx"): the three
// pragmas above switch THIS file to the classic runtime + factory, which is
// exactly what a consumer's `"jsx": "react", "jsxFactory": "h"` tsconfig does
// program-wide (proven equivalent in the 4.0.0 pre-publish audit's consumer).
// tsc resolves the per-tag surface through the factory's own namespace —
// public.d.ts's merged `h.JSX`, which aliases the SAME four members
// jsx-runtime.d.ts's JSX namespace aliases — so the cases below are
// check.public.tsx's, re-run under the classic factory: identical narrowing
// or the two transforms drifted. Positives must compile; every
// `@ts-expect-error` line must BITE (a quiet directive fails as TS2578).
// Never executed.

import { h, Fragment, $, For, bind, text, onCleanup, ErrorBoundary } from 'data'
import type { Element, IntrinsicElements } from 'data'

const todos = $({
  t1: { title: 'ship the gate', done: false, priority: 2 },
  t2: { title: 'write the fixtures', done: true, priority: 1 },
})

// ── per-tag narrowing under the CLASSIC factory ──────────────────────────────
const form = (
  <div class="wrap" id="root">
    <input type="text" placeholder="search" />
    <input type="checkbox" checked={bind(todos.t1.done)} />
    <input type="checkbox" checked={todos.t1.done} />
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

// ── class static + reactive; text siblings; the JSX key ──────────────────────
const cls = <div class="static" />
const rcls = <div class={todos.t1.title} />
const counter = <span>total: {todos.length()} rows</span>
const keyed = <ul>{[<li key="a">a</li>, <li key="b">b</li>]}</ul>
void cls; void rcls; void counter; void keyed

// ── <For>: the row type flows from each={view} with NO annotation ────────────
const board = (
  <ul>
    <For each={todos}>
      {(row, key) => <li id={String(key)} title={row.title.toUpperCase()}>{row.title}</li>}
    </For>
  </ul>
)
const ranked = (
  <ol>
    <For each={todos.az('priority')}>{(row) => <li>{row.priority}</li>}</For>
  </ol>
)
void board; void ranked

// ── text()/bind() infer from the bound view ──────────────────────────────────
const fmt = (
  <div title={bind(todos.t1.priority, (n) => n.toFixed(1))}>
    {text(todos.t1.title, (s) => s.toUpperCase())}
  </div>
)
void fmt

// ── Fragment via the @jsxFrag pragma + SVG attrs ─────────────────────────────
const frag = (
  <>
    <span>a</span>
    {todos.t1.title}
  </>
)
const chart = (
  <svg viewBox="0 0 100 40">
    <path d={bind(todos.t1.title)} stroke-width={2} fill="none" />
    <circle cx={5} cy={5} r={4} />
  </svg>
)
void frag; void chart

// ── components + ErrorBoundary narrow identically under the classic factory ──
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

// ── the classic namespace is NAMEABLE and IS the main entry's surface ────────
const asElement: Element = <div /> // expect: a classic JSX expression is public.d.ts's Element
const viaNs: h.JSX.Element = asElement // expect: h.JSX.Element aliases that Element
type DivProps = h.JSX.IntrinsicElements['div']
const divProps: DivProps = { class: 'x', onClick: () => {} }
const sameTags: IntrinsicElements = divProps as unknown as h.JSX.IntrinsicElements // expect: one surface, two names
void viaNs; void divProps; void sameTags; void Fragment

// ── negatives: each marked line MUST error (check.public.tsx's, classic) ─────
// @ts-expect-error — a function child under a STRING tag mirrors normChildren's runtime throw
const fnChild = <div>{() => 1}</div>
// @ts-expect-error — checked is Attr<boolean>: a number is the wrong primitive
const badChecked = <input checked={5} />
// @ts-expect-error — <For> REQUIRES each={view}
const noEach = <For>{() => <li>x</li>}</For>
// @ts-expect-error — <For>'s single child must be the row FUNCTION, not text
const badKids = <For each={todos}>static text</For>
// @ts-expect-error — RowOf inference has teeth: 'nope' is not a field of the row
const badRow = <For each={todos}>{(row) => <li>{row.nope}</li>}</For>
// @ts-expect-error — class is Attr<string>: there are NO class object-maps
const badClass = <div class={{ done: true }} />
// @ts-expect-error — style is a plain attr STRING: no style objects
const badStyle = <div style={{ color: 'red' }} />
// @ts-expect-error — a component's REQUIRED prop is missing (count)
const badBadge = <Badge label="open" />
// @ts-expect-error — <ErrorBoundary> REQUIRES fallback
const badEB = <ErrorBoundary><div /></ErrorBoundary>
// @ts-expect-error — a mistyped VALUE on a known attribute: href is Attr<string>
const badHref = <a href={5} />
void fnChild; void badChecked; void noEach; void badKids; void badRow; void badClass; void badStyle
void badBadge; void badEB; void badHref
