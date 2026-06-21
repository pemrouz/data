// Consumer-perspective NEGATIVE type-check fixture — the rejection half of the
// gate. Every `@ts-expect-error` below marks a pattern that MUST NOT type-check.
// tsc fails the gate two ways: a marked line that compiles clean reports TS2578
// ("Unused '@ts-expect-error' directive"), and an unmarked line that errors
// fails normally. So this file locks in the type surface's REJECTIONS — the half
// a purely-positive fixture (types/check.ts) can never guard, and the reason a
// type that silently widens to `any` would otherwise go unnoticed.
import { $, value } from '../full.ts'

const obj = $({ a: { n: 1 }, b: { n: 5 } })

// Read the raw underlying value with the `value` SYMBOL, never the string
// `.value` — `proxy.value` would mint a child view named "value". On a
// fixed-shape source the string access is a type error; keep it that way.
// @ts-expect-error — use proxy[value], not proxy.value
obj.value
void obj[value] // the correct symbol read compiles

// length(fn) buckets are `{ value: count }`: reading `counts[k]` AS a number is
// the documented `[object Object]`/`NaN` trap. It must NOT be a number.
const counts = obj.length(r => (r.n > 3 ? 'hi' : 'lo'))
// @ts-expect-error — read counts.hi.value, not counts.hi
const _trap: number = counts.hi
void _trap

// A predicate parameter is the real row type, not `any` — a bogus field errors.
// @ts-expect-error — `bogus` is not a field of the row
obj.filter(d => d.bogus > 3)

// `between` bounds are numeric (or reactive number VPs); string bounds rejected.
// @ts-expect-error — string is not a valid numeric bound
obj.between('n', ['a', 'b'])

// Mutation by assignment is type-checked against the child's value type.
const todos = $({ a: { done: false } })
// @ts-expect-error — a string is not assignable to a boolean field
todos.a.done = 'yes'

// --- DEFERRED negatives (become valid @ts-expect-error once the B-tier lands) ---
// Each of these COMPILES CLEAN today (the surface is loose there), so marking it
// now would itself fail as an unused directive. The owning B-tier commit both
// tightens the type AND moves the case up here under `@ts-expect-error`:
//   B1 (keyof column constraint):  obj.sum('nonexistent-col')      // unvalidated `string` col
//   B3 (filter value typing):      obj.filter('n', 'not-a-number') // value slot is `any`
//   reduce reactive-init guard:    obj.reduce((a, r) => a + r.n, $(0)) // init: R accepts a VP
