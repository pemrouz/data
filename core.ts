// @ts-nocheck
import { iter, isArray, noop } from './utils.ts'

export const value = Symbol('value')
export const reactive = Symbol.for('reactive')
export const view = Symbol('view')
const Symbols = { value, view }
const isObject = v => v.constructor === Object
const sclone = d =>
  d === undefined ? undefined
: d[view] ? d[view].value
: structuredClone(d)

export const Operators: Record<string, (...args: any[]) => any> = {}

export const $ = <T>(v: T) => new ViewProxy(View.value(v)) as Data<T>
export default $
$.random = (o) => crypto.randomUUID() as string | number

export function createOperator(source, OperatorClass, ...args) {
  const p = source[view]
  let op = p.some_sink(sink => sink instanceof OperatorClass && sink.matches?.(...args))
  if (!op) {
    op = new OperatorClass(p, ...args)
    p.sinks.add(new WeakRef(op))
  }
  return new ViewProxy(op.view)
}

type Prettify<T> = { [K in keyof T]: T[K] } & {};
type RowOf<T> = T extends Record<any, infer R> ? R : never
type Data<T = any> = { [k in keyof T]: Data<T[k]> } & {
  [value]?: T;
  connect([]): [];
  connect({}): {};
  connect(Function): Function
  update(value: T): undefined
  update(value, key: string[]): undefined
  insert(value: RowOf<T>): undefined
  insert(value, key: string[]): undefined
  remove(key?: string[]): undefined
  filter(arg: object): Data<T>
  filter(key: string, value: any): Data<T>
  filter(fn: (row: RowOf<T>) => boolean): Data<T>
  between(key: string, [lo, hi]: [number, number]): Data<T>
  to<R>(fn: (value: T) => R): Data<R>
  map<R>(fn: (row: RowOf<T>) => R): Data<Record<string, R>>
  length(): Data<number>
  length<R>(fn: (row: RowOf<T>) => R): Data<Record<R, number>>
  za(column: string, max?: number): Data<T>
  za(max?: number): Data<T>
  az(column: string, max?: number): Data<T>
  az(max?: number): Data<T>
  top(max?: number): Data<T>
  limit(max: number): Data<T>
  intersect(...sources: Data[]): Data<T>
  group<R>(fn: (value: RowOf<T>) => R): Data<Record<R, RowOf<T>>>
}

export class Value {
  constructor(){
    this.view = new View(this)
  }

  update(value, key) {
    if (value instanceof ViewProxy) throw new Error('cannot set value to another data, use a linked value instead')
    key.length === 0 ? this.XU0(value)
  : key.length === 1 ? this.BU1([key[0], value])
                     : this.BU2([key, value])
  }

  insert(value, key, at){
    if (value instanceof ViewProxy) throw new Error('cannot set value to another data, use a linked value instead')
    at = at === undefined ? at : `${at}`
    key.length === 0 ? this.BI0([at, value])
                     : this.BI2([key, value, at])
  }

  remove(key){
    key.length === 0 ? this.XR0()
  : key.length === 1 ? this.BR1([key[0]])
                     : this.BR2([key])
  }

  XR0() {
    if (this.view.value === undefined) return false
    const value = this.view.value
    this.view.value = undefined
    this.view.XR0(value)
  }

  BR1A(R1){
    const NR1 = []
    for (let i = 0; i < R1.length; i++) {
      const name = R1[i]
      const value = this.view.value?.[name]
      this.view.value.splice(name, 1)
      NR1.push(name)
      NR1.push(value)
    }
    this.view.BR1(NR1)
  }

  BR1(R1){
    if (isArray(this.view.value)) return this.BR1A(R1)
    const NR1 = []
    for (let i = 0; i < R1.length; i++) {
      const name = R1[i]
      const value = this.view.value?.[name]
      if (value === undefined) continue
      delete this.view.value[name]
      NR1.push(name)
      NR1.push(value)
    }
    this.view.BR1(NR1)
  }

