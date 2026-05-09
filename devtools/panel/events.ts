// @ts-nocheck
// Events tab: live tail of $.trace events for the currently-selected root.
// Push-driven (no polling) — onEvent appends to a ring buffer; renderer
// updates incrementally (a single new row appended to the list, not a full
// rebuild) so the panel stays smooth under bursts.
import { $ as $core, value, view, ViewProxy } from '../../core.ts'
import { iterRoots } from '../walk.ts'
import { getPanelState } from './state.ts'

const $ = $core as any

export type EventsTabHandle = {
  render(container: HTMLElement): void
  dispose(): void
}

type EventRecord = {
  t: number
  verb: string
  key: (string | number)[]
  payload: unknown
}

export function createEventsTab(): EventsTabHandle {
  const state = getPanelState()
  let traceDispose: (() => void) | null = null
  let buffer: EventRecord[] = []
  let listEl: HTMLElement | null = null
  let countEl: HTMLElement | null = null

  function selectedRoot() {
    const showInternal = state[value].showInternal
    const all = [...iterRoots({ internal: showInternal })]
    if (!all.length) return null
    const idx = state[value].selectedRootIdx ?? 0
    return all[Math.min(idx, all.length - 1)] ?? all[0]
  }

  function passesFilter(ev: EventRecord) {
    const f = state[value].events.filter
    if (!f) return true
    const haystack = `${ev.verb} ${ev.key.join('.')}`
    return haystack.toLowerCase().includes(f.toLowerCase())
  }

  function onEvent(ev: EventRecord) {
    if (state[value].paused) return
    buffer.push(ev)
    const max = state[value].events.ringBufferSize
    if (buffer.length > max) buffer.splice(0, buffer.length - max)
    if (listEl && passesFilter(ev)) {
      listEl.appendChild(makeRow(ev))
      // Trim DOM rows to the buffer length so we don't grow unboundedly
      // when filtering is permissive.
      while (listEl.children.length > buffer.length) listEl.removeChild(listEl.children[0])
      // Auto-scroll to the bottom.
      try { listEl.scrollTop = listEl.scrollHeight } catch {}
    }
    if (countEl) countEl.textContent = `${buffer.length}/${max}`
  }

  function installTrace() {
    if (traceDispose) { traceDispose(); traceDispose = null }
    const v = selectedRoot()
    if (!v) return
    const proxy = new ViewProxy(v)
    traceDispose = ($ as any).trace(proxy, {
      log: false,
      onEvent,
    })
  }

  function render(container: HTMLElement) {
    container.innerHTML = ''

    // Toolbar.
    const toolbar = document.createElement('div')
    toolbar.className = 'ev-toolbar'
    container.appendChild(toolbar)

    const pauseBtn = document.createElement('button')
    pauseBtn.className = 'ev-btn'
    pauseBtn.textContent = state[value].paused ? '▶ resume' : '⏸ pause'
    pauseBtn.addEventListener('click', () => {
      state.paused = !state[value].paused
      pauseBtn.textContent = state[value].paused ? '▶ resume' : '⏸ pause'
    })
    toolbar.appendChild(pauseBtn)

    const clearBtn = document.createElement('button')
    clearBtn.className = 'ev-btn'
    clearBtn.textContent = 'clear'
    clearBtn.addEventListener('click', () => {
      buffer = []
      if (listEl) listEl.innerHTML = ''
      if (countEl) countEl.textContent = `0/${state[value].events.ringBufferSize}`
    })
    toolbar.appendChild(clearBtn)

    const filterInput = document.createElement('input')
    filterInput.className = 'ev-filter'
    filterInput.type = 'text'
    filterInput.placeholder = 'filter (verb, key)…'
    filterInput.value = state[value].events.filter
    filterInput.addEventListener('input', () => {
      state.events.filter = filterInput.value
      // Re-render the visible list from the buffer.
      if (!listEl) return
      listEl.innerHTML = ''
      for (const ev of buffer) if (passesFilter(ev)) listEl.appendChild(makeRow(ev))
      try { listEl.scrollTop = listEl.scrollHeight } catch {}
    })
    toolbar.appendChild(filterInput)

    countEl = document.createElement('span')
    countEl.className = 'ev-count'
    countEl.textContent = `${buffer.length}/${state[value].events.ringBufferSize}`
    toolbar.appendChild(countEl)

    // List.
    listEl = document.createElement('div')
    listEl.className = 'ev-list'
    container.appendChild(listEl)
    for (const ev of buffer) if (passesFilter(ev)) listEl.appendChild(makeRow(ev))

    if (!selectedRoot()) {
      const empty = document.createElement('div')
      empty.className = 'empty'
      empty.textContent = 'No live roots — call $({...}) somewhere on the page.'
      container.appendChild(empty)
      return
    }
    installTrace()
  }

  function dispose() {
    if (traceDispose) { traceDispose(); traceDispose = null }
    listEl = null
    countEl = null
  }

  return { render, dispose }
}

function makeRow(ev: EventRecord) {
  const row = document.createElement('div')
  row.className = 'ev-row'

  const verb = document.createElement('span')
  verb.className = `ev-verb ev-${ev.verb}`
  verb.textContent = ev.verb
  row.appendChild(verb)

  const key = document.createElement('span')
  key.className = 'ev-key'
  key.textContent = ev.key.length ? ev.key.join('.') : '<root>'
  row.appendChild(key)

  const payload = document.createElement('span')
  payload.className = 'ev-payload'
  payload.textContent = formatPayload(ev.payload)
  row.appendChild(payload)

  return row
}

function formatPayload(p: unknown) {
  if (p === undefined) return ''
  if (typeof p === 'string') return ` ${p}`
  if (Array.isArray(p)) return ` [${p.length}]`
  if (typeof p === 'object' && p) return ` { keys: ${Object.keys(p as object).length} }`
  return ` ${String(p)}`
}
