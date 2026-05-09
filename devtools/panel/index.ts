// @ts-nocheck
// Public entry for the devtools overlay panel. mount() attaches the panel
// to document.body and wires the shell's tab buttons to the reactive panel
// state. unmount() removes everything. Idempotent: a second mount returns
// the existing shell.
import { value } from '../../core.ts'
import { createShell, type Shell } from './shell.ts'
import { getPanelState, resetPanelState } from './state.ts'
import { createGraphTab } from './graph.ts'

let current: Shell | null = null
let graphTab: ReturnType<typeof createGraphTab> | null = null

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

// Tab dispatch. Graph tab is wired here; Events/Profile/Picker land in
// commits 6–8. Each tab module owns its own subscriptions and is disposed
// when the user switches away (so we don't accumulate trace listeners).
function renderTab(name: string) {
  if (!current) return
  const body = current.body
  body.innerHTML = ''

  // Tear down the previous tab's subscriptions before installing the new one.
  if (graphTab) { graphTab.dispose(); graphTab = null }

  if (name === 'graph') {
    graphTab = createGraphTab()
    graphTab.render(body)
    return
  }

  const empty = document.createElement('div')
  empty.className = 'empty'
  empty.textContent = `${name} tab content lands in a later commit`
  body.appendChild(empty)
}

export function unmount() {
  if (!current) return
  if (graphTab) { graphTab.dispose(); graphTab = null }
  current.destroy()
  current = null
  resetPanelState()
}

export function getShell() { return current }
