// v3/render/mock-dom.ts — a tiny recording fake DOM for the render tests
// (the v2 render/list.test.ts El-mock pattern, ported and instrumented).
//
// Every structural / text / listener operation increments a counter on the
// shared `ops` record, so tests can assert MINIMAL DOM work (e.g. "one update
// delta = one text write, zero inserts/removes"). `reset()` zeroes the
// counters without touching the tree, so a test can measure exactly one
// mutation step.

export interface DomOps {
  created: number // createElement + createTextNode
  inserted: number // appendChild + insertBefore (a move counts as one insert)
  removed: number // remove() / removeChild()
  textWrites: number // textContent assignments that reach a node
  listeners: number // addEventListener
  unlistened: number // removeEventListener
}

export class El {
  declare tag: string
  declare children: El[]
  declare parentNode: El | null
  declare attrs: Record<string, string>
  declare handlers: { type: string; fn: unknown }[]
  declare _text: string
  declare _ops: DomOps

  constructor(tag: string, ops: DomOps) {
    this.tag = tag
    this.children = []
    this.parentNode = null
    this.attrs = {}
    this.handlers = []
    this._text = ''
    this._ops = ops
  }

  private detach(): void {
    const p = this.parentNode
    if (p !== null) {
      const i = p.children.indexOf(this)
      if (i >= 0) p.children.splice(i, 1)
      this.parentNode = null
    }
  }

  appendChild(k: El): El {
    k.detach()
    k.parentNode = this
    this.children.push(k)
    this._ops.inserted++
    return k
  }

  insertBefore(k: El, ref: El | null | undefined): El {
    k.detach()
    k.parentNode = this
    if (ref == null) {
      this.children.push(k)
    } else {
      const i = this.children.indexOf(ref)
      this.children.splice(i < 0 ? this.children.length : i, 0, k)
    }
    this._ops.inserted++
    return k
  }

  removeChild(k: El): El {
    const i = this.children.indexOf(k)
    if (i >= 0) {
      this.children.splice(i, 1)
      k.parentNode = null
      this._ops.removed++
    }
    return k
  }

  remove(): void {
    if (this.parentNode !== null) {
      this.detach()
      this._ops.removed++
    }
  }

  setAttribute(k: string, v: string): void {
    this.attrs[k] = v
  }

  removeAttribute(k: string): void {
    delete this.attrs[k]
  }

  addEventListener(type: string, fn: unknown): void {
    this.handlers.push({ type, fn })
    this._ops.listeners++
  }

  removeEventListener(type: string, fn: unknown): void {
    const i = this.handlers.findIndex((h) => h.type === type && h.fn === fn)
    if (i >= 0) {
      this.handlers.splice(i, 1)
      this._ops.unlistened++
    }
  }

  set textContent(v: unknown) {
    this._text = v == null ? '' : String(v)
    this._ops.textWrites++
  }

  get textContent(): string {
    return this._text
  }

  // Recursive rendered text (v2 mock idiom) — the assertion workhorse.
  get text(): string {
    return (this.tag === '#text' ? this._text : '') + this.children.map((c) => c.text).join('')
  }
}

export interface MockDom {
  document: {
    createElement(tag: string): El
    createTextNode(s: unknown): El
  }
  ops: DomOps
  reset(): void
}

// Installs the stubs on globalThis.document (each test file runs in its own
// process under node --test, so this is isolated) and returns the recorder.
export function installMockDom(): MockDom {
  const ops: DomOps = { created: 0, inserted: 0, removed: 0, textWrites: 0, listeners: 0, unlistened: 0 }
  const document = {
    createElement(tag: string): El {
      ops.created++
      return new El(tag, ops)
    },
    createTextNode(s: unknown): El {
      ops.created++
      const e = new El('#text', ops)
      e._text = s == null ? '' : String(s)
      return e
    },
  }
  ;(globalThis as any).document = document
  return {
    document,
    ops,
    reset() {
      ops.created = 0
      ops.inserted = 0
      ops.removed = 0
      ops.textWrites = 0
      ops.listeners = 0
      ops.unlistened = 0
    },
  }
}
