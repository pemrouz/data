// shim/assert.js — replaces `node:assert` for the stripped conformance suite:
// deepStrictEqual / ok / throws / strictEqual with Node's strict semantics
// (Object.is at leaves so NaN ≡ NaN; own-key sets must match so {a: undefined}
// ≠ {}; prototypes must match; Map/Set/Array/Date/RegExp/typed arrays).
export class AssertionError extends Error { constructor(m) { super(m); this.name = 'AssertionError' } }
const fail = (m) => { throw new AssertionError(m) }
const show = (v) => { try { return typeof v === 'string' ? JSON.stringify(v) : v instanceof Map ? `Map(${[...v].map(([k, x]) => `${show(k)} => ${show(x)}`).join(', ')})` : v instanceof Set ? `Set(${[...v].map(show).join(', ')})` : JSON.stringify(v, (k, x) => typeof x === 'number' && !Number.isFinite(x) ? String(x) : x) ?? String(v) } catch { return String(v) } }

export function deepEq(a, b, stack = []) {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false
  for (const [x, y] of stack) if (x === a && y === b) return true
  stack = [...stack, [a, b]]
  if (a instanceof Date) return Object.is(a.getTime(), b.getTime())
  if (a instanceof RegExp) return a.source === b.source && a.flags === b.flags
  if (ArrayBuffer.isView(a)) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false; return true }
  if (a instanceof Map) {
    if (a.size !== b.size) return false
    for (const [k, v] of a) { if (!b.has(k)) return false; if (!deepEq(v, b.get(k), stack)) return false }
    return true
  }
  if (a instanceof Set) {
    if (a.size !== b.size) return false
    outer: for (const v of a) { if (b.has(v)) continue; for (const w of b) if (deepEq(v, w, stack)) continue outer; return false }
    return true
  }
  if (Array.isArray(a)) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (!deepEq(a[i], b[i], stack)) return false; return true }
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  for (const k of ka) { if (!Object.prototype.hasOwnProperty.call(b, k)) return false; if (!deepEq(a[k], b[k], stack)) return false }
  return true
}

export function deepStrictEqual(a, b, msg) { if (!deepEq(a, b)) fail(msg ?? `deepStrictEqual: ${show(a)} !== ${show(b)}`) }
export function notDeepStrictEqual(a, b, msg) { if (deepEq(a, b)) fail(msg ?? `notDeepStrictEqual: ${show(a)}`) }
export function strictEqual(a, b, msg) { if (!Object.is(a, b)) fail(msg ?? `strictEqual: ${show(a)} !== ${show(b)}`) }
export function notStrictEqual(a, b, msg) { if (Object.is(a, b)) fail(msg ?? `notStrictEqual: ${show(a)}`) }
export const equal = strictEqual, notEqual = notStrictEqual
export function ok(v, msg) { if (!v) fail(msg ?? `ok: ${show(v)} is falsy`) }
export function throws(fn, expected, msg) {
  if (typeof expected === 'string') { msg = expected; expected = undefined }
  let err, threw = false
  try { fn() } catch (e) { threw = true; err = e }
  if (!threw) fail(msg ?? 'throws: function did not throw')
  const text = err && err.message !== undefined ? err.message : String(err)
  if (expected instanceof RegExp) { if (!expected.test(text) && !expected.test(String(err))) fail(msg ?? `throws: ${show(text)} does not match ${expected}`) }
  else if (typeof expected === 'function') {
    if (expected.prototype !== undefined && err instanceof expected) return
    if (expected.prototype !== undefined && Error.prototype.isPrototypeOf(expected.prototype)) fail(msg ?? `throws: ${err?.name} is not ${expected.name}`)
    if (expected(err) !== true) fail(msg ?? 'throws: validation function returned false')
  } else if (expected && typeof expected === 'object') {
    for (const k of Object.keys(expected)) {
      const want = expected[k], got = err?.[k]
      const okk = want instanceof RegExp ? want.test(String(got)) : deepEq(want, got)
      if (!okk) fail(msg ?? `throws: error.${k} ${show(got)} !== ${show(want)}`)
    }
  }
}
export function doesNotThrow(fn, msg) { try { fn() } catch (e) { fail(msg ?? `doesNotThrow: threw ${e?.message ?? e}`) } }
export async function rejects(p, expected, msg) {
  let threw = false, err
  try { await (typeof p === 'function' ? p() : p) } catch (e) { threw = true; err = e }
  if (!threw) fail(msg ?? 'rejects: did not reject')
  if (expected) throws(() => { throw err }, expected, msg)
}
const assert = Object.assign(function assert(v, msg) { ok(v, msg) }, { deepStrictEqual, notDeepStrictEqual, strictEqual, notStrictEqual, equal, notEqual, ok, throws, doesNotThrow, rejects, AssertionError, deepEq })
export default assert
