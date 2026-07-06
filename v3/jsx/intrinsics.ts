// v3/jsx/intrinsics.ts — the per-tag JSX type surface (M4.5b types slice).
//
// Single source of truth for the v3 JSX types — the per-tag attribute
// interfaces and the IntrinsicElements map, shared by BOTH JSX entry points so
// they can never drift (the v2 lesson: the automatic runtime was an all-`any`
// bag until the surfaces were unified):
//   - the classic transform's GLOBAL namespace (v3/jsx/jsx.d.ts, jsxFactory
//     "h") re-declares `declare global { namespace JSX }` aliasing these, and
//   - the automatic runtime (the v3 jsx-runtime, when it lands) exports a
//     `namespace JSX` aliasing the same.
//
// PURE TYPE MODULE with ZERO imports — deliberately: the tsc fixture-gate
// programs include this file without pulling one line of implementation, and
// the automatic runtime can alias it without a value dependency. The runtime
// shapes are therefore stood in for STRUCTURALLY:
//   - ViewLike  — every v3 handle exposes snapshot() (whole handles, scalar
//     aggregates, child-path handles — see v3/types/surface.ts), and so does
//     a raw DataNode; `{ snapshot(): unknown }` matches them all without
//     naming any of them.
//   - BindLike  — structurally matches render/index.ts's BindProp
//     (`bind(view, fn)`; the renderer discriminates on `kind: 'bind'`).
//   - VNodeLike — any render AST record (el/text/rtext/list): a tagged
//     `kind`. NB BindLike is itself a VNodeLike structurally, which is
//     exactly right: a bind() CHILD is legal too (normChildren turns it into
//     formatted reactive text).
//
// Typed to what v3's renderer ACTUALLY accepts (render/index.ts prop
// dispatch), not to React's vocabulary. v3 HAS:
//   - on* FUNCTION props → addEventListener(name.slice(2).toLowerCase())
//   - handle / bind() prop values → per-binding surgical attr subscriptions
//   - static values through normAttr — null/undefined/false REMOVE the
//     attribute, true → '' (boolean-attr presence), everything else
//     stringifies
//   - 'checked' / 'value' write the DOM PROPERTY when the element carries it
//     (live form props; the attribute is only the pre-interaction default)
// and v3 does NOT have (deliberate — attributes are LITERAL):
//   - no className — the attribute is literally `class`
//   - no style OBJECTS — `style` is a plain attr string
//   - no class object-maps ({ done: cond })
//   - no htmlFor / tabIndex / defaultValue React aliases — `for`, `tabindex`
//     are the literal attribute names
//   - no ref props — a non-on* function prop value just stringifies

// ── structural stand-ins for the runtime shapes ──────────────────────────────

export type ViewLike = { snapshot(): unknown }
export type BindLike = { kind: 'bind' }
export type VNodeLike = { kind: string }

// Every attribute value widens with Reactive<T>: a static value, a live view
// (handle / scalar / child handle / DataNode), or a bind(view, fn) record.
export type Reactive<T> = T | ViewLike | BindLike

// The renderer forwards on{Anything} → addEventListener, so handlers are
// loosely typed; E defaults to any because this module can't name DOM types
// (zero imports, no lib assumption).
export type EventHandler<E = any> = (event: E) => void

// ── children ─────────────────────────────────────────────────────────────────
//
// The child vocabulary of normChildren (render/builders.ts): static
// string/number text; booleans/null/undefined dropped; VNode records (a
// bind() child passes through the VNodeLike arm — see the header note); a
// bare handle child is reactive TEXT; nested arrays flatten.
//
// FUNCTIONS ARE DELIBERATELY EXCLUDED: a function child under a string tag
// THROWS at runtime (normChildren's unsupported-child error — iteration is
// ONLY <For each={view}>{fn}</For>), so `<div>{() => x}</div>` is a COMPILE
// error here, mirroring the runtime throw. For's row fn is unaffected —
// component children are checked against the COMPONENT's own props type,
// not this vocabulary.
export type ChildLike =
  | string
  | number
  | boolean
  | null
  | undefined
  | VNodeLike
  | ViewLike
  | readonly ChildLike[]

// ── shared attribute surface ─────────────────────────────────────────────────

export interface DOMAttributes {
  // Accepted for JSX-idiom compatibility and IGNORED by any reconciler
  // (there is none to inform: row identity comes from the DATA layer's
  // RowKey, never from markup) — a static key just passes through the
  // renderer like any other attribute.
  key?: string | number

