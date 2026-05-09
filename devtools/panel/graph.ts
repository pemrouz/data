// @ts-nocheck
// Graph tab: root selector + collapsible tree, rebuilt from $.graph() snapshots.
// Re-walks on rAF when the selected root mutates (via $.trace) so the tree
// reflects current state without flooding the panel during bursts.
import { $ as $core, value, view, ViewProxy } from '../../core.ts'
import { iterRoots, walk } from '../walk.ts'
import { getPanelState } from './state.ts'

export type GraphTabHandle = {
  render(container: HTMLElement): void
  dispose(): void
}

const $ = $core as any   // public devtools API methods are bolted onto $ at runtime

export function createGraphTab(): GraphTabHandle {
  const state = getPanelState()
  let traceDispose: (() => void) | null = null
  let rafQueued = false
  let lastContainer: HTMLElement | null = null
  let lastSelectedKey: string | null = null

  function selectedRoot() {
    const showInternal = state[value].showInternal
    const all = [...iterRoots({ internal: showInternal })]
    if (!all.length) return null
    const idx = state[value].selectedRootIdx ?? 0
    return all[Math.min(idx, all.length - 1)] ?? all[0]
  }

  function scheduleRewalk() {
    if (rafQueued) return
    rafQueued = true
    const raf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (fn: any) => setTimeout(fn, 16)
    raf(() => {
      rafQueued = false
      if (lastContainer) render(lastContainer)
    })
  }

  function render(container: HTMLElement) {
    lastContainer = container
    container.innerHTML = ''
    const showInternal = state[value].showInternal
    const roots = [...iterRoots({ internal: showInternal })]

    // Toolbar: root selector + show-internal toggle.
    const toolbar = document.createElement('div')
    toolbar.className = 'gt-toolbar'
    container.appendChild(toolbar)

    const selectLabel = document.createElement('span')
    selectLabel.textContent = 'root: '
    selectLabel.className = 'gt-label'
    toolbar.appendChild(selectLabel)

    const select = document.createElement('select')
    select.className = 'gt-select'
    if (roots.length === 0) {
      const opt = document.createElement('option')
      opt.textContent = '(no live roots)'
      select.appendChild(opt)
      select.disabled = true
    } else {
      for (let i = 0; i < roots.length; i++) {
        const opt = document.createElement('option')
        opt.value = String(i)
        const v = roots[i].value
        opt.textContent = `#${i} ${summarizeForOption(v)}`
        select.appendChild(opt)
      }
      const idx = Math.min(state[value].selectedRootIdx ?? 0, roots.length - 1)
      select.value = String(idx)
    }
    select.addEventListener('change', () => {
      state.selectedRootIdx = Number(select.value)
      installTraceForRoot(roots[Number(select.value)])
      render(container)
    })
    toolbar.appendChild(select)

    const internalLabel = document.createElement('label')
    internalLabel.className = 'gt-checkbox'
    const internalBox = document.createElement('input')
    internalBox.type = 'checkbox'
    internalBox.checked = !!showInternal
    internalBox.addEventListener('change', () => {
      state.showInternal = !!internalBox.checked
      render(container)
    })
    internalLabel.appendChild(internalBox)
    internalLabel.appendChild(document.createTextNode(' show internal'))
    toolbar.appendChild(internalLabel)

    // Tree.
    const treeRoot = document.createElement('div')
    treeRoot.className = 'gt-tree'
    container.appendChild(treeRoot)

    const sel = roots.length ? roots[Math.min(state[value].selectedRootIdx ?? 0, roots.length - 1)] : null
    if (!sel) {
      const empty = document.createElement('div')
      empty.className = 'empty'
      empty.textContent = 'No live roots — call $({...}) somewhere on the page.'
      treeRoot.appendChild(empty)
      return
    }

    if (lastSelectedKey !== keyOf(sel)) {
      installTraceForRoot(sel)
      lastSelectedKey = keyOf(sel)
    }

    const tree = walk(sel)
    treeRoot.appendChild(renderNode(tree, []))
  }

  function installTraceForRoot(v: any) {
    if (traceDispose) { traceDispose(); traceDispose = null }
    if (!v) return
    const proxy = new ViewProxy(v)
    traceDispose = ($ as any).trace(proxy, {
      log: false,
      onEvent: scheduleRewalk,
    })
  }

  function dispose() {
    if (traceDispose) { traceDispose(); traceDispose = null }
    lastContainer = null
  }

  return { render, dispose }
}

function keyOf(v: any) { return (v.key || []).join('.') || '<root>' }

function summarizeForOption(v: unknown) {
  if (v === undefined) return 'undefined'
  if (v === null) return 'null'
  if (Array.isArray(v)) return `Array(${v.length})`
  if (typeof v === 'object') {
    const keys = Object.keys(v as object)
    return keys.length ? `{ ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', …' : ''} }` : '{}'
  }
  return String(v)
}

function renderNode(node: any, path: (string | number)[]): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'gt-node'
  const hasChildren = (node.children?.length || 0) + (node.sinks?.length || 0) > 0
  if (hasChildren) {
    const det = document.createElement('details')
    det.open = path.length < 2  // auto-expand top two levels
    const sum = document.createElement('summary')
    sum.appendChild(badge(node))
    sum.appendChild(label(node))
    det.appendChild(sum)
    const inner = document.createElement('div')
    inner.className = 'gt-children'
    for (const c of node.children || []) inner.appendChild(renderNode(c, [...path, c.name ?? '?']))
    for (const s of node.sinks || []) inner.appendChild(renderNode(s, [...path, s.kind]))
    det.appendChild(inner)
    wrap.appendChild(det)
  } else {
    wrap.appendChild(badge(node))
    wrap.appendChild(label(node))
  }
  return wrap
}

function badge(node: any): HTMLElement {
  const b = document.createElement('span')
  b.className = `gt-badge gt-${node.kind}`
  b.textContent = node.kind
  return b
}

function label(node: any): HTMLElement {
  const s = document.createElement('span')
  s.className = 'gt-rowlabel'
  const name = node.kind === 'operator' ? node.ctor : (node.name ?? '<root>')
  const valStr = node.value !== undefined ? ` = ${formatVal(node.value)}` : ''
  s.textContent = ` ${name}${valStr}`
  return s
}

function formatVal(v: any) {
  if (typeof v === 'string') return v
  return String(v)
}
