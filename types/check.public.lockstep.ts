// types/check.public.lockstep.ts — the LOCKSTEP gate for the shipped per-tag
// JSX surface. public.d.ts INLINES jsx/intrinsics.ts (it ships alone, so it
// may import nothing), and this fixture makes "hand-maintained in lockstep"
// executable: every attribute interface and the IntrinsicElements tag map
// must be MUTUALLY assignable under Required<> — Required<> strips the
// optionality that would otherwise let a dropped attribute slide, and the
// string index signatures (`[attr: string]: any`, `[tag: string]: any`) do
// NOT satisfy a required named member, so a tag or attribute that exists on
// one side only, or is typed differently, fails with a property-level
// message. The tag map goes one level deeper (ReqTags): each tag's attribute
// interface is compared Required<> too, otherwise all-optional interfaces are
// mutually assignable and a tag mapped to the WRONG interface (li:
// SVGAttributes) would slide through. Compiled by `npx tsc -p types/tsconfig.public.json`: 'data'
// resolves to ./public.d.ts via paths; '../jsx/intrinsics.js' is NodeNext's
// .js → .ts substitution for the internal ../jsx/intrinsics.ts — a pure type
// module with ZERO imports, so nothing of the implementation enters the
// consumer-view program. The two @ts-expect-error lines prove the check
// bites. Never executed.

import type * as I from '../jsx/intrinsics.js'
import type * as P from 'data'

// IntrinsicElements with every tag required AND every tag's attribute
// interface Required<> — pins the tag → interface mapping, not just the keys.
type ReqTags<T> = { [K in keyof T]-?: Required<T[K]> }

// One member per shared interface — a key missing from either bundle is a
// compile error here, so extending intrinsics.ts with a NEW interface means
// adding it to BOTH bundles (and to public.d.ts).
type Internal = {
  attr: I.Reactive<string> // public.d.ts renames this one: Reactive<T> (intrinsics) ≡ Attr<T> (shipped)
  handler: I.EventHandler<{ x: 1 }>
  child: I.ChildLike
  element: I.Element
  dom: Required<I.DOMAttributes>
  aria: Required<I.AriaAttributes>
  html: Required<I.HTMLAttributes>
  a: Required<I.AnchorHTMLAttributes>
  button: Required<I.ButtonHTMLAttributes>
  input: Required<I.InputHTMLAttributes>
  textarea: Required<I.TextareaHTMLAttributes>
  select: Required<I.SelectHTMLAttributes>
  option: Required<I.OptionHTMLAttributes>
  form: Required<I.FormHTMLAttributes>
  img: Required<I.ImgHTMLAttributes>
  label: Required<I.LabelHTMLAttributes>
  meta: Required<I.MetaHTMLAttributes>
  script: Required<I.ScriptHTMLAttributes>
  iframe: Required<I.IframeHTMLAttributes>
  video: Required<I.VideoHTMLAttributes>
  audio: Required<I.AudioHTMLAttributes>
  canvas: Required<I.CanvasHTMLAttributes>
  svg: Required<I.SVGAttributes>
  childrenAttr: Required<I.ElementChildrenAttribute>
  intrinsicAttrs: Required<I.IntrinsicAttributes>
  tags: ReqTags<I.IntrinsicElements>
}
type Shipped = {
  attr: P.Attr<string>
  handler: P.EventHandler<{ x: 1 }>
  child: P.ChildLike
  element: P.Element
  dom: Required<P.DOMAttributes>
  aria: Required<P.AriaAttributes>
  html: Required<P.HTMLAttributes>
  a: Required<P.AnchorHTMLAttributes>
  button: Required<P.ButtonHTMLAttributes>
  input: Required<P.InputHTMLAttributes>
  textarea: Required<P.TextareaHTMLAttributes>
  select: Required<P.SelectHTMLAttributes>
  option: Required<P.OptionHTMLAttributes>
  form: Required<P.FormHTMLAttributes>
  img: Required<P.ImgHTMLAttributes>
  label: Required<P.LabelHTMLAttributes>
  meta: Required<P.MetaHTMLAttributes>
  script: Required<P.ScriptHTMLAttributes>
  iframe: Required<P.IframeHTMLAttributes>
  video: Required<P.VideoHTMLAttributes>
  audio: Required<P.AudioHTMLAttributes>
  canvas: Required<P.CanvasHTMLAttributes>
  svg: Required<P.SVGAttributes>
  childrenAttr: Required<P.ElementChildrenAttribute>
  intrinsicAttrs: Required<P.IntrinsicAttributes>
  tags: ReqTags<P.IntrinsicElements>
}

declare const internal: Internal
declare const shipped: Shipped

// Both directions: intrinsics.ts → public.d.ts (nothing dropped or narrowed
// in the shipped copy) and public.d.ts → intrinsics.ts (nothing added or
// widened that the internal gates never saw).
const shippedCoversInternal: Shipped = internal
const internalCoversShipped: Internal = shipped
void shippedCoversInternal; void internalCoversShipped

// ── the check has teeth ──────────────────────────────────────────────────────
// A shipped copy that NARROWED one attribute (input.value to strings only) …
type NarrowedInput = Required<I.InputHTMLAttributes> & { value: string }
// @ts-expect-error — … fails the shipped → internal direction on that property
const narrowed: NarrowedInput = shipped.input
// … and a tag map that GAINED a tag the other side lacks fails despite the
// forward-compat `[tag: string]: any` index signature (it does not stand in
// for a required named member).
type ExtraTag = ReqTags<I.IntrinsicElements> & { 'ship-only': Required<I.HTMLAttributes> }
// @ts-expect-error — the index signature does not satisfy a required named tag
const extra: ExtraTag = shipped.tags
void narrowed; void extra
