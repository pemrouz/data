// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { test } from 'node:test'
import { $, value } from '../../core.ts'
import { except } from './index.ts'

test('except - rows in source but not in other', () => {
  const a = $({ 1: 'a', 2: 'b', 3: 'c' })
  const b = $({ 2: 'b' })
  same(except(a, b)[value], { 1: 'a', 3: 'c' })
})

test('except - reactive: adding to `other` drops the row from output', () => {
  const a = $({ 1: 'a', 2: 'b' })
  const b = $({})
  const res = except(a, b)
  same(res[value], { 1: 'a', 2: 'b' })
  b[1] = 'a'
  same(res[value], { 2: 'b' })
})

test('except - reactive: removing from `other` re-admits the row', () => {
  const a = $({ 1: 'a', 2: 'b' })
  const b = $({ 1: 'a' })
  const res = except(a, b)
  same(res[value], { 2: 'b' })
  delete b[1]
  same(res[value], { 1: 'a', 2: 'b' })
})

test('except - reactive: removing from source drops from output', () => {
  const a = $({ 1: 'a', 2: 'b', 3: 'c' })
  const b = $({ 1: 'a' })
  const res = except(a, b)
  same(res[value], { 2: 'b', 3: 'c' })
  delete a[2]
  same(res[value], { 3: 'c' })
})

test('except - reactive: insert into source admits if not in other', () => {
  const a = $({ 1: 'a' })
  const b = $({ 9: 'z' })
  const res = except(a, b)
  same(res[value], { 1: 'a' })
  a[2] = 'b'
  same(res[value], { 1: 'a', 2: 'b' })
  a[9] = 'z'
  same(res[value], { 1: 'a', 2: 'b' })   // 9 is in `other`, so excluded
})
