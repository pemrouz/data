// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { spec } from '../../tests/spec.ts'
import { $, value } from '../../core.ts'
import { reverse } from './index.ts'

spec({ op:'reverse', guarantee:'Order', trigger:'construct', shape:'array', asserts:'an array\'s order is flipped' }, () => {
  const data = $(['a', 'b', 'c', 'd'])
  same(reverse(data)[value], ['d', 'c', 'b', 'a'])
})

spec({ op:'reverse', guarantee:'Order', trigger:'construct', shape:'object', asserts:'an object\'s values flip in iteration order' }, () => {
  const data = $({ x: 1, y: 2, z: 3 })
  same(reverse(data)[value], [3, 2, 1])
})

spec({ op:'reverse', guarantee:'Order', trigger:'insert', shape:'array', asserts:'an insert appears at the front of the reversed view' }, () => {
  const data = $(['a', 'b'])
  const r = reverse(data)
  same(r[value], ['b', 'a'])
  data.insert('c')
  same(r[value], ['c', 'b', 'a'])
})

spec({ op:'reverse', guarantee:'Order', trigger:'remove', shape:'array', asserts:'a remove drops the right row from the reversed view' }, () => {
  const data = $(['a', 'b', 'c'])
  const r = reverse(data)
  same(r[value], ['c', 'b', 'a'])
  delete data[0]
  same(r[value], ['c', 'b'])
})

spec({ op:'reverse', guarantee:'Robustness', trigger:'construct', shape:'array', asserts:'sparse undefined slots are filtered out' }, () => {
  const data = $(['a', undefined, 'c'])
  same(reverse(data)[value], ['c', 'a'])
})
