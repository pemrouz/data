// @ts-nocheck
// Hover inspector. A sibling of picker.ts: arms a mousemove listener that
// follows the cursor and renders a sidecar with the bound view's chain
// (key path, value snapshot, parent ctor) for whatever element the cursor
// is over. Clicking pins the sidecar in place — useful for poking at the
// values without losing focus. Esc unpins / disarms.
//
// Picker takes you to the Graph tab. Hover keeps the info inline so you
// don't have to context-switch — closer to React DevTools' Components
// inspector. The two are mutually exclusive: arming hover disarms picker
// and vice versa (arbitrated by panel/index.ts).
//
// The sidecar mounts inside the panel's closed shadow root so the panel
// CSS (font, colours) carries over and host-page CSS can't bleed in.
import { $ as $core, view, value as valueSym, ViewProxy } from '../../core.ts'
import { walk, summarize } from '../walk.ts'
import { getPanelState } from './state.ts'

const $ = $core as any

export type HoverHandle = {
  arm(): void
  disarm(): void
  isArmed(): boolean
}

const HOST_CLASS = '__ripple_panel_host'

export function createHover(shadowRoot: ShadowRoot): HoverHandle {
  const state = getPanelState()
  let armed = false
  let pinned = false
  let sidecar: HTMLDivElement | null = null
  let outline: HTMLDivElement | null = null
  let lastTarget: Element | null = null

  function arm() {
    if (armed) return
    armed = true
    pinned = false
    state.hoverArmed = true
    sidecar = document.createElement('div')
    sidecar.className = 'ho-sidecar'
    sidecar.setAttribute('part', 'ho-sidecar')
    shadowRoot.appendChild(sidecar)
    outline = document.createElement('div')
    outline.style.cssText = [
      'position:fixed', 'pointer-events:none', 'z-index:2147483646',
      'border:1.5px solid #9bb3e3', 'background:rgba(155,179,227,0.08)',
      'border-radius:2px', 'transition:all 60ms ease-out',
      'left:-9999px', 'top:0',
    ].join(';')
    document.body.appendChild(outline)
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('keydown', onKey, true)
    // Click-to-pin needs a small defer so the toolbar click that armed us
    // doesn't immediately pin against an empty target. Same dance as picker.
    setTimeout(() => {
      if (armed) document.addEventListener('click', onClick, true)
    }, 0)
  }

  function disarm() {
    if (!armed) return
    armed = false
    pinned = false
    state.hoverArmed = false
    if (sidecar?.parentNode) sidecar.parentNode.removeChild(sidecar)
    sidecar = null
    if (outline?.parentNode) outline.parentNode.removeChild(outline)
    outline = null
    lastTarget = null
    document.removeEventListener('mousemove', onMove, true)
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('click', onClick, true)
  }

  function onMove(e: MouseEvent) {
    if (pinned) return
    const target = e.target as Element | null
    if (!target || isInsidePanel(target)) return
    if (target === lastTarget) {
      // Same element — just slide the sidecar with the cursor.
      positionSidecar(e.clientX, e.clientY)
      return
    }
    lastTarget = target
    updateOutline(target)
    renderSidecar(target)
    positionSidecar(e.clientX, e.clientY)
  }

  function onClick(e: MouseEvent) {
    const target = e.target as Element | null
    if (!target || isInsidePanel(target)) return
    e.preventDefault()
    e.stopPropagation()
    pinned = !pinned
    if (sidecar) sidecar.classList?.toggle?.('pinned', pinned)
    // On pin: re-render with full content (already rendered, just freeze).
    // On unpin: continue tracking the next mousemove.
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      disarm()
    }
  }

  function updateOutline(target: Element) {
    if (!outline) return
    const r = target.getBoundingClientRect()
    outline.style.left = `${r.left}px`
    outline.style.top = `${r.top}px`
    outline.style.width = `${r.width}px`
    outline.style.height = `${r.height}px`
  }

  function positionSidecar(cx: number, cy: number) {
    if (!sidecar) return
    // Offset slightly from the cursor; flip to the other side near edges.
    const w = 280, h = 140  // approximate; sidecar grows naturally
    const vw = (window as any).innerWidth ?? 1024
    const vh = (window as any).innerHeight ?? 768
    let x = cx + 14
    let y = cy + 14
    if (x + w > vw) x = cx - w - 14
    if (y + h > vh) y = cy - h - 14
    sidecar.style.left = `${Math.max(4, x)}px`
    sidecar.style.top = `${Math.max(4, y)}px`
  }

  function renderSidecar(target: Element) {
    if (!sidecar) return
    sidecar.innerHTML = ''

    // Walk up to the nearest __ripple_sink, then resolve the bound view.
    let n: Element | null = target
    let sinkEl: Element | null = null
    while (n) {
      if ((n as any).__ripple_sink) { sinkEl = n; break }
      n = n.parentElement
    }
    const proxy = $.fromDOM(target)
    const v = proxy?.[view] ?? null

    // Header: tag + selector hint, e.g. `<li.todo>`.
    const head = document.createElement('div')
    head.className = 'ho-head'
    const tag = (target.tagName || '').toLowerCase()
    const cls = (target as any).className && typeof (target as any).className === 'string'
      ? '.' + (target as any).className.split(/\s+/).filter(Boolean)[0]
      : ''
    head.textContent = `<${tag}${cls}>`
    sidecar.appendChild(head)

    if (!v) {
      const empty = document.createElement('div')
      empty.className = 'ho-empty'
      empty.textContent = 'no bound view (element is outside any render(...) tree)'
      sidecar.appendChild(empty)
      return
    }

    // Chain row — walk .p chain to root and render dot-joined keys.
    const chain: string[] = []
    let cursor: any = v
    while (cursor) {
      chain.unshift(cursor.name ?? '<root>')
      cursor = cursor.p
    }
    const chainEl = document.createElement('div')
    chainEl.className = 'ho-chain'
    chainEl.textContent = chain.join(' › ')
    sidecar.appendChild(chainEl)

    // Source ctor: the operator (or root Value) that owns this view.
    const ctor = v.res?.constructor?.name ?? 'View'
    const ctorEl = document.createElement('div')
    ctorEl.className = 'ho-ctor'
    ctorEl.textContent = `kind: ${ctor}`
    sidecar.appendChild(ctorEl)

    // Value preview.
    const valueEl = document.createElement('div')
    valueEl.className = 'ho-value'
    valueEl.textContent = `value: ${formatValue(v.value)}`
    sidecar.appendChild(valueEl)

    // Sink count — gives a quick read on how many things depend on this view.
    let sinkCount = 0
    v.sink?.(() => sinkCount++)
    const sinksEl = document.createElement('div')
    sinksEl.className = 'ho-sinks'
    sinksEl.textContent = `sinks: ${sinkCount}`
    sidecar.appendChild(sinksEl)

    // Hint footer.
    const hint = document.createElement('div')
    hint.className = 'ho-hint'
    hint.textContent = pinned ? 'pinned · click again to unpin · esc to close'
                              : 'click to pin · esc to close'
    sidecar.appendChild(hint)
  }

  function formatValue(v: unknown): string {
    if (v === undefined) return 'undefined'
    if (v === null) return 'null'
    if (typeof v === 'string') return JSON.stringify(v.length > 60 ? v.slice(0, 60) + '…' : v)
    if (typeof v === 'number' || typeof v === 'boolean') return String(v)
    if (Array.isArray(v)) return `Array(${v.length})`
    if (typeof v === 'object') {
      const keys = Object.keys(v as object)
      const preview = keys.slice(0, 3).map(k => `${k}: ${formatValue((v as any)[k])}`).join(', ')
      const more = keys.length > 3 ? `, +${keys.length - 3}` : ''
      return `{ ${preview}${more} }`
    }
    return String(summarize(v))
  }

  function isInsidePanel(el: Element | null): boolean {
    let n: Element | null = el
    while (n) {
      const cls = (n as HTMLElement).className
      if (typeof cls === 'string' && cls.includes(HOST_CLASS)) return true
      n = (n.parentNode as Element) ?? null
    }
    return false
  }

  function isArmed() { return armed }

  return { arm, disarm, isArmed }
}
