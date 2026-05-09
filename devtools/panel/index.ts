// @ts-nocheck
// Public entry for the devtools overlay panel. mount() attaches the panel
// to document.body and wires the shell's tab buttons to the reactive panel
// state. unmount() removes everything. Idempotent: a second mount returns
// the existing shell.
import { value } from '../../core.ts'
import { createShell, type Shell } from './shell.ts'
import { getPanelState, resetPanelState } from './state.ts'

let current: Shell | null = null

export function mount(): Shell | null {
  if (typeof document === 'undefined') return null
  if (current) return current
  current = createShell()
  document.body.appendChild(current.host)

  const state = getPanelState()

  // Reflect the persisted activeTab into the shell on first mount.
  current.setActiveTab(state[value].activeTab)

  // Click → state.
  current.onTab((name) => {
    if (state[value].activeTab !== name) state.activeTab = name
    renderTab(name)
  })

  // State → re-render (when activeTab changes via, say, the picker auto-
  // navigating after clicking a DOM element). Lifetime anchored to the
  // shell host so this sink survives until unmount.
  state.activeTab.connect(current.host, (ev) => {
    if (ev.type !== 'update') return
    const next = state[value].activeTab
    current?.setActiveTab(next)
    renderTab(next)
  })

  renderTab(state[value].activeTab)
  return current
}

// Tab content modules (Graph/Events/Profile) land in commits 5–7. For
// now each tab shows a placeholder so users can verify routing works.
function renderTab(name: string) {
  if (!current) return
  const body = current.body
  body.innerHTML = ''
  const empty = document.createElement('div')
  empty.className = 'empty'
  empty.textContent = `${name} tab content lands in commits 5–8`
  body.appendChild(empty)
}

export function unmount() {
  if (!current) return
  current.destroy()
  current = null
  resetPanelState()
}

export function getShell() { return current }