  // The literal global attributes the v3 renderer writes as-is.
  class?: Reactive<string>
  id?: Reactive<string>
  for?: Reactive<string>
  title?: Reactive<string>
  style?: Reactive<string> // a plain attr STRING — v3 has no style objects
  hidden?: Reactive<boolean> // normAttr: true → present-empty, false → removed
  tabindex?: Reactive<number | string>

  children?: ChildLike

  // Event handlers — enumerated only for AUTOCOMPLETE. The renderer forwards
  // any on* function prop to addEventListener(name lowercased), so the open
  // index signature below catches every event not listed here.
  onClick?: EventHandler
  onDblClick?: EventHandler
  onChange?: EventHandler
  onInput?: EventHandler
  onBlur?: EventHandler
  onFocus?: EventHandler
  onKeyDown?: EventHandler
  onKeyUp?: EventHandler
  onKeyPress?: EventHandler
  onMouseDown?: EventHandler
  onMouseUp?: EventHandler
  onMouseMove?: EventHandler
  onMouseEnter?: EventHandler
  onMouseLeave?: EventHandler
  onMouseOver?: EventHandler
  onMouseOut?: EventHandler
  onPointerDown?: EventHandler
  onPointerUp?: EventHandler
  onPointerMove?: EventHandler
  onPointerEnter?: EventHandler
  onPointerLeave?: EventHandler
  onPointerCancel?: EventHandler
  onPointerOver?: EventHandler
  onPointerOut?: EventHandler
  onSubmit?: EventHandler
  onScroll?: EventHandler
  onWheel?: EventHandler
  onContextMenu?: EventHandler
  onDrag?: EventHandler
  onDragEnd?: EventHandler
  onDragEnter?: EventHandler
  onDragLeave?: EventHandler
  onDragOver?: EventHandler
  onDragStart?: EventHandler
  onDrop?: EventHandler
  onTouchStart?: EventHandler
  onTouchMove?: EventHandler
  onTouchEnd?: EventHandler
  onTouchCancel?: EventHandler
  onLoad?: EventHandler
  onError?: EventHandler

  // Open catch-all: the renderer forwards ANY attribute (data-*, aria-*,
  // future/unknown attrs, uncommon events), so unknown names must still
  // type-check. Known names declared above stay strictly checked — declared
  // members take precedence over the index signature.
  [attr: string]: any
}

// aria-* would pass through the index signature anyway; declared here for
// autocomplete + value narrowing on the common ones (ported from v2).
export interface AriaAttributes {
  'aria-label'?: Reactive<string>
  'aria-labelledby'?: Reactive<string>
  'aria-describedby'?: Reactive<string>
  'aria-hidden'?: Reactive<boolean | 'true' | 'false'>
  'aria-live'?: Reactive<'off' | 'polite' | 'assertive'>
  'aria-checked'?: Reactive<boolean | 'true' | 'false' | 'mixed'>
  'aria-disabled'?: Reactive<boolean | 'true' | 'false'>
  'aria-expanded'?: Reactive<boolean | 'true' | 'false'>
  'aria-selected'?: Reactive<boolean | 'true' | 'false'>
  'aria-pressed'?: Reactive<boolean | 'true' | 'false' | 'mixed'>
  'aria-current'?: Reactive<boolean | 'page' | 'step' | 'location' | 'date' | 'time'>
  'aria-controls'?: Reactive<string>
  'aria-haspopup'?: Reactive<boolean | 'menu' | 'listbox' | 'tree' | 'grid' | 'dialog'>
  role?: Reactive<string>
}

// ── per-tag attribute interfaces (the v2 tag list, values adapted to v3) ─────

export interface HTMLAttributes extends DOMAttributes, AriaAttributes {
  accesskey?: Reactive<string>
  autofocus?: Reactive<boolean>
  contenteditable?: Reactive<boolean | 'true' | 'false' | 'inherit'>
  contextmenu?: Reactive<string>
  dir?: Reactive<'ltr' | 'rtl' | 'auto'>
  draggable?: Reactive<boolean | 'true' | 'false'>
  lang?: Reactive<string>
  slot?: Reactive<string>
  spellcheck?: Reactive<boolean | 'true' | 'false'>
  translate?: Reactive<'yes' | 'no'>
}

export interface AnchorHTMLAttributes extends HTMLAttributes {
  href?: Reactive<string>
  target?: Reactive<'_self' | '_blank' | '_parent' | '_top' | string>
  rel?: Reactive<string>
  download?: Reactive<string | boolean>
  hreflang?: Reactive<string>
  type?: Reactive<string>
  referrerpolicy?: Reactive<string>
}