  BR2(R2){
    const NR2 = []
    loop1: for (let i = 0; i < R2.length; i++) {
      const key = R2[i]
      const [last, ...path] = key.slice().reverse()
      let vo = this.view.value
      if (typeof vo !== 'object') return
      while (path.length) {
        const n = path.pop()
        if (typeof vo !== 'object') continue loop1
        vo = vo[n]
      }
      if (vo[last] === undefined) continue loop1
      const value = vo[last]
      if (isArray(vo)) {
        vo.splice(last, 1)
      } else {
        delete vo[last]
      }
      NR2.push(key, value)
    }
    this.view.BR2(NR2)
  }

  XU0(value) {
    if (this.view.value === value) return
    this.view.value = value
    this.view.XU0()
  }

  BU1(U1) {
    const NU1 = []
    const NI0 = []
    if (typeof this.view.value !== 'object') this.view.value = {}
    for (let i = 0; i < U1.length; i++) {
      const name = U1[i++]
      const value = U1[i]
      if (this.view.value?.[name] === value) continue
      this.view.value?.[name] === undefined
        ? NI0.push(name, value)
        : NU1.push(name, value)
      this.view.value[name] = value
    }
    this.view.BU1(NU1)
    this.view.BI0(NI0)
  }

  BU2(U2){
    if (typeof this.view.value !== 'object') this.view.value = {}
    for (let i = 0; i < U2.length; i++) {
      const key = U2[i++]
      const value = U2[i]
      const [last, ...path] = key.slice().reverse()
      let vo = this.view.value
      while (path.length) {
        const n = path.pop()
        vo = typeof vo[n] === 'object' ? vo[n] : (vo[n] = {})
      }
      if (vo[last] === value) continue
      vo[last] = value
    }
    this.view.BU2(U2)
  }

  BI0(I0){
    if (isArray(this.view.value)) return this.BI0A(I0)
    if (typeof this.view.value !== 'object') this.view.value = {}
    for (let i = 0; i < I0.length; i++) {
      const at = I0[i++] ??= ''+$.random(this.view.value)
      const value = I0[i]
      if (this.view.value?.[at] === value) continue
      this.view.value[at] = value
    }
    this.view.BI0(I0)
  }

  BI0A(I0){
    for (let i = 0; i < I0.length; i+=2) {
      const at = I0[i]
      const value = I0[i+1]
      if (at === undefined)
        I0[i] = ''+(this.view.value.push(value)-1)
      else
        this.view.value.splice(at, 0, value)
    }
    this.view.BI0(I0)
  }

  BI2(I2){
    if (typeof this.view.value !== 'object') this.view.value = {}
    for (let i = 0; i < I2.length; i++) {
      const key = I2[i++]
      const value = I2[i++]
      const path = key.slice().reverse()
      let vo = this.view.value

      while (path.length) {
        const n = path.pop()
        vo = typeof vo[n] === 'object' ? vo[n] : (vo[n] = {})
      }

      if (isArray(vo)) {
        if (I2[i] === undefined)
          I2[i] ??= ''+(vo.push(value)-1)
        else
          vo.splice(I2[i], 0, value)
      } else {
        const at = I2[i] ??= ''+$.random(vo)
        vo[at] = value
      }
    }
    this.view.BI2(I2)
  }
}

export class Operator extends Value {}

export class View {
  constructor(res){
    this.res = res
    this.key = []
    this.sinks = new Set
    this.views = new Map
  }

  static child(p, name){
    const view = new View(p.res)
    view.p = p
    view.key = [...p.key, name]
    view.name = name
    view.XU0(p.value?.[name])
    return view
  }

  static value(value) {
    if (value instanceof ViewProxy) {
      return new LinkedView(value)
    } else {
      const res = new Value
      res.XU0(value)
      return res.view
    }
  }

  XR0(value) {
    if (this.p) this.value = undefined
    this.each((name, child) => {
      if (child.value !== value?.[name] || child.value !== undefined)
        child.XR0(value?.[name])
    })
    this.sink(sink => sink.XR0(value, this))
  }

