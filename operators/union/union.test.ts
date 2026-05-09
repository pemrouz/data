// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { test } from 'node:test'
import { $, value } from '../../core.ts'
import { union } from './index.ts'

test('union - rows in any source', () => {
  const a = $({ 1: 'a', 2: 'b' })
  const b = $({ 2: 'b', 3: 'c' })
  const res = union(a, b)
  same(res[value], { 1: 'a', 2: 'b', 3: 'c' })
})

test('union - value comes from first source containing the row', () => {
  // Both a and b have key 2, but with different values. union picks a's.
  const a = $({ 1: 'a1', 2: 'a2' })
  const b = $({ 2: 'b2', 3: 'b3' })
  const res = union(a, b)
  same(res[value], { 1: 'a1', 2: 'a2', 3: 'b3' })
})

test('union - reactive: insert in secondary appears in output', () => {
  const a = $({ 1: 'a' })
  const b = $({ 2: 'b' })
  const res = union(a, b)
  same(res[value], { 1: 'a', 2: 'b' })
  b[3] = 'c'
  same(res[value], { 1: 'a', 2: 'b', 3: 'c' })
})

test('union - reactive: removing from one source keeps row if another has it', () => {
  const a = $({ 1: 'x' })
  const b = $({ 1: 'y' })
  const res = union(a, b)
  same(res[value], { 1: 'x' })   // a wins
  delete a[1]
  same(res[value], { 1: 'y' })   // a gone, b still has it — value flips to 'y'
  delete b[1]
  same(res[value], {})
})
