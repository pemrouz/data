/**
 * Mount a template (built with {@link HTML}/{@link SVG}) into a parent DOM
 * element, wiring any reactive `ViewProxy` data so the DOM updates surgically
 * — only the nodes whose bound value changed are touched, no virtual-DOM diff.
 *
 * @param p  parent DOM element to render into
 * @param np a NodeProxy template, e.g. `HTML.ul(items, item => HTML.li(item.name))`
 * @returns the parent element `p`
 * @example
 * import { $, render, HTML } from 'data'
 * const items = $([{ name: 'a' }, { name: 'b' }])
 * render(document.body, HTML.ul(items, i => HTML.li(i.name)))
 */
declare const render: (p: any, np: any) => any;
/**
 * Builder for HTML element templates. Any property is an element tag:
 * `HTML.div(...)`, `HTML.li(...)`, `HTML.button(...)`. Pass props/children as
 * arguments and a `(data, rowFn)` pair to bind reactive collections. Compose
 * with {@link render} to mount. `HTML.div.foo.bar(...)` adds classes.
 * @example HTML.ul(items, item => HTML.li(item.name))
 */
declare const HTML: {};
/**
 * Builder for SVG element templates — the {@link HTML} counterpart that creates
 * nodes in the SVG namespace: `SVG.svg(...)`, `SVG.path(...)`, `SVG.rect(...)`.
 */
declare const SVG: {};

export { HTML, SVG, render };