  BR1(R1) {
    if (!R1.length) return
    const arr = isArray(this.value)
    if (!arr) {
      for (let i = 0; i < R1.length; i+=2)
        this.get_named(R1[i])?.XR0(R1[i+1])
    } else if (this.views.size) {
      let offset = Infinity
      for (let i = 0; i < R1.length; i+=2) {
        if (R1[i] < offset) offset = R1[i]
        if (!offset) break
      }
      this.V1(offset)
    }
    for (const x of this.sinks) {
      const sink = x.deref()
      if (!sink) { this.sinks.delete(sink); continue }
      arr && sink.BR1A && sink.BR1A !== Value.prototype.BR1A
        ? sink.BR1A(R1, this)
        : sink.BR1(R1, this)
    }
  }

  BR2(R2){
    for (let i = 0; i < R2.length; i++) {
      const [name, ...rest] = R2[i++]
      const value = R2[i]
      rest.length === 1
        ? this.get_named(name)?.BR1([rest[0], value])
        : this.get_named(name)?.BR2([rest, value])
    }
    this.sink(sink => sink.BR2(R2, this))
  }

  XU0() {
    if (this.p) this.value = this.p.value?.[this.name]
    this.each((name, child) => {
      if (this.value?.[name] !== undefined)
        child.XU0()
      else {
        if (child.value !== undefined)
          child.XR0(child.value)
      }
    })
    this.sink(sink => sink.XU0(this.value, this))
  }

  BU1(U1) {
    if (!U1.length) return
    if (this.p) this.value = this.p.value?.[this.name]
    for (let i = 0; i < U1.length; i++) this.get_named(U1[i++])?.XU0()
    this.sink(sink => sink.BU1(U1, this))
  }

  BU2(U2){
    if (this.p) this.value = this.p.value?.[this.name]
    for (let i = 0; i < U2.length; i++) {
      const [name, ...rest] = U2[i++]
      const value = U2[i]
      rest.length === 1
        ? this.get_named(name)?.BU1([rest[0], value])
        : this.get_named(name)?.BU2([rest, value])
    }
    this.sink(sink => sink.BU2(U2, this))
  }

  BI0(I0) {
    if (!I0.length) return
    if (this.p) this.value = this.p.value?.[this.name]
    if (isArray(this.value)) return this.BI0A(I0)
    for (let i = 0; i < I0.length; i++) this.get_named(I0[i++])?.XU0()
    this.sink(sink => sink.BI0(I0, this))
  }

  BI0A(I0){
    if (this.views.size) {
      let offset = Infinity
      for (let i = 0; i < I0.length; i+=2) {
        if (I0[i] < offset) offset = I0[i]
      }
      this.V1(offset)
    }
    this.sink(sink => (sink.BI0A && sink.BI0A !== Value.prototype.BI0A)
      ? sink.BI0A(I0, this)
      : sink.BI0(I0, this))
  }

  BI2(I2){
    if (this.p) this.value = this.p.value?.[this.name]
    for (let i = 0; i < I2.length;) {
      const [name, ...rest] = I2[i++]
      const value = I2[i++]
      const at = I2[i++]
      rest.length
        ? this.get_named(name)?.BI2([rest, value, at])
        : this.get_named(name)?.BI0([at, value])
    }
    this.sink(sink => sink.BI2(I2, this))
  }

  V1(offset){
    for (let i = offset; i < this.value.length+1; i++) {
      const child = this.get_named(`${i}`)
      if (child && child.value !== this.value[i]) child.XU0()
    }
  }

  some_sink(fn) {
    let n
    for (const x of this.sinks) {
      const sink = x.deref?.()
      if (!sink) { this.sinks.delete(sink); continue }
      if (n = fn(x)) return n
    }
  }

  sink(fn){
    for (const x of this.sinks) {
      const sink = x.deref?.()
      if (!sink) { this.sinks.delete(sink); continue }
      fn(sink)
    }
  }

