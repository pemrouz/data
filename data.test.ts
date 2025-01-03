// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { $, value } from './data.ts'
import { test } from 'node:test'
const max = (a, b) => a > b ? a : b
$.random = o => 1 + Object
  .keys(o)
  .map(Number)
  .sort()
  .reduce(max, -1)

test('update (val, val)', () => {
    const res = $<number>(5)
    const changes = res.connect([])

    res[value] = 10
    res.update(20)

    same(changes, [
        { type: 'update', key: [], value: 5 },
        { type: 'update', key: [], value: 10 },
        { type: 'update', key: [], value: 20 },
    ])
    same(res[value], 20)
})

test('insert (val, val)', () => {
    const res = $(5)
    const changes1 = res.connect([])
    const changes2 = res[0].connect([])
    const changes3 = res[1].connect([])
    res.insert(10)
    res.insert(20)
    // console.log(" changes1",   changes1)
    // console.log(" changes2",   changes2)
    // console.log(" changes3",   changes3)
    // console.log(" res[value]",   res[value])
    // console.log(" res[0][value]",   res[0][value])
    // console.log(" res[1][value]",   res[1][value])
    // process.exit()
    same(changes1, [
        { type: 'update', key: [], value: 5 },
        { type: 'insert', key: [], value: 10, at: '0' },
        { type: 'insert', key: [], value: 20, at: '1' }
      ])
    same(changes2, [
        { type: 'update', key: [], value: undefined },
        { type: 'update', key: [], value: 10 }
    ])
    same(changes3, [
        { type: 'update', key: [], value: undefined },
        { type: 'update', key: [], value: 20 }
    ])
    same(res[value], { 0: 10, 1: 20 })
    same(res[0][value], 10)
    same(res[1][value], 20)
})

test('remove (val, val)', () => {
    const res = $<any>(5)
    const changes1 = res.connect([])
    const changes2 = res.a.connect([])
    delete res[value]
    delete res[value]
    // console.log("changes1", changes1)
    // console.log("changes2", changes2)
    // process.exit()
    same(changes1, [
      { type: 'update', key: [], value: 5 }
    , { type: 'remove', key: [], value: 5 }
    ])
    same(changes2, [
      { type: 'update', key: [], value: undefined }
    ])
    same(res[value], undefined)
})
  
  test('update (val, dir)', () => {
    const res = $<any>(5)
    const changes1 = res.connect([])
    const changes2 = res.a.connect([])
    res[value] = { a: 1 }
    res.a = 2
    // console.log("changes1", JSON.stringify(changes1))
    // console.log("changes2", JSON.stringify(changes2))
    // console.log("res[value]", JSON.stringify(res[value]))
    // process.exit()
    same(changes1, [
      { type: 'update', key: [], value: 5 }
    , { type: 'update', key: [], value: { a: 1 } }
    , { type: 'update', key: ['a'], value: 2 }
    ])
    same(changes2, [
      { type: 'update', key: [], value: undefined }
    , { type: 'update', key: [], value: 1 }
    , { type: 'update', key: [], value: 2 }
    ])
    same(res[value], { a: 2 })
    same(res.a[value], 2)
  })
  
  test('insert (val, dir)', () => {
    const res = $(5)
    const changes1 = res.connect([])
    const changes2 = res[0].connect([])
    const changes3 = res[0].a.connect([])
    res.insert({ a: 10 })
    // console.log("changes1", changes1)
    // console.log("changes2", changes2)
    // console.log("changes3", changes3)
    // console.log("res[value]", res[value])
    // console.log("res[0][value]", res[0][value])
    // console.log("res[0].a[value]", res[0].a[value])
    // process.exit()
    same(changes1, [
      { type: 'update', key: [], value: 5 },
      { type: 'insert', key: [], value: { a: 10 }, at: '0' }
    ])
    same(changes2, [
      { type: 'update', key: [], value: undefined },
      { type: 'update', key: [], value: { a: 10 } }
    ])
    same(changes3, [
      { type: 'update', key: [], value: undefined },
      { type: 'update', key: [], value: 10 }
    ])
    same(res[value], { 0: { a: 10 }})
    same(res[0][value], { a: 10 })
    same(res[0].a[value], 10)
  })
  
  test('remove (val, dir)', () => {
    const res = $(5)
    const changes1 = res.connect([])
    const changes2 = res.a.connect([])
    delete res.a
    delete res.a
    // console.log("changes1", changes1)
    // console.log("changes2", changes2)
    // console.log("res[value]", res[value])
    // process.exit()
    same(changes1, [
      { type: 'update', key: [], value: 5 },
    ])
    same(changes2, [
      { type: 'update', key: [], value: undefined },
    ])
  })

  
