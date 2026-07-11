// v3/devtools/panel/picker.ts — the DOM picker (◎) + Alt-hover badge.
//
// Two page-level affordances, both INERT at rest (the v2 leak lesson): the
// only standing listeners are the toolbar button's click and ONE keydown gate
// on ctx.doc watching for Alt. Everything else — the picker's capture-phase
// mousemove/click/Escape, the badge's mousemove/keyup/blur — attaches on
// activation and is torn down on EVERY exit path (pick, Escape, Alt-release,
// window blur, destroy) through a single remover list per feature, so no path
// can forget a listener.
//
// Deviation from v2: Alt shows ONE badge following the pointer, not a badge
// per bound element — v2's renderBadges() walked document.querySelectorAll('*')
// and stamped every reactive row on each Alt press (O(page); thousands of
// badges over the swarm example was the perf trap). Here resolution is
// per-hover via fromDOM's walk-up, O(1) per mousemove regardless of page size.
//
// The picker outlines the RESOLVED ROW element (rowElements(node) matched by
// the resolved key), not the hovered leaf, saving/restoring that element's
// prior inline outline. Style writes route through a guard because mock-dom
// Els carry no .style — the logic stays testable without a real DOM.

import type { PanelCtx } from './ctx.ts'
import { fromDOM, rowElements } from '../dom.ts'

// The panel's amber (dom.ts's highlight face) — the v3 palette, not v2's green.
const OUTLINE = '2px solid #e3b341'

// Inline-style write guard: no-op when the element has no style object
// (mock-dom), so behaviour — not presentation — is what the mock exercises.
function setStyle(el: any, css: Record<string, unknown>): void {
  const st = el == null ? null : el.style
  if (st == null) return
  for (const k in css) st[k] = css[k]
}

const isAlt = (e: any): boolean => e.key === 'Alt' || e.code === 'AltLeft' || e.code === 'AltRight'

