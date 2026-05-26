// @ts-nocheck
// Regression guard for the entry-point inversion (chore(release) era): the
// DEFAULT `data` entry (index.ts) must register every operator on import, so a
// consumer can `import { $ } from 'data'` and immediately chain `.filter(...)`
// WITHOUT also importing `data/full`. Before the inversion, bare `data` was the
// registration-free core and this chain threw — pointing users at `data/full`.
// node --test runs each file in its own process, so importing only ./index.ts
// here proves the standalone path: nothing else populates the Operators table.
import { deepStrictEqual as same, ok } from 'node:assert'
import { test } from 'node:test'
import { $, value, Operators } from './index.ts'

test('default entry registers operators on import', () => {
    // A representative spread across dispatch shapes, not the whole catalog.
    for (const name of ['filter', 'between', 'gt', 'map', 'length', 'sum', 'group', 'za'])
        ok(typeof Operators[name] === 'function', `Operators['${name}'] registered`)
})

test('default entry: chainable operators work without data/full', () => {
    const res = $([{ a: 1 }, { a: 5 }, { a: 9 }]).filter(d => d.a > 3).length()
    same(res[value], 2)
})