  each(fn){
    for (const [name, ref] of this.views) {
      const res = ref.deref?.()
      if (!res) { this.views.delete(name); continue }
      fn(name, res)
    }
  }

  get_or_create_named(name){
    return this.views.get(name)?.deref?.() ?? create(
      this.views,
      name,
      View.child(this, name)
    )
  }

  get_named(name){
    const res = this.views.get(name)?.deref?.()
    if (!res) this.views.delete(name)
    return res
  }

  disconnect(sink){
    for (const x of this.sinks) {
      const s = x.deref?.()
      if (s === sink) { this.sinks.delete(x); break }
      if (!s) { this.sinks.delete(x); continue }
    }
  }

  connect(sink){
    this.sinks.add(new WeakRef(sink))
  }
}

export class Sink {}

class LinkedView extends View {
  constructor(p){
    super()
    this.src = p[Symbols.view]
    this.update(this.src)
  }

  update(value, key = []){
    if (key.length) {
      return this.src.res.update(value, key)
    }

    if (value instanceof ViewProxy) value = value[Symbols.view]
    if (!(value instanceof View))
      throw new Error('cannot set linked value to non-reactive source')

    this.src.disconnect(this)
    this.src = value
    this.src.connect(this)
    this.XU0()
  }
  insert(...args){ return this.src.res.insert(...args) }
  remove(...args){ return this.src.res.remove(...args) }
  get value(){ return this.src.value }
  get res(){ return this }
  set res(v){ }
}

function iter2(arr, fn) {
  for (let i = 0; i < arr.length; i++) fn(arr[i++], arr[i])
}
function iter3(arr, fn) {
  for (let i = 0; i < arr.length; i++) fn(arr[i++], arr[i++], arr[i])
}

class ArrSink {
  constructor(p, arr){
    this.p = p
    this.arr = arr
    this.update([], p.value)
  }
  update = (key, value) => this.arr.push({ type: 'update', key, value: sclone(value) })
  remove = (key, value) => this.arr.push({ type: 'remove', key, value: sclone(value) })
  insert = (key, value, at) => this.arr.push({ type: 'insert', key, value: sclone(value), at })
  XU0(value){ this.update([], value) }
  BU1(U1){ iter2(U1, (name, value) => this.update([name], value)) }
  BU2(U2){ iter2(U2, (key, value) => this.update(key, value)) }
  BI0(I0){ iter2(I0, (at, value) => this.insert([], value, at)) }
  BI2(I0){ iter3(I0, (key, value, at) => this.insert(key, value, at)) }
  XR0(value){ this.remove([], value) }
  BR1(R1){ iter2(R1, (name, value) => this.remove([name], value)) }
  BR2(R2){ iter2(R2, (key, value) => this.remove(key, value)) }

  R0(value){ this.arr.push({ type: 'remove', key: [], value: sclone(value) }) }
  R1(name, value){ this.arr.push({ type: 'remove', key: [name], value: sclone(value) }) }
  R2(key, value){ this.arr.push({ type: 'remove', key, value: sclone(value) }) }
  U0(value){ this.arr.push({ type: 'update', key: [], value: sclone(value) }) }
  U1(name, value){ this.arr.push({ type: 'update', key: [name], value: sclone(value) }) }
  U2(key, value){ this.arr.push({ type: 'update', key, value: sclone(value) }) }
  I0(value, at){ this.arr.push({ type: 'insert', value: sclone(value), at }) }
  I1(name, value, at){ this.arr.push({ type: 'insert', key: [name], value: sclone(value), at }) }
  I2(key, value, at){ this.arr.push({ type: 'insert', key, value: sclone(value), at }) }
}

const lifetimes = new WeakMap