export interface ButtonHTMLAttributes extends HTMLAttributes {
  type?: Reactive<'button' | 'submit' | 'reset'>
  disabled?: Reactive<boolean>
  form?: Reactive<string>
  formaction?: Reactive<string>
  formmethod?: Reactive<string>
  formnovalidate?: Reactive<boolean>
  formtarget?: Reactive<string>
  name?: Reactive<string>
  value?: Reactive<string | number>
}

export interface InputHTMLAttributes extends HTMLAttributes {
  type?: Reactive<
    | 'button' | 'checkbox' | 'color' | 'date' | 'datetime-local' | 'email'
    | 'file' | 'hidden' | 'image' | 'month' | 'number' | 'password' | 'radio'
    | 'range' | 'reset' | 'search' | 'submit' | 'tel' | 'text' | 'time'
    | 'url' | 'week'
  >
  accept?: Reactive<string>
  alt?: Reactive<string>
  autocomplete?: Reactive<string>
  capture?: Reactive<boolean | 'user' | 'environment'>
  // Live form prop: written to the PROPERTY when the element carries it, so
  // a reactive binding keeps working after user interaction.
  checked?: Reactive<boolean>
  disabled?: Reactive<boolean>
  form?: Reactive<string>
  list?: Reactive<string>
  max?: Reactive<number | string>
  maxlength?: Reactive<number>
  min?: Reactive<number | string>
  minlength?: Reactive<number>
  multiple?: Reactive<boolean>
  name?: Reactive<string>
  pattern?: Reactive<string>
  placeholder?: Reactive<string>
  readonly?: Reactive<boolean>
  required?: Reactive<boolean>
  size?: Reactive<number>
  src?: Reactive<string>
  step?: Reactive<number | string>
  // Live form prop, like checked.
  value?: Reactive<string | number>
}

export interface TextareaHTMLAttributes extends HTMLAttributes {
  autocomplete?: Reactive<string>
  cols?: Reactive<number>
  dirname?: Reactive<string>
  disabled?: Reactive<boolean>
  form?: Reactive<string>
  maxlength?: Reactive<number>
  minlength?: Reactive<number>
  name?: Reactive<string>
  placeholder?: Reactive<string>
  readonly?: Reactive<boolean>
  required?: Reactive<boolean>
  rows?: Reactive<number>
  value?: Reactive<string> // live form prop
  wrap?: Reactive<'soft' | 'hard'>
}

export interface SelectHTMLAttributes extends HTMLAttributes {
  autocomplete?: Reactive<string>
  disabled?: Reactive<boolean>
  form?: Reactive<string>
  multiple?: Reactive<boolean>
  name?: Reactive<string>
  required?: Reactive<boolean>
  size?: Reactive<number>
  value?: Reactive<string | number> // live form prop
}

export interface OptionHTMLAttributes extends HTMLAttributes {
  disabled?: Reactive<boolean>
  label?: Reactive<string>
  selected?: Reactive<boolean>
  value?: Reactive<string | number>
}

export interface FormHTMLAttributes extends HTMLAttributes {
  action?: Reactive<string>
  method?: Reactive<'get' | 'post' | 'dialog'>
  enctype?: Reactive<string>
  'accept-charset'?: Reactive<string> // literal attr (v2 had the camel alias)
  autocomplete?: Reactive<string>
  name?: Reactive<string>
  novalidate?: Reactive<boolean>
  target?: Reactive<string>
}

export interface ImgHTMLAttributes extends HTMLAttributes {
  alt?: Reactive<string>
  crossorigin?: Reactive<'anonymous' | 'use-credentials' | ''>
  decoding?: Reactive<'async' | 'auto' | 'sync'>
  height?: Reactive<number | string>
  loading?: Reactive<'eager' | 'lazy'>
  referrerpolicy?: Reactive<string>
  sizes?: Reactive<string>
  src?: Reactive<string>
  srcset?: Reactive<string>
  usemap?: Reactive<string>
  width?: Reactive<number | string>
}

export interface LabelHTMLAttributes extends HTMLAttributes {
  for?: Reactive<string> // the literal attribute — v3 has no htmlFor alias
  form?: Reactive<string>
}

export interface MetaHTMLAttributes extends HTMLAttributes {
  charset?: Reactive<string>
  content?: Reactive<string>
  'http-equiv'?: Reactive<string> // literal attr (v2 had the camel alias)
  name?: Reactive<string>
}

