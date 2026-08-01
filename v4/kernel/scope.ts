// v3/kernel/scope.ts — explicit ownership. Scopes are the lifecycle semantics;
// GC timing can never change observable results (WeakRef survives only as a
// dev-mode leak detector, elsewhere).
//
// References are strong and flow downward: a scope strongly holds its owned
// nodes/subscriptions; disposing a scope tears its subtree down synchronously
// and deterministically. Leak-free-by-default is preserved by reachability:
// no global strong registry exists, so dropping every user reference to a
// graph makes the whole graph (scope → nodes → sinks) collectable.

export interface Owned {
  dispose(): void
}

export class Scope implements Owned {
  static nextId = 1
  readonly id: number
  disposed = false
  private owned: Set<Owned> | null = new Set()
  private disposers: (() => void)[] | null = null

  constructor(parent?: Scope | null) {
    this.id = Scope.nextId++
    if (parent) parent.add(this)
  }

  add(child: Owned): void {
    if (this.disposed) {
      child.dispose() // adding to a dead scope disposes immediately — never leaks silently
      return
    }
    this.owned!.add(child)
  }

  delete(child: Owned): void {
    this.owned?.delete(child)
  }

  onDispose(fn: () => void): void {
    if (this.disposed) {
      fn()
      return
    }
    ;(this.disposers ??= []).push(fn)
  }

  // Disposal COMPLETES even when a child dispose / cleanup throws: every
  // remaining child and disposer still runs, then the failures rethrow as
  // one AggregateError. Pre-fix, one throwing onCleanup aborted the walk and
  // left the rest of the subtree's subscriptions live.
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const owned = this.owned!
    this.owned = null
    let errors: unknown[] | null = null
    for (const child of owned) {
      try {
        child.dispose()
      } catch (e) {
        ;(errors ??= []).push(e)
      }
    }
    const ds = this.disposers
    this.disposers = null
    if (ds)
      for (let i = ds.length - 1; i >= 0; i--) {
        try {
          ds[i]()
        } catch (e) {
          ;(errors ??= []).push(e)
        }
      }
    if (errors !== null)
      throw new AggregateError(errors, `data: ${errors.length} cleanup(s) failed during scope disposal`)
  }

  [Symbol.dispose](): void {
    this.dispose()
  }
}

// Ambient current-scope stack (Solid-style), with explicit override.
let current: Scope | null = null

export function currentScope(): Scope | null {
  return current
}

export function scope(parent?: Scope | null): Scope {
  return new Scope(parent === undefined ? current : parent)
}

export function runInScope<R>(s: Scope | null, fn: () => R): R {
  const prev = current
  current = s
  try {
    return fn()
  } finally {
    current = prev
  }
}

// The component-lifecycle hook: registers fn on the AMBIENT scope, to run when
// that scope disposes (a component unmounting, a render() handle disposing).
// Fail-fast outside a scope — a cleanup that would never run is a leak, not a
// no-op. Note: row fns are deliberately NOT a scope (the list sink re-runs
// them on row updates, so registrations would accumulate) — a row that needs
// lifecycle wraps its content in a component.
export function onCleanup(fn: () => void): void {
  if (current === null)
    throw new Error(
      'data: onCleanup() called outside a scope — the cleanup would never run. ' +
        'Call it inside a component (a function tag / component()); ' +
        'row fns re-run on updates and are not a scope — wrap the row content in a component.',
    )
  current.onDispose(fn)
}