class PropSink extends Sink {
  p; obj; prop;
  constructor(p, obj, prop){
    super()
    this.p = p
    this.obj = obj
    this.prop = prop
    this.obj[prop] = p.value
    const refs = lifetimes.get(obj) ?? new Set
    refs.add(this)
    lifetimes.set(obj, refs)
  }
  XU0(value){ this.obj[this.prop] = value }
  XR0(){ this.XU0(this.p.value) }
  BU1(){ this.XU0(this.p.value) }
  BR1(){ this.XU0(this.p.value) }
  BI0(){ this.XU0(this.p.value) }
  BU2(){ this.XU0(this.p.value) }
  BR2(){ this.XU0(this.p.value) }
  BI2(){ this.XU0(this.p.value) }
}

class FunctionSink extends Sink {
  constructor(p, obj, fn){
    super()
    this.fn = fn
    fn({ type: 'update', key: [], value: sclone(p.value) })
  }
  XU0(value){ this.fn({ type: 'update', key: [], value: sclone(value) }) }
  XR0(value){ this.fn({ type: 'remove', key: [], value: sclone(value) }) }
  BU1(U1){ iter2(U1, (name, value) => this.fn({ type: 'update', key: [name], value: sclone(value) })) }
  BU2(U2){ iter2(U2, (key, value) => this.fn({ type: 'update', key, value: sclone(value) })) }
  BI0(I0){ iter2(I0, (at, value) => this.fn({ type: 'insert', key: [], value: sclone(value), at })) }
  BI2(I2){ iter3(I2, (key, value, at) => this.fn({ type: 'insert', key, value: sclone(value), at })) }
  BR1(R1){ iter2(R1, (name, value) => this.fn({ type: 'remove', key: [name], value: sclone(value) })) }
  BR2(R2){ iter2(R2, (key, value) => this.fn({ type: 'remove', key, value: sclone(value) })) }
}

export class ViewProxy {
  view;
  constructor(view){
    this.view = view
    return new Proxy(noop, this)
  }

  deleteProperty(target, name){
    const { res, key } = this.view
    const path = name === Symbols.value ? key : [...key, ''+name]
    res.remove(path)
    return true
  }

  set(t, name, value){
    const { res, key } = this.view
    const path = name === Symbols.value ? key : [...key, name]
    res.update(value, path)
    return true
  }

  get(t, name){
    if (name === Symbol.toPrimitive) return (hint) => hint
      ? this.view.value?.toString()
      : +this.view.value
    if (name === Symbol.iterator) return this.iterator
    if (name === Symbols.reactive) return true
    if (name === Symbols.view) return this.view
    if (name === Symbols.value) return this.view.value
    return new ViewProxy(this.view.get_or_create_named(name))
  }

  apply(t, m, args){
    const { p, name: type } = this.view
    if (!p) throw new Error('cannot invoke a root value!')
    if (type === 'connect') return connect(p, ...args)
    const OperatorClass = Operators[type]?.(...args)
    if (OperatorClass) {
      let sink = p.some_sink(sink => {
        if (sink instanceof OperatorClass)
          return sink.matches?.(...args)
      })
      if (!sink) {
        p.sinks.add(new WeakRef(sink = new OperatorClass(p, ...args)))
      }
      return new ViewProxy(sink.view)
    }

    const [value, at] = args
    if (type === 'remove') return this.view.res.remove(p.key)
    if (type === 'update') return this.view.res.update(value, p.key)
    if (type === 'insert') return this.view.res.insert(value, p.key, at)
  }

  getPrototypeOf(target){
    return ViewProxy.prototype
  }

  *iterator(i = 0) {
    while (true) {
      yield this[i++]
    }
  }
}

function create(views, name, res) {
  views.set(name, new WeakRef(res))
  return res
}

function connect(p, a, b) {
  if (isArray(a)) {
    const sink = new ArrSink(p, a)
    p.sinks.add(new WeakRef(sink))
    return a
  }

  if (typeof a === 'object' && typeof b === 'string') {
    const sink = new PropSink(p, a, b)
    p.sinks.add(new WeakRef(sink))
    return a
  }

  if (typeof a === 'object' && typeof b === 'function') {
    const sink = new FunctionSink(p, a, b)
    p.sinks.add(new WeakRef(sink))
    return a
  }

  p.sinks.add(new WeakRef(a))
  return a
}
