// @ts-nocheck
// Flame tab: per-cascade flame chart for the propagation tree triggered by
// each user mutation. Driven by $.cascades — start/stop matches the Profile
// tab's UX (poll report() into the UI), but instead of one aggregated table
// we keep the per-event tree shape so the user can pick a cascade and see
// what fanned out.
//
// Layout: a left rail listing recorded cascades (newest first), and a right
// pane rendering the selected cascade as positioned div bars. Bars are
// laid out by depth (parent chain) on Y and by startMs/totalMs on X. The
// data layer guarantees a forest of parent indices, so a single linear
// pass over frames is enough to render.
import { $ as $core, value, view, ViewProxy } from '../../core.ts'
import { iterRoots } from '../walk.ts'
import { getPanelState } from './state.ts'

const $ = $core as any
const POLL_MS = 500
const ROW_HEIGHT = 14
const MIN_BAR_PX = 1

export type FlameTabHandle = {
  render(container: HTMLElement): void
  dispose(): void
}

export function createFlameTab(): FlameTabHandle {
  const state = getPanelState()
  let handle: { stop(): any; report(): any; clear(): void } | null = null
  let pollTimer: any = null
  let listEl: HTMLElement | null = null
  let chartEl: HTMLElement | null = null
  let statusEl: HTMLElement | null = null
  let cascades: any[] = []
  let selectedId: number | null = null

  function selectedRoot() {
    const showInternal = state[value].showInternal
    const all = [...iterRoots({ internal: showInternal })]
    if (!all.length) return null
    const idx = state[value].selectedRootIdx ?? 0
    return all[Math.min(idx, all.length - 1)] ?? all[0]
  }

  function start() {
    if (handle) return
    const v = selectedRoot()
    const proxy = v ? new ViewProxy(v) : undefined
    const cap = state[value].flame?.maxCascades ?? 50
    handle = ($ as any).cascades(proxy, { maxCascades: cap })
    state.flame.running = true
    pollTimer = setInterval(refresh, POLL_MS)
    refresh()
  }

  function stop() {
    if (!handle) return
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    cascades = handle.stop()
    handle = null
    state.flame.running = false
    refresh()
  }

  function clear() {
    if (handle) handle.clear()
    cascades = []
    selectedId = null
    refresh()
  }

  function refresh() {
    if (handle) cascades = handle.report()
    // If the selected cascade got evicted, fall back to the newest.
    if (selectedId != null && !cascades.some(c => c.id === selectedId)) {
      selectedId = cascades.length ? cascades[cascades.length - 1].id : null
    }
    renderList()
    renderChart()
    if (statusEl) {
      statusEl.textContent = handle
        ? `recording — ${cascades.length} cascade(s)`
        : (cascades.length ? `${cascades.length} cascade(s) — stopped` : 'idle')
    }
  }

  function render(container: HTMLElement) {
    container.innerHTML = ''
    container.classList?.add?.('fl-tab')

    const toolbar = document.createElement('div')
    toolbar.className = 'fl-toolbar'
    container.appendChild(toolbar)

    const startStop = document.createElement('button')
    startStop.className = 'fl-btn'
    const setBtn = () => { startStop.textContent = handle ? '■ stop' : '▶ start' }
    setBtn()
    startStop.addEventListener('click', () => {
      if (handle) stop(); else start()
      setBtn()
    })
    toolbar.appendChild(startStop)

    const clearBtn = document.createElement('button')
    clearBtn.className = 'fl-btn'
    clearBtn.textContent = 'clear'
    clearBtn.addEventListener('click', clear)
    toolbar.appendChild(clearBtn)

    statusEl = document.createElement('span')
    statusEl.className = 'fl-status'
    toolbar.appendChild(statusEl)

    const split = document.createElement('div')
    split.className = 'fl-split'
    container.appendChild(split)

    listEl = document.createElement('div')
    listEl.className = 'fl-list'
    split.appendChild(listEl)

    chartEl = document.createElement('div')
    chartEl.className = 'fl-chart'
    split.appendChild(chartEl)

    refresh()
  }

  function renderList() {
    if (!listEl) return
    listEl.innerHTML = ''
    if (!cascades.length) {
      const empty = document.createElement('div')
      empty.className = 'empty'
      empty.textContent = handle
        ? 'recording — mutate something to see cascades'
        : 'no cascades — press start, then mutate'
      listEl.appendChild(empty)
      return
    }
    // Newest at the top.
    for (let i = cascades.length - 1; i >= 0; i--) {
      const c = cascades[i]
      const row = document.createElement('div')
      row.className = 'fl-cas'
      if (c.id === selectedId) row.classList?.add?.('selected')
      row.dataset.cascadeId = String(c.id)
      const id = document.createElement('span')
      id.className = 'fl-cas-id'
      id.textContent = `#${c.id}`
      row.appendChild(id)
      const meta = document.createElement('span')
      meta.className = 'fl-cas-meta'
      meta.textContent = `${c.totalMs.toFixed(2)}ms · ${c.frames.length}f`
      row.appendChild(meta)
      row.addEventListener('click', () => {
        selectedId = c.id
        // selectedCascadeId is module-local — see notes at top of file
        renderList()
        renderChart()
      })
      listEl.appendChild(row)
    }
  }

  function renderChart() {
    if (!chartEl) return
    chartEl.innerHTML = ''
    const c = cascades.find(x => x.id === selectedId) ?? cascades[cascades.length - 1]
    if (!c) {
      const empty = document.createElement('div')
      empty.className = 'empty'
      empty.textContent = 'select a cascade to view its flame chart'
      chartEl.appendChild(empty)
      return
    }
    if (selectedId == null) selectedId = c.id

    // Compute depths in one pass (frames are dispatch-order, parents
    // always precede children, so a single forward sweep is enough).
    const frames = c.frames
    const depths = new Array(frames.length)
    let maxDepth = 0
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i]
      const d = f.parent === -1 ? 0 : depths[f.parent] + 1
      depths[i] = d
      if (d > maxDepth) maxDepth = d
    }

    // The cascade can have multiple top-level (parent=-1) frames thanks
    // to coalescing. Their startMs values are anchored to the same
    // cascade-start, so a single horizontal axis works.
    const total = Math.max(c.totalMs, 0.001)  // avoid divide-by-zero on instantaneous cascades

    // Header line first, then the flame container — keeps DOM order
    // visually correct without an insertBefore.
    const head = document.createElement('div')
    head.className = 'fl-head'
    head.textContent = `cascade #${c.id} · ${c.totalMs.toFixed(2)}ms · ${frames.length} frame(s)`
    chartEl.appendChild(head)

    const inner = document.createElement('div')
    inner.className = 'fl-flame'
    inner.style.height = `${(maxDepth + 1) * ROW_HEIGHT + 4}px`
    chartEl.appendChild(inner)

    for (let i = 0; i < frames.length; i++) {
      const f = frames[i]
      const bar = document.createElement('div')
      bar.className = 'fl-frame'
      bar.dataset.verb = f.verb
      bar.dataset.ctor = f.ctor
      const dur = Math.max(f.endMs - f.startMs, 0)
      const leftPct = (f.startMs / total) * 100
      const widthPct = (dur / total) * 100
      bar.style.left = `${leftPct}%`
      bar.style.width = `max(${MIN_BAR_PX}px, ${widthPct}%)`
      bar.style.top = `${depths[i] * ROW_HEIGHT}px`
      const label = `${f.ctor}.${f.verb}${f.key.length ? ' ' + f.key.join('.') : ''}`
      bar.title = `${label} · ${dur.toFixed(3)}ms`
      const text = document.createElement('span')
      text.className = 'fl-frame-label'
      text.textContent = label
      bar.appendChild(text)
      inner.appendChild(bar)
    }
  }

  function dispose() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    if (handle) { try { handle.stop() } catch {} ; handle = null }
    state.flame.running = false
    listEl = chartEl = statusEl = null
  }

  return { render, dispose }
}
