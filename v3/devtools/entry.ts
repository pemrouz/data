// v3/devtools/entry.ts — the data/v3/devtools BUNDLE entry (tsup emits this
// as dist/v3/devtools.js; every import leaving v3/devtools/ is rewritten to
// the sibling main bundle, so $ / runtime here ARE the consumer's instances —
// the single-module-instance discipline).
//
// Importing this entry does three things (the v2 data/devtools discipline):
//   1. re-exports the consumption layer (inspect/graph/trace/profile/
//      cascades/resolveNode) + the DOM bridge (fromDOM/rowElements/highlight)
//      + mountPanel for explicit control;
//   2. attaches the helpers onto the canonical $ so they're one console
//      keystroke away ($.inspect(h), $.graph(), $.fromDOM($0), …);
//   3. in a browser, auto-mounts the overlay panel — suppressed by ?nopanel
//      (console API without the visible UI); $.devtools.panel.{open,close,
//      shell} keeps explicit/lazy control either way. Outside a browser the
//      helpers attach and the panel is skipped entirely.

import { $ } from '../api/index.ts'
import { inspect, graph, trace, profile, cascades } from './index.ts'
import { fromDOM, highlight } from './dom.ts'
import { mountPanel } from './panel/index.ts'

export * from './index.ts'
export { fromDOM, rowElements, highlight } from './dom.ts'
export { mountPanel } from './panel/index.ts'

const dollar = $ as any
dollar.inspect = inspect
dollar.graph = graph
dollar.trace = trace
dollar.profile = profile
dollar.cascades = cascades
dollar.fromDOM = fromDOM
dollar.highlight = highlight

// Lazy panel facade: nothing is built until the first open() — so ?nopanel
// (and pages that only want the console helpers) pay zero UI cost, while
// $.devtools.panel.open(handle?) can still summon the dock later.
let inst: ReturnType<typeof mountPanel> | null = null
function ensure(): ReturnType<typeof mountPanel> {
  if (inst === null) inst = mountPanel({ open: false })
  return inst
}

if (typeof document !== 'undefined') {
  dollar.devtools = {
    panel: {
      open(target?: unknown): void {
        ensure().open(target)
      },
      close(): void {
        if (inst !== null) inst.close()
      },
      get shell(): any {
        return inst !== null ? inst.shell : null
      },
    },
  }
  const noPanel = typeof location !== 'undefined' && /(?:^|[?&])nopanel(?:[=&]|$)/.test(location.search)
  if (!noPanel) {
    // ESM in browsers runs after parse, but guard body anyway (a consumer
    // could import from an inline module in <head>).
    const boot = (): void => {
      if ((document as any).body != null) ensure().open()
      else setTimeout(boot, 10)
    }
    boot()
  }
}
