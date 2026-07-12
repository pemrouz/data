import { D as Data, c as RowOf } from '../../core-B6UvChJ_.js';

declare const NODE: unique symbol;
/**
 * Mount a template (built with {@link HTML}/{@link SVG}) into a parent DOM
 * element, wiring any reactive `ViewProxy` data so the DOM updates surgically
 * — only the nodes whose bound value changed are touched, no virtual-DOM diff.
 *
 * The template's ROOT node is a wrapper: its CHILDREN are created into `p`
 * (the root tag itself is not created — `p` is the container). A data-bound
 * child — `HTML.li(items, (li, item) => …)` — becomes one row per item, so a
 * list is `render(container, HTML.ul(HTML.li(items, rowFn)))`: the `ul` wrapper
 * is decorative and the `li` rows are created inside `container`. Putting the
 * data on the wrapper itself (`HTML.ul(items, fn)`) renders nothing — a
 * wrapper's own data/fn are ignored; only its children are scanned.
 *
 * @param p  parent DOM element to render into (the row container)
 * @param np a NodeProxy template whose data-bound children become rows
 * @returns the parent element `p`
 * @example
 * import { $, render, HTML } from 'data'
 * const items = $([{ name: 'a' }, { name: 'b' }])
 * // each item becomes an <li> inside document.body:
 * render(document.body, HTML.ul(HTML.li(items, (li, item) => li.text(item.name))))
 */
declare const render: (p: any, np: any) => any;
/**
 * Builder for HTML element templates. Any property is an element tag:
 * `HTML.div(...)`, `HTML.li(...)`, `HTML.button(...)`. Pass props/children as
 * arguments and a `(data, rowFn)` pair to bind reactive collections. Compose
 * with {@link render} to mount. `HTML.div.foo.bar(...)` adds classes.
 * @example HTML.ul(items, item => HTML.li(item.name))
 */
interface NodeBuilder {
    <T>(data: Data<T>, rowFn: (node: NodeBuilder, item: RowOf<T>, key: string) => any): NodeBuilder;
    (...children: any[]): NodeBuilder;
    [prop: string]: NodeBuilder;
}
type Builder = {
    [tag: string]: NodeBuilder;
};
declare const HTML: Builder;
/**
 * Builder for SVG element templates — the {@link HTML} counterpart that creates
 * nodes in the SVG namespace: `SVG.svg(...)`, `SVG.path(...)`, `SVG.rect(...)`.
 */
declare const SVG: Builder;

export { type Builder, HTML, NODE, type NodeBuilder, SVG, render };