export interface ScriptHTMLAttributes extends HTMLAttributes {
  async?: Reactive<boolean>
  crossorigin?: Reactive<string>
  defer?: Reactive<boolean>
  integrity?: Reactive<string>
  nomodule?: Reactive<boolean>
  nonce?: Reactive<string>
  referrerpolicy?: Reactive<string>
  src?: Reactive<string>
  type?: Reactive<string>
}

export interface IframeHTMLAttributes extends HTMLAttributes {
  allow?: Reactive<string>
  allowfullscreen?: Reactive<boolean>
  height?: Reactive<number | string>
  loading?: Reactive<'eager' | 'lazy'>
  name?: Reactive<string>
  referrerpolicy?: Reactive<string>
  sandbox?: Reactive<string>
  src?: Reactive<string>
  srcdoc?: Reactive<string>
  width?: Reactive<number | string>
}

export interface VideoHTMLAttributes extends HTMLAttributes {
  autoplay?: Reactive<boolean>
  controls?: Reactive<boolean>
  crossorigin?: Reactive<string>
  height?: Reactive<number | string>
  loop?: Reactive<boolean>
  muted?: Reactive<boolean>
  playsinline?: Reactive<boolean>
  poster?: Reactive<string>
  preload?: Reactive<'none' | 'metadata' | 'auto'>
  src?: Reactive<string>
  width?: Reactive<number | string>
}

export interface AudioHTMLAttributes extends HTMLAttributes {
  autoplay?: Reactive<boolean>
  controls?: Reactive<boolean>
  crossorigin?: Reactive<string>
  loop?: Reactive<boolean>
  muted?: Reactive<boolean>
  preload?: Reactive<'none' | 'metadata' | 'auto'>
  src?: Reactive<string>
}

export interface CanvasHTMLAttributes extends HTMLAttributes {
  height?: Reactive<number | string>
  width?: Reactive<number | string>
}

export interface SVGAttributes extends DOMAttributes, AriaAttributes {
  // Subset of the SVG presentation/geometry attribute surface (the set the
  // crossfilter charts exercise); the index signature catches the rest. The
  // renderer namespaces via the <svg> TAG (children inherit createElementNS),
  // so these are ordinary el records — no per-attr namespace handling.
  x?: Reactive<number | string>
  y?: Reactive<number | string>
  x1?: Reactive<number | string>
  y1?: Reactive<number | string>
  x2?: Reactive<number | string>
  y2?: Reactive<number | string>
  cx?: Reactive<number | string>
  cy?: Reactive<number | string>
  r?: Reactive<number | string>
  rx?: Reactive<number | string>
  ry?: Reactive<number | string>
  width?: Reactive<number | string>
  height?: Reactive<number | string>
  d?: Reactive<string>
  points?: Reactive<string>
  fill?: Reactive<string>
  stroke?: Reactive<string>
  'stroke-width'?: Reactive<number | string>
  'stroke-linecap'?: Reactive<'butt' | 'round' | 'square'>
  'stroke-linejoin'?: Reactive<'miter' | 'round' | 'bevel'>
  'stroke-dasharray'?: Reactive<string>
  'stroke-dashoffset'?: Reactive<number | string>
  opacity?: Reactive<number | string>
  'fill-opacity'?: Reactive<number | string>
  'stroke-opacity'?: Reactive<number | string>
  transform?: Reactive<string>
  'clip-path'?: Reactive<string>
  'text-anchor'?: Reactive<'start' | 'middle' | 'end'>
  dy?: Reactive<number | string>
  dx?: Reactive<number | string>
  viewBox?: Reactive<string>
  preserveAspectRatio?: Reactive<string>
  xmlns?: Reactive<string>
  href?: Reactive<string>
  'xlink:href'?: Reactive<string>
  offset?: Reactive<number | string>
  'stop-color'?: Reactive<string>
  'stop-opacity'?: Reactive<string>
}

// ── the JSX namespace surface (aliased by both transforms) ───────────────────

// h() returns a VNode from a string tag and VNode | VNode[] from a component
// (Fragment returns its children array), so Element covers both.
export type Element = VNodeLike | VNodeLike[]
export interface ElementChildrenAttribute { children: {} }
export interface IntrinsicAttributes { key?: string | number }

export interface IntrinsicElements {
  // Document structure
  html: HTMLAttributes
  head: HTMLAttributes
  body: HTMLAttributes
  title: HTMLAttributes

  // Sections
  section: HTMLAttributes
  header: HTMLAttributes
  footer: HTMLAttributes
  main: HTMLAttributes
  nav: HTMLAttributes
  article: HTMLAttributes
  aside: HTMLAttributes
  h1: HTMLAttributes
  h2: HTMLAttributes
  h3: HTMLAttributes
  h4: HTMLAttributes
  h5: HTMLAttributes
  h6: HTMLAttributes
  hgroup: HTMLAttributes
  address: HTMLAttributes

