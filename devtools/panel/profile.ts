// @ts-nocheck
// Profile tab: start/stop button, polled report() into a sortable table.
// Polling (vs push) is right here — $.profile.report() cheaply materializes
// a snapshot from the running accumulator; pulling once per 500ms keeps
// the UI smooth without dropping data.
import { $ as $core, value, view, ViewProxy } from '../../core.ts'
import { iterRoots } from '../walk.ts'
import { getPanelState } from './state.ts'

const $ = $core as any
const POLL_MS = 500

type SortKey = 'ctor' | 'count' | 'totalMs' | 'avgMs'

export type ProfileTabHandle = {
  render(container: HTMLElement): void
  dispose(): void
}

export function createProfileTab(): ProfileTabHandle {
  const state = getPanelState()
  let handle: { stop(): any; report(): any } | null = null
  let pollTimer: any = null
  let tableEl: HTMLElement | null = null
  let lastReport: any = null
  let sortBy: SortKey = 'totalMs'
  let sortDesc = true

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
    handle = ($ as any).profile(proxy)
    state.profile.running = true
    pollTimer = setInterval(() => {
      lastReport = handle?.report?.() ?? null
      renderTable()
    }, POLL_MS)
    // Immediate first render so the user sees the empty-bucket state
    // rather than a stale "not running" message.
    renderTable()
  }

  function stop() {
    if (!handle) return
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    lastReport = handle.stop()
    handle = null
    state.profile.running = false
    renderTable()
  }

  function clear() {
    lastReport = null
    renderTable()
  }

  function render(container: HTMLElement) {
    container.innerHTML = ''
    const toolbar = document.createElement('div')
    toolbar.className = 'pf-toolbar'
    container.appendChild(toolbar)

    const startStop = document.createElement('button')
    startStop.className = 'pf-btn'
    const setBtn = () => {
      startStop.textContent = handle ? '■ stop' : '▶ start'
    }
    setBtn()
    startStop.addEventListener('click', () => {
      if (handle) stop(); else start()
      setBtn()
    })
    toolbar.appendChild(startStop)

    const clearBtn = document.createElement('button')
    clearBtn.className = 'pf-btn'
    clearBtn.textContent = 'clear'
    clearBtn.addEventListener('click', clear)
    toolbar.appendChild(clearBtn)

    const status = document.createElement('span')
    status.className = 'pf-status'
    status.textContent = handle ? 'recording…' : 'idle'
    toolbar.appendChild(status)

    tableEl = document.createElement('div')
    tableEl.className = 'pf-table-wrap'
    container.appendChild(tableEl)
    renderTable()
  }

  function renderTable() {
    if (!tableEl) return
    tableEl.innerHTML = ''
    if (!lastReport || !lastReport.byOperator?.length) {
      const empty = document.createElement('div')
      empty.className = 'empty'
      empty.textContent = handle
        ? 'recording — mutate something to see counts'
        : 'no data — press start, then mutate something'
      tableEl.appendChild(empty)
      return
    }

    const table = document.createElement('table')
    table.className = 'pf-table'

    // Header.
    const thead = document.createElement('thead')
    const tr = document.createElement('tr')
    for (const col of ['ctor', 'count', 'totalMs', 'avgMs'] as SortKey[]) {
      const th = document.createElement('th')
      const arrow = sortBy === col ? (sortDesc ? ' ▼' : ' ▲') : ''
      th.textContent = col + arrow
      th.addEventListener('click', () => {
        if (sortBy === col) sortDesc = !sortDesc
        else { sortBy = col; sortDesc = col !== 'ctor' }
        renderTable()
      })
      tr.appendChild(th)
    }
    thead.appendChild(tr)
    table.appendChild(thead)

    // Body.
    const tbody = document.createElement('tbody')
    const rows = lastReport.byOperator.slice().sort((a: any, b: any) => {
      const av = a[sortBy], bv = b[sortBy]
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv))
      return sortDesc ? -cmp : cmp
    })
    for (const r of rows) {
      const tr = document.createElement('tr')
      addCell(tr, `${r.ctor} ${(r.key || []).join('.') || ''}`)
      addCell(tr, String(r.count))
      addCell(tr, r.totalMs.toFixed(2))
      addCell(tr, r.avgMs.toFixed(3))
      tbody.appendChild(tr)
    }
    table.appendChild(tbody)
    tableEl.appendChild(table)
  }

  function addCell(tr: HTMLElement, text: string) {
    const td = document.createElement('td')
    td.textContent = text
    tr.appendChild(td)
  }

  function dispose() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    if (handle) { try { handle.stop() } catch {} ; handle = null }
    state.profile.running = false
    tableEl = null
  }

  return { render, dispose }
}
