// @ts-nocheck
// DOM picker. Toggle the picker armed → on next click anywhere in the host
// page, intercept the click, walk the target up to the nearest __ripple_sink
// via $.fromDOM, and switch the panel's Graph tab to highlight that view.
//
// Mounting: createPicker() returns { arm(), disarm(), isArmed() }. The
// caller is responsible for surfacing arm() to the user (a toolbar button
// in the panel header). The picker installs document-level listeners only
// while armed and tears them down on disarm.
import { $ as $core, view, ViewProxy } from '../../core.ts'
import { iterRoots } from '../walk.ts'
import { getPanelState } from './state.ts'

const $ = $core as any

export type PickerHandle = {
  arm(): void
  disarm(): void
  isArmed(): boolean
}

const HOST_CLASS = '__ripple_panel_host'

export function createPicker(): PickerHandle {
  const state = getPanelState()
  let overlay: HTMLDivElement | null = null
  let armed = false

  function arm() {
    if (armed) return
    armed = true
    state.pickerArmed = true
    document.body.style.cursor = 'crosshair'
    overlay = document.createElement('div')
    overlay.style.cssText = [
      'position:fixed', 'pointer-events:none', 'z-index:2147483646',
      'border:2px dashed #9be3a8', 'background:rgba(155,227,168,0.08)',
      'transition:all 50ms ease-out',
    ].join(';')
    overlay.style.left = '-9999px'
    document.body.appendChild(overlay)
    document.addEventListener('mousemove', onMove, true)
    // Capture-phase click so we can prevent the page's handlers from running.
    document.addEventListener('click', onClick, true)
  }

  function disarm() {
    if (!armed) return
    armed = false
    state.pickerArmed = false
    document.body.style.cursor = ''
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay)
    overlay = null
    document.removeEventListener('mousemove', onMove, true)
    document.removeEventListener('click', onClick, true)
  }

  function onMove(e: MouseEvent) {
    if (!overlay) return
    const target = e.target as Element | null
    if (!target || isInsidePanel(target)) return
    const r = target.getBoundingClientRect()
    overlay.style.left = `${r.left}px`
    overlay.style.top = `${r.top}px`
    overlay.style.width = `${r.width}px`
    overlay.style.height = `${r.height}px`
  }

  function onClick(e: MouseEvent) {
    const target = e.target as Element | null
    if (!target) return disarm()
    if (isInsidePanel(target)) return     // click on the panel itself: ignore (don't arm again)
    e.preventDefault()
    e.stopPropagation()
    const proxy = ($ as any).fromDOM(target)
    disarm()
    if (proxy) {
      // Switch to the Graph tab and let the existing tab pick up the
      // selection on its next render. We don't try to scroll-into-view
      // a particular tree node here — the user can search by hand once
      // they're on the right tab.
      state.activeTab = 'graph'
      // Find this proxy's root view and select it in the picker dropdown.
      const targetView = proxy[view]
      let root = targetView
      while (root.p) root = root.p
      const rootsArr = [...iterRoots()]
      const idx = rootsArr.findIndex((v: any) => v === root)
      if (idx >= 0) state.selectedRootIdx = idx
    }
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