  // Text content
  div: HTMLAttributes
  p: HTMLAttributes
  hr: HTMLAttributes
  pre: HTMLAttributes
  blockquote: HTMLAttributes
  ol: HTMLAttributes
  ul: HTMLAttributes
  li: HTMLAttributes
  dl: HTMLAttributes
  dt: HTMLAttributes
  dd: HTMLAttributes
  figure: HTMLAttributes
  figcaption: HTMLAttributes

  // Inline text
  a: AnchorHTMLAttributes
  em: HTMLAttributes
  strong: HTMLAttributes
  small: HTMLAttributes
  s: HTMLAttributes
  cite: HTMLAttributes
  q: HTMLAttributes
  dfn: HTMLAttributes
  abbr: HTMLAttributes
  time: HTMLAttributes
  code: HTMLAttributes
  var: HTMLAttributes
  samp: HTMLAttributes
  kbd: HTMLAttributes
  sub: HTMLAttributes
  sup: HTMLAttributes
  i: HTMLAttributes
  b: HTMLAttributes
  u: HTMLAttributes
  mark: HTMLAttributes
  ruby: HTMLAttributes
  rt: HTMLAttributes
  rp: HTMLAttributes
  bdi: HTMLAttributes
  bdo: HTMLAttributes
  span: HTMLAttributes
  br: HTMLAttributes
  wbr: HTMLAttributes

  // Embedded content
  img: ImgHTMLAttributes
  iframe: IframeHTMLAttributes
  embed: HTMLAttributes
  object: HTMLAttributes
  param: HTMLAttributes
  video: VideoHTMLAttributes
  audio: AudioHTMLAttributes
  source: HTMLAttributes
  track: HTMLAttributes
  map: HTMLAttributes
  area: HTMLAttributes
  picture: HTMLAttributes
  canvas: CanvasHTMLAttributes

  // Tabular data
  table: HTMLAttributes
  caption: HTMLAttributes
  colgroup: HTMLAttributes
  col: HTMLAttributes
  tbody: HTMLAttributes
  thead: HTMLAttributes
  tfoot: HTMLAttributes
  tr: HTMLAttributes
  td: HTMLAttributes
  th: HTMLAttributes

  // Forms
  form: FormHTMLAttributes
  label: LabelHTMLAttributes
  input: InputHTMLAttributes
  button: ButtonHTMLAttributes
  select: SelectHTMLAttributes
  datalist: HTMLAttributes
  optgroup: HTMLAttributes
  option: OptionHTMLAttributes
  textarea: TextareaHTMLAttributes
  output: HTMLAttributes
  progress: HTMLAttributes
  meter: HTMLAttributes
  fieldset: HTMLAttributes
  legend: HTMLAttributes

  // Interactive
  details: HTMLAttributes
  summary: HTMLAttributes
  dialog: HTMLAttributes
  menu: HTMLAttributes

  // Scripting / metadata
  script: ScriptHTMLAttributes
  noscript: HTMLAttributes
  template: HTMLAttributes
  slot: HTMLAttributes
  style: HTMLAttributes
  link: HTMLAttributes
  meta: MetaHTMLAttributes
  base: HTMLAttributes

  // SVG (namespaced by the renderer via the enclosing <svg> tag)
  svg: SVGAttributes
  g: SVGAttributes
  path: SVGAttributes
  rect: SVGAttributes
  circle: SVGAttributes
  ellipse: SVGAttributes
  line: SVGAttributes
  polyline: SVGAttributes
  polygon: SVGAttributes
  text: SVGAttributes
  tspan: SVGAttributes
  textPath: SVGAttributes
  defs: SVGAttributes
  clipPath: SVGAttributes
  mask: SVGAttributes
  pattern: SVGAttributes
  image: SVGAttributes
  use: SVGAttributes
  symbol: SVGAttributes
  marker: SVGAttributes
  linearGradient: SVGAttributes
  radialGradient: SVGAttributes
  stop: SVGAttributes
  foreignObject: SVGAttributes
  filter: SVGAttributes
  feGaussianBlur: SVGAttributes
  feOffset: SVGAttributes
  feMerge: SVGAttributes
  feMergeNode: SVGAttributes
  feColorMatrix: SVGAttributes
  feFlood: SVGAttributes
  feComposite: SVGAttributes
  desc: SVGAttributes

  // Forward-compat — unknown / custom-element tags still type-check.
  [tag: string]: any
}
