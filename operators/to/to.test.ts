// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { spec } from '../../tests/spec.ts'
import { $, value } from '../../core.ts'
import { to } from './index.ts'

spec({ op:'to', guarantee:'Fidelity', trigger:'edit/overwrite', shape:'object', asserts:'the scalar projection re-derives on nested edit, whole-row replace and overwrite' }, async () => {
  const res = $({ a: { b: 1 } })
  const result = to(res, r => r.a.b * 10)
  const changes = result.connect([])
  res.a.b = 2
  res.a = { b: 3 }
  res[value] = { a: { b: 4 } }
  same(changes, [
    { type: 'update', key: [], value: 10 },
    { type: 'update', key: [], value: 20 },
    { type: 'update', key: [], value: 30 },
    { type: 'update', key: [], value: 40 },
  ])
  same(result[value], 40)
})

spec({ op:'to', guarantee:'Fidelity', trigger:'edit', shape:'object', asserts:'a projection of a sub-view re-derives on edits to that sub-view' }, async () => {
  const res = $({ a: { b: 1 } })
  const result = to(res.a, a => a.b * 100)
  const changes = result.connect([])
  res.a.b = 2
  res.a = { b: 3 }
  same(changes, [
    { type: 'update', key: [], value: 100 },
    { type: 'update', key: [], value: 200 },
    { type: 'update', key: [], value: 300 },
  ])
  same(result[value], 300)
})