test('update (dir, dir)', () => {
    const obj = $({ a: 1, b: 2 })
    const arr = $([1, 2])
    const changes1 = obj.connect([])
    const changes2 = obj.a.connect([])
    const changes3 = obj.b.connect([])
    const changes4 = obj.c.connect([])
    const changes5 = arr.connect([])
    const changes6 = arr[0].connect([])
    const changes7 = arr[1].connect([])
    const changes8 = arr[2].connect([])
    obj[value] = { b: 3, c: 4 }
    arr[value] = [,3,4]
    // console.log("changes1", changes1)
    // console.log("changes2", changes2)
    // console.log("changes3", changes3)
    // console.log("changes4", changes4)
    // console.log("changes5", changes5)
    // console.log("changes6", changes6)
    // console.log("changes7", changes7)
    // console.log("changes8", changes8)
    // console.log("obj[value]", obj[value])
    // console.log("obj.a[value]", obj.a[value])
    // console.log("obj.b[value]", obj.b[value])
    // console.log("obj.c[value]", obj.c[value])
    // console.log("arr[value]", arr[value])
    // console.log("arr[0][value]", arr[0][value])
    // console.log("arr[1][value]", arr[1][value])
    // console.log("arr[2][value]", arr[2][value])
    // process.exit()
    same(changes1, [
      { type: 'update', key: [], value: { a: 1, b: 2 } },
      { type: 'update', key: [], value: { b: 3, c: 4 } }
    ])
    same(changes2, [ 
      { type: 'update', key: [], value: 1 }, 
      { type: 'remove', key: [], value: 1 } 
    ])
    same(changes3, [ 
      { type: 'update', key: [], value: 2 }, 
      { type: 'update', key: [], value: 3 } 
    ])
    same(changes4, [
      { type: 'update', key: [], value: undefined },
      { type: 'update', key: [], value: 4 }
    ])
    same(changes5, [
      { type: 'update', key: [], value: [ 1, 2 ] },
      { type: 'update', key: [], value: [ , 3, 4 ] }
    ])
    same(changes6, [ 
      { type: 'update', key: [], value: 1 }, 
      { type: 'remove', key: [], value: 1 } 
    ])
    same(changes7, [ 
      { type: 'update', key: [], value: 2 }, 
      { type: 'update', key: [], value: 3 } 
    ])
    same(changes8, [
      { type: 'update', key: [], value: undefined },
      { type: 'update', key: [], value: 4 }
    ])
    same(obj[value], { b: 3, c: 4 })
    same(obj.a[value], undefined)
    same(obj.b[value], 3)
    same(obj.c[value], 4)
    same(arr[value], [,3,4])
    same(arr[0][value], undefined)
    same(arr[1][value], 3)
    same(arr[2][value], 4)
  })
  
  test('insert (dir, dir)', () => {
    const res = $({ 10: 'a' })
    const changes1 = res.connect([])
    const changes2 = res[11].connect([])
    const changes3 = res[11].b.connect([])
    res.insert({ b: 10 })
    // console.log("changes1", changes1)
    // console.log("changes2", changes2)
    // console.log("changes3", changes3)
    // console.log("res[value]", res[value])
    // console.log("res[11][value]", res[11][value])
    // console.log("res[11].b[value]", res[11].b[value])
    // process.exit()
    same(changes1, [
      { type: 'update', key: [], value: { '10': 'a' } },
      { type: 'insert', key: [], value: { b: 10 }, at: '11' }
    ])
    same(changes2, [
      { type: 'update', key: [], value: undefined },
      { type: 'update', key: [], value: { b: 10 } }
    ])
    same(changes3, [
      { type: 'update', key: [], value: undefined },
      { type: 'update', key: [], value: 10 }
    ])
    same(res[value], { 10: 'a', 11: { b: 10 }})
    same(res[11][value], { b: 10 })
    same(res[11].b[value], 10)
  })
  
  test('remove (dir, dir)', () => {
    const res = $({ a: 1, b: 2 })
    const changes1 = res.connect([])
    const changes2 = res.a.connect([])
    const changes3 = res.b.connect([])
    const changes4 = res.C.connect([])
    delete res.a
    // console.log("changes1", changes1)
    // console.log("changes2", changes2)
    // console.log("changes3", changes3)
    // console.log("changes4", changes4)
    // console.log("res[value]", res[value])
    // console.log("res.a[value]", res.a[value])
    // console.log("res.b[value]", res.b[value])
    // process.exit()
    same(changes1, [
      { type: 'update', key: [], value: { a: 1, b: 2 } }
    , { type: 'remove', key: ['a'], value: 1 }
    ])
    same(changes2, [
      { type: 'update', key: [], value: 1 }
    , { type: 'remove', key: [], value: 1 }
    ])
    same(changes3, [
      { type: 'update', key: [], value: 2 }
    ])
    same(changes4, [
      { type: 'update', key: [], value: undefined }
    ])
    same(res[value], { b: 2 })
    same(res.a[value], undefined)
    same(res.b[value], 2)
  })
  
  test('update (dir, val)', () => {
    const res = $({ a: 1 })
    const changes1 = res.connect([])
    const changes2 = res.a.connect([])
    res[value] = 2
    // console.log("changes1", changes1)
    // console.log("changes2", changes2)
    // console.log("res[value]", res[value])
    // process.exit()
    same(changes1, [
      { type: 'update', key: [], value: { a: 1 } }
    , { type: 'update', key: [], value: 2 }
    ])
    same(changes2, [
      { type: 'update', key: [], value: 1 }
    , { type: 'remove', key: [], value: 1 }
    ])
    same(res[value], 2)
    same(res.a[value], undefined)
  })
  
  test('insert (dir, val)', () => {
    const obj = $({ 10: 'a' })
    const arr = $(['a'])
    const changes1 = obj.connect([])
    const changes2 = arr.connect([])
    const changes3 = obj[11].connect([])
    const changes4 = arr[1].connect([])
    obj.insert('b')
    arr.insert('b')
    // console.log("changes1", changes1)
    // console.log("changes2", changes2)
    // console.log("changes3", changes3)
    // console.log("changes4", changes4)
    // console.log("obj[value]", obj[value])
    // console.log("arr[value]", arr[value])
    // console.log("obj[11][value]", obj[11][value])
    // console.log("arr[1][value]", arr[1][value])
    // process.exit()
    same(changes1, [
      { type: 'update', key: [], value: { '10': 'a' } },
      { type: 'insert', key: [], value: 'b', at: '11' }
    ])
    same(changes2, [
      { type: 'update', key: [], value: ['a'] },
      { type: 'insert', key: [], value: 'b', at: '1' }
    ])
    same(changes3, [
      { type: 'update', key: [], value: undefined },
      { type: 'update', key: [], value: 'b' }
    ])
    same(changes4, [
      { type: 'update', key: [], value: undefined },
      { type: 'update', key: [], value: 'b' }
    ])
    same(obj[value], { 10: 'a', 11: 'b' })
    same(obj[11][value], 'b')
    same(arr[value], ['a', 'b'])
    same(arr[1][value], 'b')
  })
  
  test('remove (dir, val)', () => {
    const obj = $({ a: 1 })
    const arr = $([1])
    const changes1 = obj.connect([])
    const changes2 = arr.connect([])
    const changes3 = obj.a.connect([])
    const changes4 = arr[0].connect([])
    delete obj.a
    delete arr[0]
    // console.log("changes1", changes1)
    // console.log("changes2", changes2)
    // console.log("changes3", changes3)
    // console.log("changes4", changes4)
    // console.log("obj[value]", obj[value])
    // console.log("arr[value]", arr[value])
    // console.log("obj.a[value]", obj.a[value])
    // console.log("arr[0][value]", arr[0][value])
    // process.exit()
    same(changes1, [
      { type: 'update', key: [], value: { a: 1 } },
      { type: 'remove', key: [ 'a' ], value: 1 }
    ])
    same(changes2, [
      { type: 'update', key: [], value: [ 1 ] },
      { type: 'remove', key: [ '0' ], value: 1 }
    ])
    same(changes3, [ 
      { type: 'update', key: [], value: 1 }, 
      { type: 'remove', key: [], value: 1 } 
    ])
    same(changes4, [
      { type: 'update', key: [], value: 1 },
      { type: 'update', key: [], value: undefined }
    ])
    same(obj[value], {})
    same(arr[value], [])
    same(obj.a[value], undefined)
    same(arr[0][value], undefined)
  })
  
  test('update (val, dir/val)', () => {
    const res = $(5)
    const changes1 = res.connect([])
    const changes2 = res.a.connect([])
    res.a = 10 
    // console.log("changes1", changes1)
    // console.log("changes2", changes2)
    // console.log("res[value]", res[value])
    // console.log("res.a[value]", res.a[value])
    // process.exit()
    same(changes1, [
      { type: 'update', key: [], value: 5 }
    , { type: 'insert', key: [], value: 10, at: 'a' }
    ])
    same(changes2, [
      { type: 'update', key: [], value: undefined }
    , { type: 'update', key: [], value: 10 }
    ])
    same(res[value], { a: 10 })
    same(res.a[value], 10)
  })
  
  test('insert (val, dir/val)', () => {
    const res = $(5)
    const changes1 = res.connect([])
    const changes2 = res.a.connect([])
    const changes3 = res.a[0].connect([])
    res.a.insert(10)
    // console.log("changes1", changes1)
    // console.log("changes2", changes2)
    // console.log("changes3", changes3)
    // console.log("res[value]", res[value])
    // console.log("res.a[value]", res.a[value])
    // console.log("res.a[0][value]", res.a[0][value])
    // process.exit()
    same(changes1, [
      { type: 'update', key: [], value: 5 },
      { type: 'insert', key: ['a'], value: 10, at: '0' }
    ])
    same(changes2, [
      { type: 'update', key: [], value: undefined },
      { type: 'insert', key: [], value: 10, at: '0' }
    ])
    same(changes3, [
      { type: 'update', key: [], value: undefined },
      { type: 'update', key: [], value: 10 }
    ])
    same(res[value], { a: { 0: 10 }})
    same(res.a[value], { 0: 10 })
    same(res.a[0][value], 10)
  })
  
  test('update (dir, dir/val)', () => {
    const res = $({})
    const changes1 = res.connect([])
    const changes2 = res.a.connect([])
    res.a = 10
    // console.log("changes1", changes1)
    // console.log("changes2", changes2)
    // console.log("res[value]", res[value])
    // console.log("res.a[value]", res.a[value])
    // process.exit()
    same(changes1, [
      { type: 'update', key: [], value: {} }
    , { type: 'insert', key: [], value: 10, at: 'a' }
    ])
    same(changes2, [
      { type: 'update', key: [], value: undefined }
    , { type: 'update', key: [], value: 10 }
    ])
    same(res[value], { a: 10 })
    same(res.a[value], 10)
  })
  
  test('insert (dir, dir/val)', () => {
    const res = $({})
    const changes1 = res.connect([])
    const changes2 = res.a.connect([])
    const changes3 = res.a[0].connect([])
    res.a.insert(10)
    // console.log("changes1", changes1)
    // console.log("changes2", changes2)
    // console.log("changes3", changes3)
    // console.log("res[value]", res[value])
    // console.log("res.a[value]", res.a[value])
    // console.log("res.a[0][value]", res.a[0][value])
    // process.exit()
    same(changes1, [
      { type: 'update', key: [], value: {} },
      { type: 'insert', key: ['a'], value: 10, at: '0' }
    ])
    same(changes2, [
      { type: 'update', key: [], value: undefined },
      { type: 'insert', key: [], value: 10, at: '0' }
    ])
    same(changes3, [
      { type: 'update', key: [], value: undefined },
      { type: 'update', key: [], value: 10 }
    ])
    same(res[value], { a: { 0: 10 }})
    same(res.a[value], { 0: 10 })
    same(res.a[0][value], 10)
  })
  
  test('update (dir, dir/dir/val)', () => {
    const res = $()
    const changes1 = res.connect([])
    const changes2 = res.a.connect([])
    const changes3 = res.a.b.connect([])
    res.a.b = 10
    res.a.b = 20
    // console.log("changes1", changes1)
    // console.log("changes2", changes2)
    // console.log("changes3", changes3)
    // console.log("res[value]", res[value])
    // console.log("res.a[value]", res.a[value])
    // console.log("res.a.b[value]", res.a.b[value])
    // process.exit()
    same(changes1, [
      { type: 'update', key: [], value: undefined }
    , { type: 'update', key: ['a', 'b'], value: 10 }
    , { type: 'update', key: ['a', 'b'], value: 20 }
    ])
    same(changes2, [
      { type: 'update', key: [], value: undefined }
    , { type: 'update', key: ['b'], value: 10 }
    , { type: 'update', key: ['b'], value: 20 }
    ])
    same(changes3, [
      { type: 'update', key: [], value: undefined }
    , { type: 'update', key: [], value: 10 }
    , { type: 'update', key: [], value: 20 }
    ])
    same(res[value], { a: { b: 20 }})
    same(res.a[value], { b: 20 })
    same(res.a.b[value], 20)
  })
  
  test('insert (dir, dir/dir/val)', () => {
    const res = $()
    const changes1 = res.connect([])
    const changes2 = res.a.connect([])
    const changes3 = res.a.b.connect([])
    const changes4 = res.a.b[0].connect([])
    const changes5 = res.a.b[1].connect([])
    res.a.b.insert(10)
    res.a.b.insert(20)
    // console.log("changes1", changes1)
    // console.log("changes2", changes2)
    // console.log("changes3", changes3)
    // console.log("changes4", changes4)
    // console.log("changes5", changes5)
    // console.log("res[value]", res[value])
    // console.log("res.a[value]", res.a[value])
    // console.log("res.a.b[value]", res.a.b[value])
    // console.log("res.a.b[0][value]", res.a.b[0][value])
    // console.log("res.a.b[1][value]", res.a.b[1][value])
    // process.exit()
  
    same(changes1, [
      { type: 'update', key: [], value: undefined },
      { type: 'insert', key: ['a', 'b'], value: 10, at: '0' },
      { type: 'insert', key: ['a', 'b'], value: 20, at: '1' }
    ])
    same(changes2, [
      { type: 'update', key: [], value: undefined },
      { type: 'insert', key: ['b'], value: 10, at: '0' },
      { type: 'insert', key: ['b'], value: 20, at: '1' }
    ])
    same(changes3, [
      { type: 'update', key: [], value: undefined },
      { type: 'insert', key: [], value: 10, at: '0' },
      { type: 'insert', key: [], value: 20, at: '1' }
    ])
    same(changes4, [
      { type: 'update', key: [], value: undefined },
      { type: 'update', key: [], value: 10 }
    ])
    same(changes5, [
      { type: 'update', key: [], value: undefined },
      { type: 'update', key: [], value: 20 }
    ])
    same(res[value], { a: { b: { 0: 10, 1: 20 } }})
    same(res.a[value], { b: { 0: 10, 1: 20 } })
    same(res.a.b[value], { 0: 10, 1: 20 })
    same(res.a.b[0][value], 10)
    same(res.a.b[1][value], 20)
  })
  
  test('remove (dir, dir/dir/val)', () => {
    const res = $({ a: { b: 1 }})
    const changes1 = res.connect([])
    const changes2 = res.a.connect([])
    const changes3 = res.a.b.connect([])
    delete res.a.c
    delete res.a.b
    // console.log("changes1", changes1)
    // console.log("changes2", changes2)
    // console.log("changes3", changes3)
    // console.log("res[value]", res[value])
    // console.log("res.a[value]", res.a[value])
    // console.log("res.a.b[value]", res.a.b[value])
    // process.exit()
    same(changes1, [
      { type: 'update', key: [], value: { a: { b: 1 } } },
      { type: 'remove', key: ['a', 'b'], value: 1 },
    ])
    same(changes2, [
      { type: 'update', key: [], value: { b: 1 } },
      { type: 'remove', key: ['b'], value: 1 },
    ])
    same(changes3, [
      { type: 'update', key: [], value: 1 },
      { type: 'remove', key: [], value: 1 }
    ])
    same(res[value], { a: {}})
    same(res.a[value], {})
    same(res.a.b[value], undefined)
  })
  
  test('array indexing', () => {
    const res = $({ a: [1] })
    const changes1 = res.connect([])
    const changes2 = res.a.connect([])
    const changes3 = res.a[0].connect([])
    const changes4 = res.a[1].connect([])
    const changes5 = res.a[2].connect([])
    res.a.insert(3, 0)
    res.a.insert(2, 1)
    delete res.a[1]

    // console.log("changes1", changes1)
    // console.log("changes2", changes2)
    // console.log("changes3", changes3)
    // console.log("changes4", changes4)
    // console.log("changes5", changes5)
    // console.log("res[value]", res[value])
    // console.log("res[value].a", res[value].a)
    // console.log("res[value].a[0]", res[value].a[0])
    // console.log("res[value].a[1]", res[value].a[1])
    // console.log("res[value].a[2]", res[value].a[2])
    // process.exit()
  
    same(changes1, [
      { type: 'update', key: [], value: { a: [1] } },
      { type: 'insert', key: [ 'a' ], value: 3, at: '0' },
      { type: 'insert', key: [ 'a' ], value: 2, at: '1' },
      { type: 'remove', key: [ 'a', '1' ], value: 2 }
    ])
    same(changes2, [
      { type: 'update', key: [], value: [ 1 ] },
      { type: 'insert', key: [], value: 3, at: '0' },
      { type: 'insert', key: [], value: 2, at: '1' },
      { type: 'remove', key: [ '1' ], value: 2 }
    ])
    same(changes3, [ 
      { type: 'update', key: [], value: 1 },
      { type: 'update', key: [], value: 3 } 
    ])
    same(changes4, [
      { type: 'update', key: [], value: undefined },
      { type: 'update', key: [], value: 1 },
      { type: 'update', key: [], value: 2 },
      { type: 'update', key: [], value: 1 }
    ])
    same(changes5, [
      { type: 'update', key: [], value: undefined },
      { type: 'update', key: [], value: 1 },
      { type: 'update', key: [], value: undefined }
    ])
    same(res[value], { a: [ 3, 1 ] })
    same(res[value].a, [ 3, 1 ])
    same(res[value].a[0], 3)
    same(res[value].a[1], 1)
    same(res[value].a[2], undefined)
  })
  
  test('proxy/link', () => {
    const c = $({ a: 1 })
    const d = $({ b: 2 })
    const e = $(c)
    const changes1 = c.connect([])
    const changes2 = d.connect([])
    const changes3 = e.connect([])
    same(c[value], { a: 1 })
    same(d[value], { b: 2 })
    same(e[value], { a: 1 })

    e[value] = d
    c.x = 0
    same(c[value], { a: 1, x: 0 })
    same(d[value], { b: 2 })
    same(e[value], { b: 2 })

    e.f = 3
    same(c[value], { a: 1, x: 0 })
    same(d[value], { b: 2, f: 3 })
    same(e[value], { b: 2, f: 3 })

    d.g = 4
    same(c[value], { a: 1, x: 0 })
    same(d[value], { b: 2, f: 3, g: 4 })
    same(e[value], { b: 2, f: 3, g: 4 })

    delete d.g
    same(c[value], { a: 1, x: 0 })
    same(d[value], { b: 2, f: 3 })
    same(e[value], { b: 2, f: 3 })
    
    same(changes1, [
      { type: 'update', key: [], value: { a: 1 } },
      { type: 'insert', key: [], value: 0, at: 'x' }
    ])
    same(changes2, [
      { type: 'update', key: [], value: { b: 2 } },
      { type: 'insert', key: [], value: 3, at: 'f' },
      { type: 'insert', key: [], value: 4, at: 'g' },
      { type: 'remove', key: [ 'g' ], value: 4 }
    ])
    same(changes3, [
      { type: 'update', key: [], value: { a: 1 } },
      { type: 'update', key: [], value: { b: 2 } },
      { type: 'insert', key: [], value: 3, at: 'f' },
      { type: 'insert', key: [], value: 4, at: 'g' },
      { type: 'remove', key: [ 'g' ], value: 4 }
    ])
    // console.log(changes1)
    // console.log(changes2)
    // console.log(changes3)
    // process.exit()
  })
  
  // views
  // --------------------------------------
  test('to view', async () => {
    const res = $({ a: { b : 1 }})
    const to1 = res.to(r => r.a.b * 10)
    const to2 = res.a.to(a => a.b * 100)
    const to3 = res.a.b.to(b => b * 1000)
    const changes1 = to1.connect([])
    const changes2 = to2.connect([])
    const changes3 = to3.connect([])
    res.a.b = 2
    res.a = { b: 3 }
    res[value] = { a: { b: 4 }}
    same(changes1, [
      { type: 'update', key: [], value: 10 }
    , { type: 'update', key: [], value: 20 }
    , { type: 'update', key: [], value: 30 }
    , { type: 'update', key: [], value: 40 }
    ])
    same(changes2, [
      { type: 'update', key: [], value: 100 }
    , { type: 'update', key: [], value: 200 }
    , { type: 'update', key: [], value: 300 }
    , { type: 'update', key: [], value: 400 }
    ])
    same(changes3, [
      { type: 'update', key: [], value: 1000 }
    , { type: 'update', key: [], value: 2000 }
    , { type: 'update', key: [], value: 3000 }
    , { type: 'update', key: [], value: 4000 }
    ])
    same(to1[value], 40)
    same(to2[value], 400)
    same(to3[value], 4000)
  })

  // --------------------------------------
  test('map view', async () => {
    const res = $({ 
      0: { num: 1 },
      1: { num: 2 },
      2: { num: 3 },
    })
    const mapped = res.map(d => d.num * 10)
    const changes1 = mapped.connect([])
    
    // insert
    res[3] = { num: 4 } // I0
    res[2].insert(5, 'num') // I2

    //remove
    delete res[1].num // R2
    delete res[1] // R1
    delete res[value] // R1

    // update
    res[value] = { 0: { num: 6 }} // U0
    res[0] = { num: 7 } // U1
    res[0].num = 8 // U2

    // console.log(changes1)
    // console.log(mapped[value])
    // process.exit()
    same(changes1, [
      { type: 'update', key: [], value: { '0': 10, '1': 20, '2': 30 } },
      { type: 'insert', key: [], value: 40, at: '3' },
      { type: 'update', key: [ '2' ], value: 50 },
      { type: 'update', key: [ '1' ], value: NaN },
      { type: 'remove', key: [ '1' ], value: NaN },
      { type: 'remove', key: [], value: { '0': 10, '2': 50, '3': 40 } },
      { type: 'update', key: [], value: { '0': 60 } },
      { type: 'update', key: [ '0' ], value: 70 },
      { type: 'update', key: [ '0' ], value: 80 }
    ])
    same(mapped[value], { '0': 80 })
  })

  // --------------------------------------

  test('length', () => {
    const obj = $({ 10: 'a' })
    const arr = $(['a'])
    const count1 = obj.length()
    const count2 = arr.length()
    const changes1 = count1.connect([])
    const changes2 = count2.connect([])
    // insert
    obj.insert('b')
    arr.insert('b')
  
    // update
    obj[10] = 'c'
    arr[0] = 'c'
  
    // remove
    delete obj[10] 
    delete arr[0]
  
    // multi-update
    obj[value] = { a: 1, b: 2, c: 3, d: 4 }
    arr[value] = ['a', 'b', 'c', 'd']
  
    // multi-remove
    delete obj[value]
    delete arr[value]
    // console.log("changes1", changes1)
    // console.log("changes2", changes2)
    // console.log("count1[value]", count1[value])
    // console.log("count2[value]", count2[value])
  
    same(changes1, [
      { type: 'update', key: [], value: 1 },
      { type: 'update', key: [], value: 2 },
      { type: 'update', key: [], value: 1 },
      { type: 'update', key: [], value: 4 },
      { type: 'update', key: [], value: 0 }
    ])
    same(changes2, [
      { type: 'update', key: [], value: 1 },
      { type: 'update', key: [], value: 2 },
      { type: 'update', key: [], value: 1 },
      { type: 'update', key: [], value: 4 },
      { type: 'update', key: [], value: 0 }
    ])
    same(count1[value], 0)
    same(count2[value], 0)
  })
  
  // --------------------------------------
  function filter(tx){
    const res = $({ 
      10: { completed: true },
      20: { completed: false },
      30: { completed: true },
    })
    const filtered = tx(res) 
    const changes1 = filtered.connect([])
    
    // remove
    delete res[10].foo 
    delete res[10].completed
    delete res[20] 
    delete res[value]

    // update
    res[value] = { 
      10: { completed: true },
      20: { completed: false },
      30: { completed: true },
    }
    res[20].completed = true       // 0 -> 1
    res[20].completed = false      // 1 -> 0
    res[30] = { completed: false } // 1 -> 0
    res[30] = { completed: true }  // 0 -> 1
    
    // insert
    res[40] = { completed: true }
    res[50] = { completed: false }
  
    // console.log("changes1", changes1)
    // console.log("res[value]", filtered[value])
    // process.exit()
  
    same(changes1, [
      {
        type: 'update',
        key: [],
        value: { '10': { completed: true }, '30': { completed: true } }
      },
      { type: 'remove', key: [ '10' ], value: {} },
      { type: 'remove', key: [], value: { '30': { completed: true } } },
      {
        type: 'update',
        key: [],
        value: { '10': { completed: true }, '30': { completed: true } }
      },
      { type: 'insert', key: [], value: { completed: true }, at: '20' },
      { type: 'remove', key: [ '20' ], value: { completed: false } },
      { type: 'remove', key: [ '30' ], value: { completed: true } },
      { type: 'insert', key: [], value: { completed: true }, at: '30' },
      { type: 'insert', key: [], value: { completed: true }, at: '40' }
    ])
    same(filtered[value], {
      '10': { completed: true },
      '30': { completed: true },
      '40': { completed: true }
    })
  }

  test('filter - string', () => {
    filter(res => res.filter('completed', true))
  })

  test('filter - undefined', () => {
    filter(res => res.filter('completed'))
  })

  test('filter - array key', () => {
    filter(res => res.filter(['completed']))
  })

  test('filter - array key - undefined', () => {
    filter(res => res.filter(['completed'], undefined))
  })

  test('filter - function', () => {
    filter(res => res.filter(d => d.completed))
  })

  test('filter - object', () => {
    filter(res => res.filter({ completed: true }))
  })
  
  // --------------------------------------
  test('intersect', () => {
    const a = $({ 10: 'a', 20: 'b', 30: 'c' })
    const b = $({ 10: 'a', 20: 'b' })
    const res = a.intersect(b)
    const changes1 = res.connect([])
    // insert
    b[30] = 'x'
    a[40] = 'y'
  
    // update
    b[20] = 'd'
    a[20] = 'e'
    b[value] = { 20: 'g', 30: 'h' }
  
    // remove
    delete b[20] 
    delete b[value]
    // console.log("changes1", changes1)
    // console.log("res[value]", res[value])
  
    same(changes1, [
      { type: 'update', key: [], value: { 10: 'a', 20: 'b' } },
      { type: 'insert', key: [], value: 'c', at: '30' },
      { type: 'update', key: ['20'], value: 'e' },
      { type: 'update', key: [], value: { 20: 'e', 30: 'c' } },
      { type: 'remove', key: ['20'], value: 'e' },
      { type: 'update', key: [], value: {} }
    ])
    same(res[value], {})
  })
  
  test('intersect (arr)', () => {
    const a = $(['a', 'b', 'c'])
    const b = $(['a', 'b'])
    const res = a.intersect(b)
    const changes1 = res.connect([])
    // insert
    b[2] = 'x'
    a[3] = 'y'
  
    // update
    b[1] = 'd'
    a[1] = 'e'
    b[value] = [,'g','h']
  
    // remove
    delete b[1] 
    delete b[value]
    // console.log("res[value]", res[value])
    // console.log("changes1", JSON.stringify(changes1))
  
    same(changes1, [
      { type: 'update', key: [], value: ['a', 'b'] },
      { type: 'insert', key: [], value: 'c', at: '2' },
      { type: 'update', key: ['1'], value: 'e' },
      { type: 'update', key: [], value: ['a', 'e', 'c'] },
      { type: 'remove', key: ['1'], value: 'e' },
      { type: 'update', key: [], value: [] }
    ])
    same(res[value], [])
  })
  
  // --------------------------------------
  test('za', () => {
    const data = $({ 
      10: { fooo: 1, date: 1 }, 
      40: { fooo: 4, date: 4 }, 
      30: { fooo: 3, date: 3 }, 
      20: { fooo: 2, date: 2 }, 
      50: { fooo: 5, date: 5 }, 
    })
    const res = data.za('date', 3)
    const changes1 = res.connect([])
    const changes2 = res[0].connect([])
    const changes3 = res[1].connect([])
    const changes4 = res[2].connect([])
    const changes5 = res[3].connect([])
    same(res[value], [
      { fooo: 5, date: 5 },
      { fooo: 4, date: 4 },
      { fooo: 3, date: 3 },
    ])
  
    // insert
    // irrelevant > n
    data.insert({ fooo: 0, date: 0 })
    same(res[value], [
      { fooo: 5, date: 5 },
      { fooo: 4, date: 4 },
      { fooo: 3, date: 3 },
    ])
  
    // < n
    data.insert({ fooo: [], date: 6 })
    same(res[value], [
      { fooo: [], date: 6 },
      { fooo: 5, date: 5 },
      { fooo: 4, date: 4 },
    ])
    
    // < n + k
    data[52].fooo.insert(1)
    same(res[value], [
      { fooo: [1], date: 6 },
      { fooo: 5, date: 5 },
      { fooo: 4, date: 4 },
    ])
  
    // updates
    // root update
    data[value] = { 
      10: { fooo: 1, date: 1 }, 
      40: { fooo: 4, date: 4 }, 
      30: { fooo: 3, date: 3 }, 
      20: { fooo: 2, date: 2 }, 
      50: { fooo: 5, date: 5 }, 
    }
    same(res[value], [
      { fooo: 5, date: 5 },
      { fooo: 4, date: 4 },
      { fooo: 3, date: 3 },
    ])
    
    // U2: < n  
    data[40].fooo = 40 
    same(res[value], [
      { fooo: 5, date: 5 },
      { fooo: 40, date: 4 },
      { fooo: 3, date: 3 },
    ])
  
    // U2: > n
    data[10].fooo = 10 
    same(res[value], [
      { fooo: 5, date: 5 },
      { fooo: 40, date: 4 },
      { fooo: 3, date: 3 },
    ])
  
    // U1: oidx > n nidx < n
    data[10].date = 10 
    same(res[value], [
      { fooo: 10, date: 10 },
      { fooo: 5, date: 5 },
      { fooo: 40, date: 4 },
    ])
  
    // U1: oidx < n nidx < n
    data[10].date = 4  
    same(res[value], [
      { fooo: 5, date: 5 },
      { fooo: 40, date: 4 },
      { fooo: 10, date: 4 },
    ])
  
    // oidx < n nidx > n
    data[40].date = 0  
    same(res[value], [
      { fooo: 5, date: 5 },
      { fooo: 10, date: 4 },
      { fooo: 3, date: 3 },
    ])
  
    // root update
    data[value] = { 
      10: { fooo: 1, date: 1 }, 
      40: { fooo: 4, date: 4 }, 
      30: { fooo: 3, date: 3 }, 
      20: { fooo: 2, date: 2 }, 
      50: { fooo: 5, date: 5 }, 
    }
    same(res[value], [
      { fooo: 5, date: 5 },
      { fooo: 4, date: 4 },
      { fooo: 3, date: 3 },
    ])
  
    // remove
    // R2: < n  
    delete data[50].fooo 
    same(res[value], [
      { date: 5 },
      { fooo: 4, date: 4 },
      { fooo: 3, date: 3 },
    ])
  
    // R2: > n
    delete data[10].fooo 
    same(res[value], [
      { date: 5 },
      { fooo: 4, date: 4 },
      { fooo: 3, date: 3 },
    ])
  
    // R1: > n
    delete data[20] 
    same(res[value], [
      { date: 5 },
      { fooo: 4, date: 4 },
      { fooo: 3, date: 3 },
    ])
  
    // R1: < n
    delete data[40]
    same(res[value], [
      { date: 5 },
      { fooo: 3, date: 3 },
      { date: 1 },
    ])
  
    // R0
    delete data[value] 
    same(res[value], [])
    // console.log("changes1", JSON.stringify(changes1))
    // console.log("changes1", changes1)
    // console.log("changes2", changes2)
    // console.log("changes3", changes3)
    // console.log("changes4", changes4)
    // console.log("changes5", changes5)
    // console.log("res[value]", res[value])
  
    same(changes1, [
      { type: 'update', key: [], value: [ 
        { fooo: 5, date: 5 },
        { fooo: 4, date: 4 },
        { fooo: 3, date: 3 },
      ] },
      { type: 'remove', key: [ 2 ], value: { fooo: 3, date: 3 } },
      { type: 'insert', key: [], value: { fooo: [], date: 6 }, at: 0 },
      { type: 'insert', key: [ '0', 'fooo' ], value: 1, at: '0' },
      { type: 'update', key: [], value: [ 
        { fooo: 5, date: 5 },
        { fooo: 4, date: 4 },
        { fooo: 3, date: 3 },
      ] },
      { type: 'update', key: [ '1', 'fooo' ], value: 40 },
      { type: 'remove', key: [ 2 ], value: { fooo: 3, date: 3 } },
      { type: 'insert', key: [], value: { fooo: 10, date: 10 }, at: 0 },
      { type: 'update', key: [ '0' ], value: { fooo: 5, date: 5 } },
      { type: 'update', key: [ '1' ], value: { fooo: 40, date: 4 } },
      { type: 'update', key: [ '2' ], value: { fooo: 10, date: 4 } },
      { type: 'remove', key: [ 1 ], value: { fooo: 40, date: 0 } },
      { type: 'insert', key: [], value: { fooo: 3, date: 3 }, at: 2 },
      { type: 'update', key: [], value: [ 
        { fooo: 5, date: 5 },
        { fooo: 4, date: 4 },
        { fooo: 3, date: 3 },
      ] },
      { type: 'remove', key: [ '0', 'fooo' ], value: 5 },
      { type: 'remove', key: [ 1 ], value: { fooo: 4, date: 4 } },
      { type: 'insert', key: [], value: { date: 1 }, at: 2 },
      { type: 'update', key: [], value: [] }
    ])
    same(changes2, [
      { type: 'update', key: [], value: { fooo: 5, date: 5 } },
      { type: 'update', key: [], value: { fooo: [], date: 6 } },
      { type: 'insert', key: [ 'fooo' ], value: 1, at: '0' },
      { type: 'update', key: [], value: { fooo: 5, date: 5 } },
      { type: 'update', key: [], value: { fooo: 10, date: 10 } },
      { type: 'update', key: [], value: { fooo: 5, date: 5 } },
      { type: 'update', key: [], value: { fooo: 5, date: 5 } },
      { type: 'remove', key: [ 'fooo' ], value: 5 },
      { type: 'remove', key: [], value: { date: 5 } }
    ])
    same(changes3, [
      { type: 'update', key: [], value: { fooo: 4, date: 4 } },
      { type: 'update', key: [], value: { fooo: 5, date: 5 } },
      { type: 'update', key: [], value: { fooo: 4, date: 4 } },
      { type: 'update', key: [ 'fooo' ], value: 40 },
      { type: 'update', key: [], value: { fooo: 5, date: 5 } },
      { type: 'update', key: [], value: { fooo: 40, date: 4 } },
      { type: 'update', key: [], value: { fooo: 10, date: 4 } },
      { type: 'update', key: [], value: { fooo: 4, date: 4 } },
      { type: 'update', key: [], value: { fooo: 3, date: 3 } },
      { type: 'remove', key: [], value: { fooo: 3, date: 3 } }
    ])
    same(changes4, [
      { type: 'update', key: [], value: { fooo: 3, date: 3 } },
      { type: 'update', key: [], value: undefined },
      { type: 'update', key: [], value: { fooo: 4, date: 4 } },
      { type: 'update', key: [], value: { fooo: 3, date: 3 } },
      { type: 'update', key: [], value: undefined },
      { type: 'update', key: [], value: { fooo: 40, date: 4 } },
      { type: 'update', key: [], value: { fooo: 10, date: 4 } },
      { type: 'update', key: [], value: undefined },
      { type: 'update', key: [], value: { fooo: 3, date: 3 } },
      { type: 'update', key: [], value: { fooo: 3, date: 3 } },
      { type: 'update', key: [], value: undefined },
      { type: 'update', key: [], value: { date: 1 } },
      { type: 'remove', key: [], value: { date: 1 } }
    ])
    same(changes5, [ { type: 'update', key: [], value: undefined } ])
  })
  
  // --------------------------------------
  // between
  test('between - variable', async () => {
    const all = $({ 
      1: { num: 90 }
    , 2: { num: 10 }
    , 3: { num: 50 }
    })
    const filters = $({ lo: 20, hi: 80 })
    const filtered = all.between('num', [filters.lo, filters.hi])
    const changes1 = filtered.connect([])
    filters.lo = 5
    filters.hi = 6
    filters.hi = 100
    filters.lo = 99
    filters.lo = 100
    // console.log("changes1", changes1)
    // console.log("filtered[value]", filtered[value])
    // process.exit()
    // TODO: maybe make atomic
    same(changes1, [
      // init
      { type: 'update', key: [], value: { '3': { num: 50 } } },
      // lo 5
      { type: 'insert', value: { num: 10 }, key: [], at:  '2' },
      // hi 5
      { type: 'remove', value: { num: 50 }, key: [ '3' ] },
      { type: 'remove', value: { num: 10 }, key: [ '2' ] },
      // hi 100
      { type: 'insert', value: { num: 10 }, key: [], at: '2' },
      { type: 'insert', value: { num: 50 }, key: [], at: '3' },
      { type: 'insert', value: { num: 90 }, key: [], at: '1' },
      // lo 100
      { type: 'remove', value: { num: 10 }, key: [ '2' ] },
      { type: 'remove', value: { num: 50 }, key: [ '3' ] },
      { type: 'remove', value: { num: 90 }, key: [ '1' ] },
      // R0
      { type: 'update', value: {}, key: [] },
    ])
  })
  
  // --------------------------------------
  // length fn
  test('length fn', () => {
    const res = $({ 
      1: { num: 1.1 }
    , 2: { num: 2.2 }
    , 3: { num: 1.9 }
    , 4: { num: 2.6 }
    , 5: { num: 1.7 }
    })
    const lengths = res.length(d => Math.floor(d.num))
    const changes1 = lengths.connect([])

    res.insert({ num: 1.8 })
    res[5] = { num: 1.8 } // same group
    res[5] = { num: 2.1 } // change group
    res[9] = { num: 2.1 } // new value
    res[9].foo = 'bar'    // deep update
    delete res[3]
    delete res[value]
    // console.log("changes1", JSON.stringify(changes1), undefined, 4)
    // console.log("lengths[value]", lengths[value])
    // process.exit()
    same(changes1, [
        { type: 'update', key: [], value: { '1': { value: 3 }, '2': { value: 2 } } },
        { type: 'update', key: [], value: { '1': { value: 4 }, '2': { value: 2 } } },
        { type: 'update', key: [], value: { '1': { value: 4 }, '2': { value: 2 } } },
        { type: 'update', key: [], value: { '1': { value: 3 }, '2': { value: 3 } } },
        { type: 'update', key: [], value: { '1': { value: 3 }, '2': { value: 4 } } },
        { type: 'update', key: [], value: { '1': { value: 2 }, '2': { value: 4 } } },
        { type: 'update', key: [], value: {} }
      ])  
    // same(changes1, [
    //   { type: 'update', key: [], value: { '1': { value: 3 }, '2': { value: 2 } } },
    //   { type: 'update', key: [ '1' ], value: 4 },
    //   { type: 'update', key: [ '1' ], value: 3 },
    //   { type: 'update', key: [ '2' ], value: 3 },
    //   { type: 'update', key: [ '2' ], value: 4 },
    //   { type: 'update', key: [ '1' ], value: 2 },
    //   { type: 'update', key: [], value: {} }
    // ])
    same(lengths[value], {})
  })
  
  // --------------------------------------
  // group
  test('group (obj)', () => {
    const res = $({ 
      1: { num: 1.1 }
    , 2: { num: 2.2 }
    , 3: { num: 1.9 }
    , 4: { num: 2.6 }
    , 5: { num: 1.7 }
    })
    const grouped = res.group(d => Math.floor(d.num))
    const changes1 = grouped.connect([])
    res.insert({ num: 1.8 }) // insert existing group
    res.insert({ num: 5.9 }) // insert new group
    res[5] = { num: 1.8 }    // move to same group
    res[5] = { num: 2.1 }    // move to different group
    res[7] = { num: 1.0 }    // move last in group
    res[8] = { num: 4.1 }    // update-insert new group
    delete res[2]            // delete within in group
    delete res[8]            // delete last in group           
    delete res[value]
    // console.log("changes1", changes1)
    // console.log("grouped[value]", grouped[value])
    // process.exit()
    same(changes1, [
      { type: 'update', key: [], value: { 
        1: { 1: { num: 1.1 }, 3: { num: 1.9 }, 5: { num: 1.7 } },
        2: { 2: { num: 2.2 }, 4: { num: 2.6 } }
      } },
      { type: 'insert', key: [ 1 ], value: { num: 1.8 }, at: '6' },
      { type: 'insert', key: [ 5 ], value: { num: 5.9 }, at: '7' },
      { type: 'update', key: [ 1, '5' ], value: { num: 1.8 } },
      { type: 'remove', key: [ 1, '5' ], value: { num: 1.8 } },
      { type: 'insert', key: [ 2 ], value: { num: 2.1 }, at: '5' },
      { type: 'remove', key: [ 5 ], value: {} },
      { type: 'remove', key: [ 5, '7' ], value: { num: 5.9 } },
      { type: 'insert', key: [ 1 ], value: { num: 1 }, at: '7' },
      { type: 'insert', key: [ 4 ], value: { num: 4.1 }, at: '8' },
      { type: 'remove', key: [ 2, '2' ], value: { num: 2.2 } },
      { type: 'remove', key: [ 4 ], value: {} },
      { type: 'remove', key: [ 4, '8' ], value: { num: 4.1 } },
      { type: 'update', key: [], value: {} }
    ])
    same(grouped[value], {})
  })

  // test('group (arr)', () => {
  //   const res = $([
  //     { num: 1.1 },
  //     { num: 2.2 },
  //     { num: 1.9 },
  //     { num: 2.6 },
  //     { num: 1.7 },
  //   ])
  //   const grouped = res.group(d => Math.floor(d.num))
  //   const changes1 = grouped.connect([])
  //   res.insert({ num: 1.8 }) // insert at end
  //   res.insert({ num: 1.0 }, 2) // insert in middle
  //   // res.insert({ num: 5.9 }) // insert new group
  //   // res[5] = { num: 1.7 }    // move in same group
  //   // res[5] = { num: 2.1 }    // move to different group
  //   // res[7] = { num: 1.0 }    // move last in group
  //   // res[8] = { num: 4.1 }    // update-insert new group
  //   // delete res[2]            // delete within in group
  //   // delete res[7]            // delete last in group           
  //   console.log(res[value])
  //   // delete res[value]
  //   console.log("changes1", changes1)
  //   console.log("grouped[value]", grouped[value])
  //   process.exit()
  //   same(changes1, [
  //     { type: 'update', key: [], value: { 
  //       1: { 0: { num: 1.1 }, 2: { num: 1.9 }, 4: { num: 1.7 } },
  //       2: { 1: { num: 2.2 }, 3: { num: 2.6 } }
  //     } },
  //     { type: 'insert', key: [ 1 ], value: { num: 1.8 }, at: '5' },
  //     { type: 'insert', key: [ 1 ], value: { num: 1 }, at: '2' },
  //     { type: 'insert', key: [ 5 ], value: { num: 5.9 }, at: '7' },
  //     { type: 'update', key: [ 1, '5' ], value: { num: 1.7 } },
  //     { type: 'remove', key: [ 1, '5' ], value: { num: 1.7 } },
  //     { type: 'insert', key: [ 2 ], value: { num: 2.1 }, at: '5' },
  //     { type: 'remove', key: [ 5 ], value: {} },
  //     { type: 'remove', key: [ 5, '7' ], value: { num: 5.9 } },
  //     { type: 'insert', key: [ 1 ], value: { num: 1 }, at: '7' },
  //     { type: 'insert', key: [ 4 ], value: { num: 4.1 }, at: '8' },
  //     { type: 'remove', key: [ 1, '2' ], value: { num: 1 } },
  //     { type: 'remove', key: [ 4 ], value: {} },
  //     { type: 'remove', key: [ 4, '8' ], value: { num: 4.1 } },
  //     { type: 'update', key: [], value: {} }
  //   ])
  //   same(grouped[value], {})
  // })

  // // --------------------------------------
  // // limit
  // test('limit', () => {
  //   const res = $({ 
  //     1: 2.1
  //   , 2: 1.1
  //   // , 3: undefined
  //   , 4: 3.1
  //   , 5: 4.1
  //   , 6: 0.1
  //   })
  //   const limited = res.limit(3)
  //   const changes1 = limited.connect([])

  //   //// res[2] = undefined // update undefined before n
  //   //// res[5] = undefined // update undefined after n
  //   res[2] = 5.1       // update before n (existing)
  //   // // res[3] = 8.1       // update before n (new)
  //   res[5] = 6.1       // update after n
  //   // //// delete res[3]      // delete undefined before n
  //   // //// delete res[6]      // delete undefined after n
  //   delete res[2]      // delete before n
  //   delete res[6]      // delete after n
  //   // //// res[3] = undefined // insert undefined before n
  //   // //// res[5] = undefined // insert undefined after n
  //   res[2] = 7.1       // insert before n
  //   res[6] = 0.1       // insert after n

  //   // // delete when size < n
  //   delete res[1]
  //   delete res[2]
  //   delete res[4]
  //   delete res[5]
  //   delete res[6]
  //   // insert when size < n
  //   res[1] = 'A'
  //   res[2] = 'B'
  //   res[4] = 'C'
  //   res[5] = 'D'

  //   // console.log("changes1", changes1)
  //   // console.log("limited[value]", limited[value])
  //   // process.exit()
  //   same(changes1, [
  //     { type: 'update', key: [], value: [ 2.1, 1.1, 3.1 ] },
  //     { type: 'update', key: [ 1 ], value: 5.1 },
  //     { type: 'remove', key: [ 1 ], value: 5.1 },
  //     { type: 'insert', key: [], value: 6.1, at: 2 },
  //     { type: 'insert', key: [], value: 7.1, at: 1 },
  //     { type: 'remove', key: [ 3 ], value: 6.1 },
  //     { type: 'remove', key: [ 0 ], value: 2.1 },
  //     { type: 'insert', key: [], value: 6.1, at: 2 },
  //     { type: 'remove', key: [ 0 ], value: 7.1 },
  //     { type: 'insert', key: [], value: 0.1, at: 2 },
  //     { type: 'remove', key: [ 0 ], value: 3.1 },
  //     { type: 'remove', key: [ 0 ], value: 6.1 },
  //     { type: 'remove', key: [ 0 ], value: 0.1 },
  //     { type: 'insert', key: [], value: 'A', at: 0 },
  //     { type: 'insert', key: [], value: 'B', at: 1 },
  //     { type: 'insert', key: [], value: 'C', at: 2 }
  //   ])
  //   same(limited[value], [ 'A', 'B', 'C' ])
  // })

  // --------------------------------------
  // iterator
  test.only('iterator', async () => {
    const res = $([1, 2])
    const [one, two, three] = res
    const changes1 = one.connect([])
    const changes2 = two.connect([])
    const changes3 = three.connect([])
    same(one[value], 1)
    same(two[value], 2)
    same(three[value], undefined)
  
    res.insert(3)
    same(one[value], 1)
    same(two[value], 2)
    same(three[value], 3)
  
    res[1] = 4
    same(one[value], 1)
    same(two[value], 4)
    same(three[value], 3)
  
    delete res[1]
    same(one[value], 1)
    same(two[value], 3)
    same(three[value], undefined)
  
    same(changes1, [
      { type: 'update', value: 1, key: [] }
    ])
    same(changes2, [
      { type: 'update', value: 2, key: [] },
      { type: 'update', value: 4, key: [] },
      { type: 'update', value: 3, key: [] }
    ])
    same(changes3, [
      { type: 'update', value: undefined, key: [] },
      { type: 'update', value: 3, key: [] },
      { type: 'update', value: undefined, key: [] }
    ])
  })

  // test('iterator - for const', async () => {
  //   const arr = $([1, 2])
  //   const arr_values = []
  //   for (const value of arr) {
  //     arr_values.push(+value)
  //   }
  //   same(arr_values, [1, 2])

  //   const obj = $({ a: 1, b: 2 })
  //   const obj_values = []
  //   for (const value of obj) {
  //     obj_values.push(+value)
  //   }
  //   same(obj_values, [1, 2])
  // })