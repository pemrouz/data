// shim/test.js — replaces `node:test` for the stripped conformance suite in the
// browser: test() only REGISTERS. A page runs `tests` itself (see smoke/).
export const tests = []
export function test(name, fn) { tests.push({ name, fn }) }
export default test
