// @ts-nocheck
// Public entry for the devtools overlay panel. mount() attaches the panel
// to document.body and wires the shell's tab buttons to the reactive panel
// state. unmount() removes everything. Idempotent: a second mount returns
// the existing shell.
import { value } from '../../core.ts'
import { createShell, type Shell } from './shell.ts'
import { getPanelState, resetPanelState } from './state.ts'
import { createGraphTab } from './graph.ts'
import { createEventsTab } from './events.ts'
import { createProfileTab } from './profile.ts'
import { createFlameTab } from './flame.ts'
import { createReplayTab } from './replay.ts'
import { createPicker } from './picker.ts'
import { createHover } from './hover.ts'

let current: Shell | null = null
let graphTab: ReturnType<typeof createGraphTab> | null = null
let eventsTab: ReturnType<typeof createEventsTab> | null = null
let profileTab: ReturnType<typeof createProfileTab> | null = null
let flameTab: ReturnType<typeof createFlameTab> | null = null
let replayTab: ReturnType<typeof createReplayTab> | null = null
let picker: ReturnType<typeof createPicker> | null = null
let hover: ReturnType<typeof createHover> | null = null

export function mount(): Shell | null {
  if (typeof document === 'undefined') return null
  if (current) return current
  current = createShell()
  document.body.appendChild(current.host)

  const state = getPanelState()

  // Reflect the persisted activeTab into the shell on first mount.
  current.setActiveTab(state[value].activeTab)

  // Click → state + render. onTab is the single source of renderTab calls
  // for shell-driven tab switches. The state listener below only mirrors
  // programmatic state changes back into the shell — it does NOT re-render,
  // because shell.setActiveTab will fire onTab again, which sees the state
  // already === name (skipping the mutation) and calls renderTab itself.
  current.onTab((name) => {
    if (state[value].activeTab !== name) state.activeTab = name
    renderTab(name)
  })

  // State → shell sync (e.g. picker auto-navigates by mutating
  // state.activeTab). Lifetime anchored to the shell host.
  state.activeTab.connect(current.host, (ev) => {
    if (ev.type !== 'update') return
    const next = state[value].activeTab
    current?.setActiveTab(next)
  })

  // Picker + Hover: mutually exclusive — arming one disarms the other so
  // we don't end up with two competing capture-phase click listeners.
  picker = createPicker()
  hover = createHover(current.root)
  current.pickButton.addEventListener('click', () => {
    if (!picker) return
    if (picker.isArmed()) picker.disarm()
    else {
      hover?.disarm()
      picker.arm()
    }
    current?.pickButton.classList?.toggle?.('active', picker.isArmed())
    current?.hoverButton.classList?.toggle?.('active', !!hover?.isArmed())
  })
  current.hoverButton.addEventListener('click', () => {
    if (!hover) return
    if (hover.isArmed()) hover.disarm()
    else {
      picker?.disarm()
      hover.arm()
    }
    current?.hoverButton.classList?.toggle?.('active', hover.isArmed())
    current?.pickButton.classList?.toggle?.('active', !!picker?.isArmed())
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
  if (eventsTab) { eventsTab.dispose(); eventsTab = null }
  if (profileTab) { profileTab.dispose(); profileTab = null }
  if (flameTab) { flameTab.dispose(); flameTab = null }
  if (replayTab) { replayTab.dispose(); replayTab = null }

  if (name === 'graph') {
    graphTab = createGraphTab()
    graphTab.render(body)
    return
  }
  if (name === 'events') {
    eventsTab = createEventsTab()
    eventsTab.render(body)
    return
  }
  if (name === 'profile') {
    profileTab = createProfileTab()
    profileTab.render(body)
    return
  }
  if (name === 'flame') {
    flameTab = createFlameTab()
    flameTab.render(body)
    return
  }
  if (name === 'replay') {
    replayTab = createReplayTab()
    replayTab.render(body)
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
  if (eventsTab) { eventsTab.dispose(); eventsTab = null }
  if (profileTab) { profileTab.dispose(); profileTab = null }
  if (flameTab) { flameTab.dispose(); flameTab = null }
  if (replayTab) { replayTab.dispose(); replayTab = null }
  if (picker) { picker.disarm(); picker = null }
  if (hover) { hover.disarm(); hover = null }
  current.destroy()
  current = null
  resetPanelState()
}

export function getShell() { return current }