export function mountPicker(ctx: PanelCtx, toolbar: any): { destroy(): void } {
  const doc = ctx.doc

  // Every transient listener registers through listen(); an exit path drains
  // the feature's remover bag, so add/remove can never go asymmetric.
  function listen(target: any, type: string, fn: (e: any) => void, capture: boolean, bag: (() => void)[]): void {
    target.addEventListener(type, fn, capture)
    bag.push(() => target.removeEventListener(type, fn, capture))
  }
  function drain(bag: (() => void)[]): void {
    while (bag.length > 0) (bag.pop() as () => void)()
  }

  // ── single-element outline with prior-inline-style restore ────────────────
  let outlined: { el: any; outline: unknown; offset: unknown } | null = null
  function outline(el: any): void {
    if (outlined !== null && outlined.el === el) return
    restore()
    const st = el == null ? null : el.style
    outlined = { el, outline: st == null ? undefined : st.outline, offset: st == null ? undefined : st.outlineOffset }
    setStyle(el, { outline: OUTLINE, outlineOffset: '1px' })
  }
  function restore(): void {
    if (outlined === null) return
    setStyle(outlined.el, { outline: outlined.outline ?? '', outlineOffset: outlined.offset ?? '' })
    outlined = null
  }

  // fromDOM's walk-up yields {node, key}; the row's OWN element comes from the
  // render registry matched by that key. A view-level resolution (no key)
  // falls back to the hovered element itself.
  function rowElOf(hovered: any, res: { node: any; key?: unknown }): any {
    if (res.key === undefined) return hovered
    for (const r of rowElements(res.node)) if (r.key === res.key) return r.el
    return hovered
  }

  // ── picker (◎): capture-phase hover-outline + click-to-select ─────────────
  const pickerOff: (() => void)[] = []
  let picking = false

  const btn = doc.createElement('button')
  btn.textContent = '◎'
  btn.title = 'pick a DOM element to find its view'
  const onBtn = (): void => { picking ? stopPicking() : startPicking() }
  btn.addEventListener('click', onBtn)
  toolbar.appendChild(btn)

  function startPicking(): void {
    if (picking) return
    picking = true
    btn.setAttribute('aria-pressed', 'true')
    setStyle(doc.body, { cursor: 'crosshair' })
    listen(doc, 'mousemove', onPickMove, true, pickerOff)
    listen(doc, 'click', onPickClick, true, pickerOff)
    listen(doc, 'keydown', onPickKey, true, pickerOff)
  }
  function stopPicking(): void {
    if (!picking) return
    picking = false
    btn.removeAttribute('aria-pressed')
    setStyle(doc.body, { cursor: '' })
    restore()
    drain(pickerOff)
  }
  function onPickMove(e: any): void {
    const res = fromDOM(e.target)
    if (res === null) { restore(); return }
    outline(rowElOf(e.target, res))
  }
  // Any click disarms (v2 parity); selection fires only when the click landed
  // on a bound element. Capture + stopPropagation keeps the probe click from
  // reaching the app underneath.
  function onPickClick(e: any): void {
    if (e.preventDefault) e.preventDefault()
    if (e.stopPropagation) e.stopPropagation()
    const res = fromDOM(e.target)
    stopPicking()
    if (res !== null) ctx.select(res.node.id)
  }
  function onPickKey(e: any): void {
    if (e.key === 'Escape') stopPicking()
  }

  // ── Alt-hover badge: one fixed-position chip following the pointer ────────
  const altOff: (() => void)[] = []
  let engaged = false
  let badge: any = null

  // The one standing gate. preventDefault stops Chrome/Firefox opening the
  // menu bar on a bare Alt press — the focus steal swallows the keyup and was
  // v2's stuck-altHeld bug.
  const onGate = (e: any): void => {
    if (!isAlt(e) || engaged) return
    if (e.preventDefault) e.preventDefault()
    engage()
  }

  function engage(): void {
    engaged = true
    listen(doc, 'mousemove', onAltMove, true, altOff)
    listen(doc, 'keyup', onAltUp, true, altOff)
    // Window blur (Alt-Tab, app switch) would swallow the keyup — disengage
    // eagerly. The mock doc has no defaultView; the mousemove resync below is
    // the recovery path there.
    const win = doc.defaultView
    if (win != null && typeof win.addEventListener === 'function') listen(win, 'blur', disengage, false, altOff)
  }
  function disengage(): void {
    if (!engaged) return
    engaged = false
    hideBadge()
    drain(altOff)
  }
  function onAltUp(e: any): void {
    if (!isAlt(e)) return
    if (e.preventDefault) e.preventDefault()
    disengage()
  }
  function onAltMove(e: any): void {
    // Trust e.altKey over our own state: a swallowed keyup recovers on the
    // very next mousemove instead of leaving the badge armed forever.
    if (e.altKey === false) { disengage(); return }
    const res = fromDOM(e.target)
    if (res === null) { hideBadge(); return }
    showBadge(res, rowElOf(e.target, res), e)
  }

  function showBadge(res: { node: any; key?: unknown }, el: any, e: any): void {
    if (badge === null) {
      badge = doc.createElement('div')
      setStyle(badge, {
        position: 'fixed', zIndex: '2147483646', pointerEvents: 'none',
        font: '10px/1.4 ui-monospace, monospace', whiteSpace: 'nowrap',
        background: '#e3b341', color: '#0f0f0f', padding: '2px 6px', borderRadius: '2px',
      })
    }
    badge.textContent = res.key === undefined ? String(res.node.opName) : `${res.node.opName} · ${String(res.key)}`
    // Anchor to the row element when it can report a rect; the pointer is the
    // fallback (mock-dom, detached rows).
    const r = el != null && typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null
    const left = r !== null ? r.left : e.clientX + 12
    const top = r !== null ? Math.max(0, r.top - 20) : e.clientY + 14
    setStyle(badge, { left: `${left}px`, top: `${top}px` })
    const host = doc.body ?? ctx.root
    if (badge.parentNode !== host) host.appendChild(badge)
  }
  function hideBadge(): void {
    if (badge !== null && badge.parentNode != null) badge.remove()
  }

  doc.addEventListener('keydown', onGate, true)

  function destroy(): void {
    stopPicking()
    disengage()
    doc.removeEventListener('keydown', onGate, true)
    btn.removeEventListener('click', onBtn)
    btn.remove()
    badge = null
  }

  return { destroy }
}
