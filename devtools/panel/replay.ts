// @ts-nocheck
// Replay tab: time-travel-lite. Records cascades with state snapshots
// (before/after) via $.cascades(..., { captureState: true }), and lets
// the user scrub through the recorded history to see what state existed
// at each moment.
//
// What this is NOT (yet): a true reverse-execution facility. The live
// View graph is not rewound — we only display historical snapshots.
// Implementing true rewind would need either reverse-op logging or a
// sandbox graph; either is meaningfully bigger than this commit.
//
// UX: start/stop button + a slider over recorded cascades. Below the
// slider, a textarea-styled snapshot panel renders the value at the
// scrubbed position. The toggle "show after-state" flips between the
// snapshot taken before the cascade and after.
import { $ as $core, value, view, ViewProxy } from '../../core.ts'
import { iterRoots } from '../walk.ts'
import { getPanelState } from './state.ts'

const $ = $core as any
const POLL_MS = 500

export type ReplayTabHandle = {
  render(container: HTMLElement): void
  dispose(): void
}

export function createReplayTab(): ReplayTabHandle {
  const state = getPanelState()
  let handle: { stop(): any; report(): any; clear(): void } | null = null
  let pollTimer: any = null
  let cascades: any[] = []
  let sliderEl: HTMLInputElement | null = null
  let scrubLabel: HTMLElement | null = null
  let snapshotEl: HTMLElement | null = null
  let statusEl: HTMLElement | null = null

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
    const cap = state[value].replay?.maxCascades ?? 100
    handle = ($ as any).cascades(proxy, { maxCascades: cap, captureState: true })
    state.replay.running = true
    pollTimer = setInterval(refresh, POLL_MS)
    refresh()
  }

  function stop() {
    if (!handle) return
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    cascades = handle.stop()
    handle = null
    state.replay.running = false
    refresh()
  }

  function clear() {
    if (handle) handle.clear()
    cascades = []
    refresh()
  }

  function refresh() {
    if (handle) cascades = handle.report()
    if (sliderEl) {
      sliderEl.max = String(Math.max(0, cascades.length - 1))
      const idx = Number(sliderEl.value)
      if (idx > cascades.length - 1) sliderEl.value = String(Math.max(0, cascades.length - 1))
    }
    renderSnapshot()
    if (statusEl) {
      statusEl.textContent = handle
        ? `recording — ${cascades.length} cascade(s)`
        : (cascades.length ? `${cascades.length} cascade(s) — stopped` : 'idle')
    }
  }

  function render(container: HTMLElement) {
    container.innerHTML = ''
    container.classList?.add?.('rp-tab')

    const toolbar = document.createElement('div')
    toolbar.className = 'rp-toolbar'
    container.appendChild(toolbar)

    const startStop = document.createElement('button')
    startStop.className = 'rp-btn'
    const setBtn = () => { startStop.textContent = handle ? '■ stop' : '▶ start' }
    setBtn()
    startStop.addEventListener('click', () => {
      if (handle) stop(); else start()
      setBtn()
    })
    toolbar.appendChild(startStop)

    const clearBtn = document.createElement('button')
    clearBtn.className = 'rp-btn'
    clearBtn.textContent = 'clear'
    clearBtn.addEventListener('click', clear)
    toolbar.appendChild(clearBtn)

    statusEl = document.createElement('span')
    statusEl.className = 'rp-status'
    toolbar.appendChild(statusEl)

    // Scrubber row.
    const scrubRow = document.createElement('div')
    scrubRow.className = 'rp-scrub'
    container.appendChild(scrubRow)

    sliderEl = document.createElement('input') as HTMLInputElement
    sliderEl.type = 'range'
    sliderEl.min = '0'
    sliderEl.max = '0'
    sliderEl.value = '0'
    sliderEl.className = 'rp-slider'
    sliderEl.addEventListener('input', () => {
      state.replay.scrubIdx = Number(sliderEl!.value)
      renderSnapshot()
    })
    scrubRow.appendChild(sliderEl)

    scrubLabel = document.createElement('span')
    scrubLabel.className = 'rp-scrub-label'
    scrubRow.appendChild(scrubLabel)

    // Snapshot pane.
    snapshotEl = document.createElement('pre')
    snapshotEl.className = 'rp-snapshot'
    container.appendChild(snapshotEl)

    refresh()
  }

  function renderSnapshot() {
    if (!snapshotEl || !scrubLabel || !sliderEl) return
    if (!cascades.length) {
      snapshotEl.textContent = ''
      scrubLabel.textContent = handle ? 'recording — mutate something to populate' : 'no cascades — press start, then mutate'
      return
    }
    const idx = Math.max(0, Math.min(Number(sliderEl.value) || 0, cascades.length - 1))
    const c = cascades[idx]
    scrubLabel.textContent = `#${c.id} · ${idx + 1}/${cascades.length} · ${c.totalMs.toFixed(2)}ms`
    snapshotEl.textContent = formatSnapshot(c.state)
  }

  function formatSnapshot(v: any): string {
    if (v === undefined) return '(undefined)'
    if (v === null) return '(null)'
    try { return JSON.stringify(v, null, 2) }
    catch { return String(v) }
  }

  function dispose() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    if (handle) { try { handle.stop() } catch {} ; handle = null }
    state.replay.running = false
    sliderEl = scrubLabel = snapshotEl = statusEl = null
  }

  return { render, dispose }
}
