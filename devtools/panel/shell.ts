// @ts-nocheck
// Vanilla-DOM panel shell: shadow root, dock, drag, tab buttons. Tab content
// is plumbed in by panel/index.ts (later commits add Graph/Events/Profile).
// Kept dependency-free on purpose — if the library being inspected breaks
// mid-bug-hunt, the shell still mounts and shows tab buttons.
import styles from './styles.ts'

const POS_KEY = '__ripple_panel_pos'
const COLLAPSED_KEY = '__ripple_panel_collapsed'

export const TABS = ['graph', 'events', 'profile']

export type Shell = {
  host: HTMLElement
  root: ShadowRoot
  dock: HTMLElement
  body: HTMLElement
  tabButtons: Record<string, HTMLButtonElement>
  pickButton: HTMLButtonElement
  setActiveTab(name: string): void
  destroy(): void
  onTab(fn: (name: string) => void): void
}

export function createShell(): Shell {
  const host = document.createElement('div')
  host.className = '__ripple_panel_host'
  const root = host.attachShadow({ mode: 'closed' })

  const styleEl = document.createElement('style')
  styleEl.textContent = styles
  root.appendChild(styleEl)

  const wrapper = document.createElement('div')
  wrapper.className = 'host'
  root.appendChild(wrapper)

  const dock = document.createElement('div')
  dock.className = 'dock'
  wrapper.appendChild(dock)

  // Header: title + minimize + close.
  const header = document.createElement('div')
  header.className = 'header'
  dock.appendChild(header)

  const title = document.createElement('div')
  title.className = 'title'
  title.textContent = 'data devtools'
  header.appendChild(title)

  const actions = document.createElement('div')
  actions.className = 'actions'
  header.appendChild(actions)

  const pickBtn = mkButton('◎', 'arm DOM picker (click an element to find its view)')
  pickBtn.dataset.role = 'pick'
  actions.appendChild(pickBtn)
  const minBtn = mkButton('—', 'minimize / restore')
  actions.appendChild(minBtn)
  const closeBtn = mkButton('×', 'unmount panel')
  actions.appendChild(closeBtn)

  // Tab strip.
  const tabs = document.createElement('div')
  tabs.className = 'tabs'
  dock.appendChild(tabs)

  const tabButtons: Record<string, HTMLButtonElement> = {}
  for (const name of TABS) {
    const b = document.createElement('button')
    b.textContent = name
    b.dataset.tab = name
    tabButtons[name] = b
    tabs.appendChild(b)
  }

  // Body — empty for now; later commits inject tab content.
  const body = document.createElement('div')
  body.className = 'body'
  dock.appendChild(body)

  let activeTab = TABS[0]
  const tabHandlers: ((name: string) => void)[] = []
  function setActiveTab(name: string) {
    if (!TABS.includes(name)) return
    activeTab = name
    for (const t of TABS) tabButtons[t].classList.toggle('active', t === name)
    for (const fn of tabHandlers) fn(name)
  }
  setActiveTab(activeTab)
  for (const name of TABS) {
    tabButtons[name].addEventListener('click', () => setActiveTab(name))
  }

  // Drag.
  let dragOffset: { x: number; y: number } | null = null
  header.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).tagName === 'BUTTON') return
    const rect = wrapper.getBoundingClientRect()
    dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    header.setPointerCapture(e.pointerId)
  })
  header.addEventListener('pointermove', (e) => {
    if (!dragOffset) return
    const x = e.clientX - dragOffset.x
    const y = e.clientY - dragOffset.y
    wrapper.style.left = `${x}px`
    wrapper.style.top = `${y}px`
    wrapper.style.right = 'auto'
    wrapper.style.bottom = 'auto'
  })
  header.addEventListener('pointerup', (e) => {
    if (!dragOffset) return
    dragOffset = null
    header.releasePointerCapture(e.pointerId)
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({
        left: wrapper.style.left, top: wrapper.style.top,
      }))
    } catch {}
  })

  // Restore persisted position.
  try {
    const raw = localStorage.getItem(POS_KEY)
    if (raw) {
      const { left, top } = JSON.parse(raw)
      if (left) wrapper.style.left = left
      if (top) wrapper.style.top = top
      if (left || top) {
        wrapper.style.right = 'auto'
        wrapper.style.bottom = 'auto'
      }
    }
  } catch {}

  // Collapse / restore.
  let collapsed = false
  function setCollapsed(c: boolean) {
    collapsed = c
    dock.classList.toggle('collapsed', c)
    minBtn.textContent = c ? '+' : '—'
    try { localStorage.setItem(COLLAPSED_KEY, c ? '1' : '0') } catch {}
  }
  minBtn.addEventListener('click', () => setCollapsed(!collapsed))
  try {
    if (localStorage.getItem(COLLAPSED_KEY) === '1') setCollapsed(true)
  } catch {}

  closeBtn.addEventListener('click', destroy)

  function destroy() {
    if (host.parentNode) host.parentNode.removeChild(host)
  }

  return {
    host, root, dock, body, tabButtons, pickButton: pickBtn,
    setActiveTab, destroy,
    onTab(fn) { tabHandlers.push(fn) },
  }
}

function mkButton(label: string, title: string) {
  const b = document.createElement('button')
  b.textContent = label
  b.title = title
  return b
}
