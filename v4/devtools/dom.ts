// v3/devtools/dom.ts — the DOM ↔ data helpers over the render layer's
// devtools registry (render/index.ts: domLinks, row ELEMENT → { view, key },
// set once per row build; liveLists, the live ListBinding set — needed because
// WeakMap entries aren't enumerable). fromDOM is the console's $0 → data
// bridge: walk the parentNode chain to the nearest registered row root, so the
// row element or ANY descendant resolves. rowElements/highlight go the other
// way — view → every bound row element, across ALL live bindings over that
// view (a view rendered twice concatenates; a disposed mount drops out with
// its liveLists entry).
//
// Import boundary (build-critical): dist/v3/devtools.js externalizes every
// import that leaves v3/devtools/ to the main bundle, so the registry and
// DataNode are reached through the api entry — never kernel/render/compat
// paths directly.

import { resolveNode } from './index.ts'
import { domLinks, liveLists, type DataNode } from '../api/index.ts'

// Structural twin of contract/delta.ts's RowKey — kept local because the api
// entry doesn't re-export the type and the import boundary bars a direct
// contract import.
type RowKey = number | string

// The highlight face (the panel's amber, not v2's green #9be3a8 — the v3
// palette). Offset keeps the outline clear of the row's own border.
const OUTLINE = '2px solid #e3b341'
const OUTLINE_OFFSET = '2px'

export function fromDOM(dom: any): { node: DataNode<any>; key?: RowKey } | null {
  // WeakMap.get returns undefined (no throw) for non-object keys, so text
  // nodes and null links in the chain need no guard beyond the loop condition.
  for (let n = dom; n != null; n = n.parentNode) {
    const link = domLinks.get(n)
    if (link !== undefined) return { node: link.view, key: link.key }
  }
  return null
}

export function rowElements(target: unknown): { key: RowKey; el: any }[] {
  const view = resolveNode(target) // handle or raw node — same surface as inspect()
  const out: { key: RowKey; el: any }[] = []
  for (const l of liveLists) {
    if (l.view !== view) continue
    for (const [key, rec] of l.recs) out.push({ key, el: rec.el })
  }
  return out
}

// Outlines every row element bound to the target view; returns a restore fn
// that puts the SAVED inline values back. Restore runs at most once (a stale
// restore fn must not clobber a later highlight's outline — the v2 panel's
// overlapping-highlight lesson: per-call snapshots restore to the mid state,
// so the caller sequences restore-before-rehighlight and stale fns no-op).
// Rows without an inline style object (text-node rows) are skipped.
export function highlight(target: unknown): () => void {
  const saved: { style: any; outline: string; outlineOffset: string }[] = []
  for (const { el } of rowElements(target)) {
    const style = el?.style
    if (style == null) continue
    saved.push({ style, outline: style.outline ?? '', outlineOffset: style.outlineOffset ?? '' })
    style.outline = OUTLINE
    style.outlineOffset = OUTLINE_OFFSET
  }
  let restored = false
  return () => {
    if (restored) return
    restored = true
    for (const s of saved) {
      s.style.outline = s.outline
      s.style.outlineOffset = s.outlineOffset
    }
  }
}
