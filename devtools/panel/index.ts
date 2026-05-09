// @ts-nocheck
// Public entry for the devtools overlay panel. mount() attaches the panel
// to document.body; unmount() removes it. Idempotent: calling mount twice
// returns the same shell.
import { createShell, type Shell } from './shell.ts'

let current: Shell | null = null

export function mount(): Shell | null {
  if (typeof document === 'undefined') return null
  if (current) return current
  current = createShell()
  document.body.appendChild(current.host)
  // Tab handlers are wired in subsequent commits as Graph/Events/Profile
  // tab modules land. For now the shell shows tab buttons but the body is
  // empty.
  current.body.innerHTML = '<div class="empty">tab content lands in commits 5–8</div>'
  return current
}

export function unmount() {
  if (!current) return
  current.destroy()
  current = null
}

export function getShell() { return current }
