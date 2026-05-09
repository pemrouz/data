// @ts-nocheck
// Reactive panel state. Single $()-backed root holding everything the tabs
// observe; registered via internalRoot() so it doesn't pollute the user-facing
// graph view (the panel filters _devtoolsInternalRoots out of iterRoots()).
//
// Persistence: a small subset (activeTab, selectedRootIdx, showInternal) is
// mirrored to localStorage on change so a refresh comes back where the user
// left off. The bigger fields (expanded tree state, ring buffer, profile
// snapshots) are deliberately ephemeral.
import { $, value } from '../../core.ts'
import { internalRoot } from '../walk.ts'

const PERSIST_KEY = '__ripple_panel_state'

// Returned as a fresh object each call. Mutations via the reactive proxy
// hit the *live* underlying object — if DEFAULT were a module-scoped
// constant, nested fields like graph.layout would be shared across every
// stateProxy ever created (and across resetPanelState() calls), and a
// test that flipped graph.layout='dag' would leak that into every later
// test that re-rehydrates from DEFAULT. Returning a fresh tree per call
// makes resetPanelState() actually reset.
function makeDefault() {
  return {
    activeTab: 'graph',         // 'graph' | 'events' | 'profile' | 'flame'
    selectedRootIdx: null,      // index into iterRoots(); null = first available
    showInternal: false,
    paused: false,
    pickerArmed: false,
    hoverArmed: false,
    graph:   { expanded: {}, layout: 'tree' },  // layout: 'tree' | 'dag'
    events:  { ringBufferSize: 500, filter: '' },
    profile: { running: false, lastReportAt: 0 },
    // Flame tab state is deliberately ephemeral — running flag + which
    // cascade is being inspected. The cascade buffer itself lives on the
    // recorder, not in panel state.
    flame:   { running: false, selectedCascadeId: null, maxCascades: 50 },
  }
}

function loadPersisted() {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(PERSIST_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function persist(snapshot) {
  try {
    if (typeof localStorage === 'undefined') return
    const { activeTab, selectedRootIdx, showInternal } = snapshot
    localStorage.setItem(PERSIST_KEY, JSON.stringify({
      activeTab, selectedRootIdx, showInternal,
    }))
  } catch {}
}

let stateProxy = null
// Module-level lifetime anchor for the persistence FunctionSink. The
// connect(obj, fn) shape requires `obj` to be a plain object (not a Proxy
// of a function — ViewProxy fails the `typeof === 'object'` check and
// falls through to bare attach, which mis-installs the sink). Holding
// `lifetimeAnchor` at module scope keeps the sink alive as long as the
// devtools layer is loaded.
const lifetimeAnchor: Record<string, unknown> = {}

export function getPanelState() {
  if (stateProxy) return stateProxy
  const initial = { ...makeDefault(), ...loadPersisted() }
  stateProxy = $(initial)
  internalRoot(stateProxy)
  // Per-event callback: re-persist the small subset on every change.
  stateProxy.connect(lifetimeAnchor, () => persist(stateProxy[value]))
  return stateProxy
}

// Clear the in-memory singleton so a subsequent getPanelState() rehydrates
// from localStorage. Used by tests; production code calls this from unmount.
// Does NOT clear the persisted snapshot — call clearPersistedPanelState() for
// that.
export function resetPanelState() {
  stateProxy = null
  pickedSink = null
}

// The most recently picked sink (DOMSink, ArrSink, etc.) — held outside
// the reactive state proxy because sinks aren't JSON-serializable and we
// don't want them mirrored to localStorage. Graph tab reads this on render
// to highlight the matching node; picker writes it on a successful pick.
let pickedSink: any = null
export function getPickedSink() { return pickedSink }
export function setPickedSink(s: any) { pickedSink = s }
export function clearPickedSink() { pickedSink = null }

export function clearPersistedPanelState() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(PERSIST_KEY)
  } catch {}
}
