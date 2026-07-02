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

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const owned = this.owned!
    this.owned = null
    for (const child of owned) child.dispose()
    const ds = this.disposers
    this.disposers = null
    if (ds) for (let i = ds.length - 1; i >= 0; i--) ds[i]()
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
