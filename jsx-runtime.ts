// Automatic JSX runtime entry. A consumer enabling
// `"jsxImportSource": "data"` in tsconfig.json gets `import { jsx, jsxs,
// Fragment } from "data/jsx-runtime"` injected at every .tsx file with no
// manual import — same NodeProxy AST and DOMSink behavior as the classic
// `h` transform, see jsx/index.ts. The Fragment/jsx/jsxs symbols are the
// same instances re-exported from jsx/index.ts (and from data/full), so
// classic and automatic runtimes interoperate without symbol-identity
// surprises.
export { jsx, jsxs, Fragment } from './jsx/index.ts'

// The automatic runtime resolves `JSX.IntrinsicElements` from the EXPORTED `JSX`
// namespace of this module (TS 5.1+). Without it, every JSX element under
// `jsxImportSource: "data"` errored TS7026 ("no interface
// JSX.IntrinsicElements exists"), making the published entry unusable. The
// per-tag precision of the classic-transform jsx/jsx.d.ts isn't repeated here;
// instead every tag shares one open prop bag (className/class/style/on*/
// children/key + reactive values + an index signature for data-*/aria-*/custom
// attrs and tags). Reactive bindings (a ViewProxy, a callable Proxy) type-check
// via `Reactive<T>`.
export namespace JSX {
  type AnyVP = ((...a: any[]) => any) & { [k: string | symbol]: any }
  type Reactive<T> = T | AnyVP
  export type Element = any
  export interface ElementChildrenAttribute { children: {} }
  export interface IntrinsicAttributes { key?: string | number }
  export interface DOMProps {
    ref?: (el: any) => void
    key?: string | number
    children?: any
    className?: Reactive<string>
    class?: Reactive<string> | { [name: string]: Reactive<boolean> }
    style?: { [prop: string]: Reactive<string | number> }
    id?: Reactive<string>
    [attr: string]: any   // on*Event handlers, data-*/aria-*, any HTML/SVG attr
  }
  export interface IntrinsicElements {
    [tag: string]: DOMProps
  }
}
