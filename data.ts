// @ts-nocheck
export const value = Symbol('value')
export const reactive = Symbol.for('reactive')
export const $ = <T>(v:T) => new ViewProxy(View.value(v)) as Data<T> // as unknown as Data<any>
export default $
export const view = Symbol('view')
import { iter, isArray, noop } from './utils.ts'
const isObject = v => v.constructor === Object
const Symbols = { value, view }
const str = JSON.stringify
$.random = (o) => crypto.randomUUID() as string | number
const sclone = d => 
  d === undefined ? undefined 
: d[view] ? d[view].value
: structuredClone(d)

type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};
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

class Value { 
  constructor(){
    this.view = new View(this)
    // this.links = new Map;
  }

  update(value, key) {
    if (value instanceof ViewProxy) throw new Error('cannot set value to another data, use a linked value instead')
    key.length === 0 ? this.XU0(value) // this.XU0(value)
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
      if (value === undefined) continue // return false
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
    this.view.value = value // this.link(value)
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
    // console.log('R :>> ', { NU1, NI0 });
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
      vo[last] = value // this.link(key, value)
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
      this.view.value[at] = value // link
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
          vo.splice(I2[i], 0, value) // vo[at] = this.link([at], value)
      } else {
        const at = I2[i] ??= ''+$.random(vo)
        vo[at] = value // this.link(nkey, value)
      }  
    }
    this.view.BI2(I2)
  }

  // link(value){
  //   if (value instanceof ViewProxy) {
  //     value.connect(this)
  //     this.XU0(value[Symbols.value])
  //   } else {
  //     this.XU0(value)
  //   }
  // }
}

class Operator extends Value {
  // XUO(){ throw new Error('not implemented (XUO):', this.name) }
  // BU1(){ throw new Error('not implemented (BU1):', this.name) }
  // BU2(){ throw new Error('not implemented (BU2):', this.name) }
  // XRO(){ throw new Error('not implemented (XRO):', this.name) }
  // BR1(){ throw new Error('not implemented (BR1):', this.name) }
  // BR2(){ throw new Error('not implemented (BR2):', this.name) }
  // BI0(){ throw new Error('not implemented (BI0):', this.name) }
  // BI2(){ throw new Error('not implemented (BI2):', this.name) }
  // BR1A(){ throw new Error('not implemented (BR1A):', this.name) }
  // BI0A(){ throw new Error('not implemented (BI0A):', this.name) }
}

class View {
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
    if (!isArray(this.value)) {
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
    // this.sink(sink => sink.BR1(R1, this))
    for (const x of this.sinks) {
      const sink = x.deref()
      if (!sink) { this.sinks.delete(sink); continue }
      sink.BR1(R1, this)
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
    this.sink(sink => sink.BI0(I0, this))
  }

  BI2(I2){ 
    if (this.p) this.value = this.p.value?.[this.name]
    // console.log({ I2 })
    for (let i = 0; i < I2.length;) {
      const [name, ...rest] = I2[i++]
      const value = I2[i++]
      const at = I2[i++]
      // console.log({ name, rest, value, at })
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
      if (!sink) { /* console.log('delete') */ this.sinks.delete(sink); continue }
      if (n = fn(x)) return n
    }
  }

  sink(fn){
    for (const x of this.sinks) {
      const sink = x.deref?.()
      if (!sink) { /* console.log('delete') */ this.sinks.delete(sink); continue }
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
    this.XU0(this.src.value)
  }
  insert(...args){ return this.src.res.insert(...args) }
  remove(...args){ return this.src.res.remove(...args) }
  XU0(U0){ this.sink(sink => sink.XU0(U0, this)) }
  BU1(U1){ this.sink(sink => sink.BU1(U1, this)) }
  BU2(U2){ this.sink(sink => sink.BU2(U2, this)) }
  XR0(R0){ this.sink(sink => sink.XR0(R0, this)) }
  BR1(R1){ this.sink(sink => sink.BR1(R1, this)) }
  BR2(R2){ this.sink(sink => sink.BR2(R2, this)) }
  BI0(I0){ this.sink(sink => sink.BI0(I0, this)) }
  BI2(I2){ this.sink(sink => sink.BI2(I2, this)) }
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

  // bulk(records){
  //   console.log("records", records)
  //   if (R.R0) { C.R0 = []; for (let i = 0; i < R.R0.length; i++) this.R0(C, view) }
  //   if (R.R1) { C.R1 = []; for (let i = 0; i < R.R1.length; i+=2) this.R1(C, R.R1[i], R.R1[i+1], view) }
  //   if (R.R2) { C.R2 = []; for (let i = 0; i < R.R2.length; i++) this.R2(C, R.R2[i], view) }
  //   if (R.U0) { C.U0 = []; for (let i = 0; i < R.U0.length; i++) this.U0(C, R.U0[i], view) }
  //   if (R.U1) { C.U1 = []; for (let i = 0; i < R.U1.length; i+=2) this.U1(C, R.U1[i], R.U1[i+1], view) }
  //   if (R.U2) { C.U2 = []; for (let i = 0; i < R.U2.length; i+=2) this.U2(C, R.U2[i], R.U2[i+1], view) }
  //   if (R.I0) { C.I0 = []; for (let i = 0; i < R.I0.length; i+=2) this.I0(C, R.I0[i], R.I0[i+1], view) }
  //   if (R.I1) { C.I1 = []; for (let i = 0; i < R.I1.length; i+=3) this.I1(C, R.I1[i], R.I1[i+1], R.I1[i+2], view) }
  //   if (R.I2) { C.I2 = []; for (let i = 0; i < R.I2.length; i+=3) this.I2(C, R.I2[i], R.I2[i+1], R.I2[i+2], view) }

  //   for (let i = 0; i < records.length; i++) {
  //     let { T, N, name, key, value, at, from, to } = records[i]
  //     console.log("arrsink", records[i])
  //     value = value && sclone(value)
  //     if (T === UPDATE) {
  //       const type = 'update'
  //       N === 0 && this.arr.push({ type, key: EA, value })
  //       N === 1 && this.arr.push({ type, key: [name], value })
  //       N === 2 && this.arr.push({ type, key, value })
  //       N === 3 && this.arr.push({ type, from, to })
  //     }
     
  //     if (T === INSERT) {
  //       const type = 'insert'
  //       N === 0 && this.arr.push({ type, value, at })
  //       N === 1 && this.arr.push({ type, key: [name], value, at })
  //       N === 2 && this.arr.push({ type, key, value, at })
  //     }

  //     if (T === REMOVE) {
  //       const type = 'remove'
  //       N === 0 && this.arr.push({ type, key: EA, value })
  //       N === 1 && this.arr.push({ type, key: [name], value })
  //       N === 2 && this.arr.push({ type, key, value })
  //     }
  //   }
  // }
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

class ViewProxy {
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
    const Operator = Operators[type]?.(...args)
    if (Operator) {
      let sink = p.some_sink(sink => {
        if (sink instanceof Operator) 
          return sink.matches(...args)
      }) 
      if (!sink) {
        p.sinks.add(new WeakRef(sink = new Operator(p, ...args)))
      }
      return new ViewProxy(sink.view)
    }

    const [value, at] = args
    if (type === 'remove') return this.view.res.remove(p.key)
    if (type === 'update') return this.view.res.update(value, p.key)
    if (type === 'insert') return this.view.res.insert(value, p.key, at)
  }

  getPrototypeOf(targer){
    return ViewProxy.prototype
  }

  *iterator(i = 0) {
    while (true) {
      yield this[i++]
    }
    // for (const k of Object.keys(this[view].value)) {
    //   yield this[k]
    // }
  }
}


class BetweenValue extends Operator {
  matches(col, [lo, hi]) {
    return this.col === col && this.plo === lo && this.phi === hi
  }

  constructor(p, col, arg) { 
    super()
    this.p = p
    this.col = col
    this.plo = arg[0]
    this.phi = arg[1]
    this.sorted = []
    this.find = left(d => { return this.p.value[d][col] })

    if (arg instanceof ViewProxy) {
      arg.connect(this, 'extent')
    } else {
      arg[0].connect(this, 'lo')
      arg[1].connect(this, 'hi')
    }
    this.XU0(p.value)
  }

  set lo(v){ 
    this.extent = v > this.hi_val
      ? [this.hi_val, v]
      : [v, this.hi_val]
  }

  set hi(v){ 
    this.extent = v < this.lo_val
      ? [v, this.lo_val]
      : [this.lo_val, v]
  }

  set extent([a = -Infinity, b = Infinity]){
    a = +a
    b = +b
    const new_lo = a < b ? a : b // TODO: remove
    const new_hi = a < b ? b : a // TODO: remove
    if (!this.view.value) 
      return [this.lo_val, this.hi_val] = [new_lo, new_hi]

    if (new_lo === -Infinity && new_hi === Infinity) {
      this.hi_index = this.lo_index = undefined;
      [this.lo_val, this.hi_val] = [new_lo, new_hi]
      return this.view.XU0(this.view.value = this.p.value)
    }

    if (new_lo === new_hi) {
      this.hi_index = this.lo_index = undefined;
      [this.lo_val, this.hi_val] = [new_lo, new_hi]
      return this.view.XU0(this.view.value = isArray(this.p.value) ? [] : {})
    }

    const I0 = [], R1 = []
    this.lo_index ??= this.find(this.sorted, this.lo_val)
    this.hi_index ??= this.find(this.sorted, this.hi_val)

    let ti, tv
    if (new_hi < this.hi_val) {
      while (
        (tv = this.p.value[ti = this.sorted[this.hi_index - 1]]) && 
        (tv[this.col] > new_hi)
      ) {
        this.hi_index--
        R1.push(ti, tv)
        this.view.value[ti] = undefined 
      }
      if (this.lo_index > this.hi_index) this.lo_index = this.hi_index
    } 

    if (new_lo > this.lo_val) {
      while (
        (tv = this.p.value[ti = this.sorted[this.lo_index]]) && 
        (tv[this.col] < new_lo)
      ) {
        this.lo_index++
        R1.push(ti, tv)
        this.view.value[ti] = undefined 
      }
      if (this.hi_index < this.lo_index) this.hi_index = this.lo_index
    }

    if (new_hi > this.hi_val) {
      while (
        (tv = this.p.value[ti = this.sorted[this.hi_index]]) && 
        (tv[this.col] < new_hi)
      ) {
        this.hi_index++
        I0.push(ti, tv)
        this.view.value[ti] = tv 
      }
    } 

    if (new_lo < this.lo_val) {
      while (
        (tv = this.p.value[ti = this.sorted[this.lo_index - 1]]) && 
        (tv[this.col] > new_lo)
      ) {
        this.lo_index--
        I0.push(ti, tv)
        this.view.value[ti] = tv 
      }
    }

    this.lo_val = new_lo
    this.hi_val = new_hi
    this.view.BI0(I0)
    this.view.BR1(R1)
  }

  XU0(value) {
    const { col } = this
    this.lo_index = undefined
    this.hi_index = undefined
    if (typeof value !== 'object') return super.XU0()
    const new_value = isArray(value) ? [] : {}
    this.sorted = [] 
    iter(value, (i, v) => {
      this.sorted.push(''+i)
      if (v[col] >= this.lo_val && v[col] <= this.hi_val)
        new_value[i] = value[i]
    })

    this.sorted.sort((a, b) => { 
      const va = value[a][col]
      const vb = value[b][col]
      return va > vb ? 1
           : va < vb ? -1
           : 0
    })
    super.XU0(new_value)
  }
}

class ZAValue extends Operator {
  matches(col, n) { return this.col_name == col && this.n == n }
  
  constructor(p, col, col_name, n) {
    super()
    this.p = p
    this.n = n 
    this.col = col
    this.col_name = col_name 
    this.XU0(p.value)
  }

  XR0(){ 
    this.sorted = []
    this.view.XU0(this.view.value = [])
  }
  
  XU0(value){
    if (typeof value !== 'object') return this.XR0()
    this.sorted = Object
      .keys(value)
      .sort((a, b) => { 
        const va = this.col(value[a])
        const vb = this.col(value[b])
        return va > vb ? -1
             : va < vb ?  1
                       :  0
      })

    this.view.XU0(this.view.value = this.sorted
      .slice(0, this.n)
      .map(i => value[i])
    )
  }

  BR1(R1){
    for (let i = 0; i < R1.length; i++) {
      const oidx = this.get_index(R1[i++])
      this.sorted.splice(oidx, 1)
      if (oidx >= this.n) return
      super.BR1A([oidx])
      const len = this.view.value.length 
      if (this.sorted.length > len)
        super.BI0A([len, this.p.value[this.sorted[len]]])
    }
  }

  BU1(U1){
    for (let i = 0; i < U1.length; i++) {
      const name = U1[i++]
      const value = U1[i]
      const { n, p, sorted } = this
      let oidx = this.get_index(name)
      if (oidx === -1) { this.BI0([name, value]); continue }

      let nidx = this.find(this.col(this.p.value[name]))
      if (oidx === nidx) { super.BU1([oidx, value]); continue }
      if (nidx > oidx) nidx--
      sorted.splice(oidx, 1)
      sorted.splice(nidx, 0, name)
      if (oidx >= n && nidx >= n) {}
      else if (oidx >= n && nidx <  n) {
        super.BR1A([n - 1])
        super.BI0A([nidx, p.value[sorted[nidx]]])
      } else if (oidx < n && nidx >= n) {
        super.BR1A([oidx])
        super.BI0A([n - 1, p.value[sorted[n - 1]]])
      } else if (oidx < n && nidx < n) {
        const lo = oidx < nidx ? oidx : nidx
        const hi = oidx < nidx ? nidx : oidx
        for (let idx = lo; idx <= hi; idx++) {
          super.BU1([''+idx, p.value[sorted[idx]]])
        }
      }
    }
  }

  BI0(I0){
    for (let i = 0; i < I0.length; i++) {
      const at = I0[i++]
      const value = I0[i]
      const new_idx = this.find(this.col(this.p.value[at]))
      this.sorted.splice(new_idx, 0, at)
      if (new_idx >= this.n) return
      if (this.view.value.length === this.n) 
        super.BR1A([this.n - 1])
      super.BI0A([new_idx, value])
    }
  }

  BR2(R2) {
    for (let i = 0; i < R2.length; i++) {
      const [name, col, ...rest] = R2[i++]
      const value = R2[i]
      if (col === this.col_name) {
        this.U1(changes, name, this.p.value[name])
      } else {
        const oidx = this.get_index(name)
        if (oidx < this.n)
          this.view.BR2([[`${oidx}`, col, ...rest], value])
      }
    }
  }

  BU2(U2) {
    for (let i = 0; i < U2.length; i++) {
      const [name, col, ...rest] = U2[i++]
      const value = U2[i]
      if (col === this.col_name) {
        this.BU1([name, this.p.value[name]])
      } else {
        const oidx = this.get_index(name)
        if (oidx < this.n) {
          this.view.BU2([[`${oidx}`, col, ...rest], value])
        }
      }
    }
  }

  BI2(I2){  
    for (let i = 0; i < I2.length; i++) {
      const [name, ...rest] = I2[i++]
      const value = I2[i++]
      const at = I2[i]
      if (!this.has(name)) { this.BI0([name, this.p.value[name]]); continue }
      // TODO: assuming this type of assert can't change val atm
      const nidx = this.get_index(name)
      if (nidx >= this.n) continue
      this.view.BI2([[`${nidx}`, ...rest], value, at])
    }
  }

  get_index(id){
    return this.sorted.indexOf(id)
  }

  has(id){ return !!~this.get_index(id) }
}
ZAValue.prototype.find = bisect_right

class ZAColumnValue extends ZAValue { 
  constructor(p, col, n = Infinity){
    super(p, d => d[col], col, n)
  }
}

class ZANumberValue extends ZAValue { 
  constructor(p, n = Infinity){
    super(p, d => d, value, n)
  }
}

class LimitValue extends Operator {
  constructor(p, n) {
    super()
    this.p = p
    this.n = n
    this.XU0(this.p.value)
  }

  XR0(){ this.XU0(this.p.value) }
  BU1(U1){ if (U1[0] < this.last) this.XU0(this.p.value) }
  BI0(I0){ if (I0[0] < this.last || this.view.value.length < this.n) this.XU0(this.p.value) }
  BR1(R1){ if (R1[0] < this.last || this.view.value.length < this.n) this.XU0(this.p.value) }
  // BR2(){ this.XU0(this.p.value) }
  // BU2(){ this.XU0(this.p.value) }
  // BI2(){ this.XU0(this.p.value) }
  XU0(value) {
    this.view.value = []
    this.index = []
    if (typeof value === 'object') {
      if (isArray(value)) {
        let i = -1 
        while (i < value.length) {
          if (value[++i] !== undefined) {
            this.view.value.push(value[i])
            this.index.push(i)
            if (this.view.value.length === this.n) break
          }
        }
      } else {
        for (const i in value) {
          if (value[i] !== undefined) {
            this.view.value.push(value[i])
            this.index.push(i)
            if (this.view.value.length === this.n) break
          }
        }
      }
    }

    this.last = this.index.at(-1)
    this.view.XU0(this.view.value)
  }
}


// class LimitValue extends Operator {
//   constructor(p, n) {
//     super()
//     this.p = p
//     this.n = n
//     this.XU0(this.p.value)
//   }

//   XR0(){ this.XU0(this.p.value) }
//   BU1(U1){ 
//     // console.log('U1', { index: this.index, last: this.last, U1, value: this.view.value })
//     const NU1 = []
//     for (let i = 0; i < U1.length; i++) {
//       const name = +U1[i++]
//       if (name <= this.last) {
//         const value = U1[i]
//         const index = find(this.index, name)
//         this.view.value[index] = value
//         NU1.push(index, value)
//       }
//     } 
//     this.view.BU1(NU1)
//   }
//   BI0(I0){ 
//     // console.log('I0', { index: this.index, last: this.last, I0 })
//     // return
//     // let last = this.index.at(-1)
//     const NI0 = []
//     const NR1 = []
//     for (let i = 0; i < I0.length; i++) {
//       const at = +I0[i++]
//       if (at < this.last || this.view.value.length < this.n) {
//         // console.og
//         const value = I0[i]
//         const index = find(this.index, at)
//         this.view.value.splice(index, 0, value)
//         this.index.splice(index, 0, at)
//         NI0.push(index, value)
//         this.last = this.index.at(-1)
//       } else break
//     }

//     while (this.view.value.length > this.n) {
//       // console.log('popping', { value: this.view.value })
//       this.index.pop()
//       NR1.push(this.index.length, this.view.value.pop())
//     }

//     this.view.BI0(NI0)
//     this.view.BR1(NR1)
//     // } else {
//     //   this.XU0(this.p.value)  // TODO: optimise fast path for all combinations
//     // }
//   }
//   BR1(R1){
//     // console.log({ index: this.index, last: this.last, R1 })
//     // return
//     const NR1 = []
//     const NI0 = []
//     for (let i = 0; i < R1.length; i+=2) {
//       const name = +R1[i]
//       if (name <= this.last) {
//         const index = find(this.index, name) 
//         this.index.splice(index, 1)
//         NR1.push(index, this.view.value.splice(index, 1)[0])
//         this.last = this.index.at(-1)
//       } else break
//     }

//     if (this.view.value.length < this.n) {
//       const value = this.p.value
//       if (isArray(value)) {
//         for (let i = this.last ?? 0; i < value.length; i++) {
//           if (value[i] !== undefined) {
//             NI0.push(this.index.length, value[i])
//             this.view.value.push(value[i])
//             this.index.push(i)
//             if (this.view.value.length === this.n) break
//           }
//         }
//       } else {
//         if (this.last === undefined) {
//           for (const i in value) {
//             if (value[i] !== undefined) {
//               NI0.push(this.index.length, value[i])
//               this.view.value.push(value[i])
//               this.index.push(+i)
//               if (this.view.value.length === this.n) break
//             }
//           }
//         } else {
//           for (const i in value) {
//             if (value[i] !== undefined && i > this.last) {
//               NI0.push(this.index.length, value[i])
//               this.view.value.push(value[i])
//               this.index.push(+i)
//               if (this.view.value.length === this.n) break
//             }
//           }
//         }
//       }
//       this.last = this.index.at(-1)
//     }

//     this.view.BR1(NR1)
//     this.view.BI0(NI0)
//   }
//   BR2(){ this.XU0(this.p.value) }
//   BU2(){ this.XU0(this.p.value) }
//   BI2(){ this.XU0(this.p.value) }
//   XU0(value) {
//     this.view.value = []
//     this.index = []
//     if (typeof value === 'object') {
//       if (isArray(value)) {
//         let i = -1 
//         while (i < value.length) {
//           if (value[++i] !== undefined) {
//             this.view.value.push(value[i])
//             this.index.push(i)
//             if (this.view.value.length === this.n) break
//           }
//         }
//       } else {
//         for (const i in value) {
//           if (value[i] !== undefined) {
//             this.view.value.push(value[i])
//             this.index.push(+i)
//             if (this.view.value.length === this.n) break
//           }
//         }
//       }
//     }

//     this.last = this.index.at(-1)
//     this.view.XU0(this.view.value)
//   }
// }

class ToValue extends Operator {
  constructor(p, fn) {
    super()
    this.p = p
    this.fn = fn
    this.XU0(this.p.value)
  }

  XU0(value) {
    const new_value = this.fn(value, this.view.value)
    if (new_value === this.view.value) return
    this.view.XU0(this.view.value = new_value) 
  }
  XR0(){ this.XU0(this.p.value) }
  BR1(){ this.XU0(this.p.value) }
  BU1(){ this.XU0(this.p.value) }
  BI0(){ this.XU0(this.p.value) }
  BR2(){ this.XU0(this.p.value) }
  BU2(){ this.XU0(this.p.value) }
  BI2(){ this.XU0(this.p.value) }
}

class DebounceValue extends Operator {
  constructor(p, fn, ms = 1000) {
    super()
    this.p = p
    this.fn = fn
    this.ms = ms
    this.bulk()
  }
  calc = () => {
    delete this.pending
    const value = this.fn(this.p.value, this.view.value)
    if (value === this.view.value) return
    const o = []
    super.U0({ value }, o)
    this.view.bulk(o)
  }
  bulk() {
    if (this.pending) return //clearTimeout(this.pending)
    this.pending = setTimeout(this.calc, this.ms) 
  }
}

class RowOperator extends Operator {
  process() { throw new Error('not implemented, process:', this.name) }

  loop(C, inc, inner) {
    const NU1 = [], NI0 = [], NR1 = []
    for (let i = 0; i < C.length; i += inc) {
      const name = inner ? C[i][0] : C[i]
      const old_val = this.view.value?.[name]
      // console.log('loop', { name, vv: this.view.value })
      const now_val = this.process(this.p.value[name], name, old_val)
      const old = old_val !== undefined
      const now = now_val !== undefined
      if ( old &&  now) { NU1.push(name, now_val); this.view.value[name] = now_val }
      else if (!old &&  now) { NI0.push(name, now_val); this.view.value[name] = now_val }
      else if ( old && !now) { NR1.push(name, old_val); delete this.view.value[name]  }
    }
    this.view.BU1(NU1)
    this.view.BI0(NI0)
    this.view.BR1(NR1)
  }

  XU0(value){
    if (typeof value !== 'object') return this.view.XU0(this.view.value = undefined)
    const n = isArray(value) ? [] : {}
    for (const i in value) {
      const v = this.process(value[i], i, this.view.value?.[i])
      if (v !== undefined) n[i] = v
    }
    this.view.XU0(this.view.value = n)
  }
  BU1(U1) { this.loop(U1, 2, false) }
  BU2(U2) { this.loop(U2, 2, true ) }
  BI0(I0) { this.loop(I0, 2, false) }
  BI2(I2) { this.loop(I2, 3, true) }
  BR2(R2) { this.loop(R2, 2, true) }
  XR0(){ super.XR0() }
  BR1(R1) { 
    const NR1 = []
    for (let i = 0; i < R1.length; i++) {
      const name = R1[i++]
      const value = this.view.value?.[name]
      if (value !== undefined) {
        delete this.view.value[name] 
        NR1.push(name, value)
      }
    }  
    this.view.BR1(NR1)
  }
}

class FilterValue extends RowOperator {
  constructor(p, fn){
    super()
    this.p = p
    this.n = 0
    this.all = 0
    this.fn = fn
    this.XU0(this.p.value)
  }

  process(value, name, old_val) {
    return this.fn(value, name, old_val) ? value : undefined
  }
}

function get(k, r){
  const p = k.concat([])
  while (p.length) r = r?.[p.shift()]
  return r
}

function otof(k, v, fns) { 
  if (typeof v !== 'object')
    fns.push((r, i) => get(k, r) === v)
  else 
    for (const i in v) {
      otof(k.concat(i), v[i], fns)
  }
  return fns
}

function match(actual, expected) {
  if (typeof expected !== 'object')
    return actual === expected
  else 
    return Object
      .entries(expected)
      .every(([k, v]) => match(actual?.[k], v))
}

class FilterObjectValue extends FilterValue {
  constructor(p, obj) {
    super(p, r => match(r, obj))
  }
}

class FilterStringValue extends FilterValue {
  constructor(p, name, value) {
    super(p, value === undefined
      ? r => !!r[name]
      : r => r[name] === value
    )
  }
}

class FilterColumnValue extends FilterValue {
  constructor(p, name, value) {
    const key = [].concat(name)
    super(p, value === undefined
      ? r => !!get(key, r)
      : r => get(key, r) === value
    )
  }
}

class MapValue extends RowOperator {
  constructor(p, fn) {
    super()
    this.p = p
    this.fn = fn
    this.XU0(this.p.value)
  }
  
  process(value, name, old_val) {
    // console.log({ name, value, old_val })
    return this.fn(value, name, old_val)
  }
}

class GroupValue extends Value {
  constructor(p, fn) {
    super()
    this.p = p
    this.fn = fn
    this.XU0(this.p.value)
  }

  static ArrayMapping = class {
    map = []
    insert(k, v){ this.map.splice(k, 0, v) }
    update(k, v){ this.map[k] = v }
    remove(k){ this.map.splice(k, 1) }
    get(k){ return this.map[k] }
  }

  static ObjectMapping = class {
    map = new Map
    insert(k, v){ this.map.set(k, v) }
    update(k, v){ this.map.set(k, v) }
    remove(k){ this.map.delete(k) }
    get(k) { return this.map.get(k) }
  }

  XR0(){
    this.mapping = undefined
    // this.mapping.clear()
    this.view.XU0(this.view.value = {})
  }
  
  XU0(value) {
    this.mapping = isArray(value) ? new GroupValue.ArrayMapping : new GroupValue.ObjectMapping // new Map
    const new_value = {}
    iter(value, (i, v) => {
      const g = this.fn(v)
      this.mapping.update(i, g)
      new_value[g] ??= {}
      new_value[g][i] = v
    })
    this.view.XU0(this.view.value = new_value)
  }

  BR1(R1){
    const NR1 = []
    const NR2 = []
    for (let i = 0; i < R1.length; i++) {
      const name = R1[i++]
      const group = this.mapping.get(name)
      if (group === undefined) {
        throw new Error('unexpected group r1: ' + name + ' ' + typeof name)
      }
      this.mapping.remove(name)
      const value = this.view.value[group][name]
      // console.log({ name, group, mapping: this.mapping, value: this.view.value })
      if (value !== undefined) {
        delete this.view.value[group][name] 
        NR2.push([group, name], value)
        if (isEmpty(this.view.value[group])) {
          NR1.push(group, this.view.value[group])
          delete this.view.value[group]
        }
      }
    }
    this.view.BR1(NR1)
    this.view.BR2(NR2)
  }

  BU1(U1){
    const NR2 = []
    const NU2 = []
    const NR1 = []
    const NI2 = []
    const removed_groups = []
    for (let i = 0; i < U1.length; i++) {
      const name = U1[i++]
      const value = U1[i]
      const old_group = this.mapping.get(name)
      const new_group = this.fn(value)
      if (old_group === new_group) {
        NU2.push([new_group, name], this.view.value[new_group][name] = value)
      } else {
        if (old_group !== undefined) {
          const old_value = this.view.value[old_group][name]
          delete this.view.value[old_group][name]
          NR2.push([old_group, name], old_value)
          removed_groups.push(old_group)
        } 
        this.view.value[new_group] ??= {}
        NI2.push([new_group], this.view.value[new_group][name] = value, name)
        this.mapping.update(name, new_group)
      }
    }

    for (const group of removed_groups) {
      if (isEmpty(this.view.value[group])) {
        NR1.push(group, this.view.value[group])
        delete this.view.value[group]
      }
    }

    if (NR1.length) this.view.BR1(NR1)
    if (NR2.length) this.view.BR2(NR2)
    if (NU2.length) this.view.BU2(NU2)
    if (NI2.length) this.view.BI2(NI2)
  }

  BI0(I0) { 
    const NI2 = []
    for (let i = 0; i < I0.length; i++) {
      const name = I0[i++]
      const value = I0[i]
      const new_group = this.fn(value)
      this.view.value[new_group] ??= {}
      NI2.push([new_group], this.view.value[new_group][name] = value, name)
      this.mapping.insert(name, new_group)
    }

    if (NI2.length) this.view.BI2(NI2)
  }
  BR2() {}
  BU2() {}
  BI2() {}
}

class LengthFnValue extends Operator {
  constructor(p, fn) {
    super()
    this.p = p
    this.fn = fn
    this.XU0(this.p.value)
  }

  XR0(){
    this.mapping = {}
    this.view.XU0(this.view.value = {})
  }

  XU0(value) {
    const new_value = {}
    this.mapping = {}
    iter(value, (i, v) => {
      if (v === undefined) return; // TODO: check undef can always be removed
      (this.mapping[i] = new_value[this.fn(v)] ??= { value: 0 }).value++
    })

    this.view.XU0(this.view.value = new_value) 
  }
  
  check(o) {
    // this.view.XU0(this.view.value)
    // const NU1 = []
    // iter(o, (i, v) => NU1.push(i, this.view.value[i] = v))
    // if (NU1.length) this.view.BU1(NU1)
  }
  
  BR1(R1){
    const updated = {} 
    const { mapping } = this
    for (let i = 0; i < R1.length; i++) {
      const n = R1[i++]
      const m = mapping[n]
      if (!m) continue
      m.value--
      mapping[n] = undefined
    }
    this.view.XU0(this.view.value)
    // this.check(updated)
  }

  BU1(U1){ 
    const { mapping, view, fn } = this
    for (let i = 0; i < U1.length; i++) {
      const n = U1[i++]
      const v = U1[i]
      const og = mapping[n]
      const ng = view.value[fn(v)] ??= { value: 0 }
      if (og !== ng) {
        mapping[n] = ng
        if (og) og.value--
        ng.value++
      }
    }
    this.view.XU0(this.view.value)
    // this.check(updated)
  }

  BI0(I0){ 
    // console.log({ I0 })
    const { mapping, view, fn } = this
    for (let i = 0; i < I0.length; i++) {
      const n = I0[i++]
      const v = I0[i]
      if (v === undefined) continue
      ;(mapping[n] = view.value[fn(v)] ??= { value: 0 }).value++
    }
    this.view.XU0(this.view.value)
    // this.BU1(I0) 
  }

  BR2(){}
  BU2(){}
  BI2(){}
}

class LengthValue extends Operator {
  constructor(p, fn) {
    super()
    this.p = p
    // this.keys = new Map
    this.view.value = 0
    this.XU0(p.value)
  }
  
  XR0(){
    // this.keys.clear()
    // super.XU0(this.keys.size)
    this.view.XU0(this.view.value = 0)
  }
  XU0(value){
    // this.keys.clear()
    // iter(value, name => this.keys.set(''+name, 1))
    this.view.value = 0
    if (isArray(value)) {
      this.view.XU0(this.view.value = value.length)
    } else {
      iter(value, () => this.view.value++)
      this.view.XU0(this.view.value)
    }
  }
  BR1(R1){
    // iter2(R1, name => this.keys.delete(''+name))
    this.view.XU0(this.view.value -= R1.length/2)
  }
  BU1(U1){
    // console.log('U1.length :>> ', U1.length); 
    // iter2(U1, name => this.keys.set(''+name, 1))
    // this.view.XU0(this.keys.size)
  }
  BI0(I0){ 
    this.view.XU0(this.view.value += I0.length/2)  
  }

  BR2(){}
  BU2(){}
  BI2(){}
}

class IntersectValue extends Operator {
  constructor(p, ...sources) {
    super()
    this.vp = sources[0]
    this.p = p
    this.sources = new Map([[p, { one: 1, off: ~ 1 }]])
    this.all = 1
    for (const src of sources) {
      const one = 1 << this.sources.size 
      src.connect(this)
      this.sources.set(src[Symbols.view], { one, off: ~one })
      this.all |= one
    }

    if (typeof p.value !== 'object') { super.XU0(); return }
    const new_value = isArray(this.p.value) ? [] : {}
    this.filters = isArray(this.p.value) ? [] : {}
    iter(p.value, (i, v) => {
      for (const [res, src] of this.sources) {
        if (i in res.value) this.filters[i] |= src.one
      }
      if (this.filters[i] === this.all) new_value[i] = v
    })
    this.view.XU0(this.view.value = new_value)
  }

  XR0(_, view){
    const { off } = this.sources.get(view)
    iter(this.filters, i => this.filters[i] &= off)
    this.view.XU0(this.view.value = isArray(this.view.value) ? [] : {})
  }

  XU0(value, view) {
    const { one, off } = this.sources.get(view)
    this.view.value ??= isArray(this.p.value) ? [] : {} 
    if (typeof value !== 'object') return super.XU0(C) // TODO: reset filters
    this.filters ??= isArray(this.p.value) ? [] : {} 
    const new_value = isArray(this.p.value) ? [] : {}
    // iter(this.view.value, (i, v) => {
    //   if (v === undefined) return 
    //   this.filters[i] &= off
    // }) 
    iter(this.filters, (i, v) => this.filters[i] = v & off) 
    iter(value, i => {
      if ((this.filters[i] |= one) === this.all) 
        new_value[i] = this.p.value[i]      
    })
    this.view.XU0(this.view.value = new_value)
  }
  
  BR1(R1, view) {
    const { off } = this.sources.get(view)
    const NR1 = []
    const zero = this.all & off
    this.view.value ??= isArray(this.p.value) ? [] : {}
    for (let i = 0; i < R1.length; i+=2) {
      const name = R1[i]
      // const cur = this.filters[name] = old & off
      if ((this.filters[name] & off) === zero) {
        NR1.push(name, this.view.value[name])
        this.view.value[name] = undefined
      }
    }
    this.view.BR1(NR1)
  }

  BU1(U1){
    const { all, filters } = this
    const NU1 = []
    for (let i = 0; i < U1.length; i++) {
      const name = U1[i++]
      if (filters[name] === all) {
        const value = this.p.value[name]
        if (value === this.view.value[name]) continue
        this.view.value[name] = value
        NU1.push(name, value)
      } 
    } 
    this.view.BU1(NU1)
  }
  BI0(I0, view){
    const { all, sources, filters } = this
    const { one } = sources.get(view)
    const me = this.view.value ??= isArray(this.p.value) ? [] : {} 
    const NI0 = []
    for (let i = 0; i < I0.length; i++) {
      const name = I0[i++]
      if ((filters[name] |= one) === all) {
        NI0.push(name, me[name] = this.p.value[name])
      } 
    } 
    this.view.BI0(NI0)
  }

  R2(){ /* TODO: pass through */ }
  U2(){ /* TODO: pass through */ }
  I2(){ /* TODO: pass through */ }
}

const Operators = { 
  filter: (a, b) => 
    typeof a === 'function' ? FilterValue
  : typeof a === 'string' ? FilterStringValue
  : isArray(a) ? FilterColumnValue
  : isObject(a) ? FilterObjectValue
  : 'unexpected filter args'
, between: () => BetweenValue
, to: () => ToValue
, debounce: () => DebounceValue
, map: () => MapValue
, length: (fn) => typeof fn === 'function' 
  ? LengthFnValue 
  : LengthValue
, intersect: () => IntersectValue
, group: () => GroupValue 
, za: (a, b) => 
    typeof a === 'string' ? ZAColumnValue 
  : typeof a === 'number' ? ZANumberValue 
  : 0
, top: () => ZANumberValue 
, limit: () => LimitValue 
}

function create(views, name, res) {
  views.set(name, new WeakRef(res))
  return res
}

function connect(p, a, b) {
  // console.log("p, a, b", p, a, b)
  if (isArray(a)) {
    const sink = new ArrSink(p, a)
    // p.sinks.push(new WeakRef(sink))
    p.sinks.add(new WeakRef(sink))
    // console.log("connect", p)
    return a
  }

  if (typeof a === 'object' && typeof b === 'string') {
    const sink = new PropSink(p, a, b)
    // p.sinks.push(new WeakRef(sink))
    p.sinks.add(new WeakRef(sink))
    return a
  }

  if (typeof a === 'object' && typeof b === 'function') {
    const sink = new FunctionSink(p, a, b)
    // p.sinks.push(new WeakRef(sink))
    p.sinks.add(new WeakRef(sink))
    return a
  }

  // p.sinks.push(new WeakRef(a))
  p.sinks.add(new WeakRef(a))
  return a
}

// utils
const left = prop => function bisect(a, v, lo = 0, hi = a.length) {
  while (lo < hi) {
    const mid = lo + hi >>> 1;
    if (prop(a[mid]) < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function bisect_right(v, lo = 0, hi = this.sorted.length) {
  while (lo < hi) {
    const mid = lo + hi >>> 1;
    if (this.col(this.p.value[this.sorted[mid]]) < v) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function find(a, v, lo = 0, hi = a.length) {
  while (lo < hi) {
    const mid = lo + hi >>> 1;
    if (a[mid] < v) lo = mid + 1
    else hi = mid;
  }
  return lo;
}

function isEmpty(obj) {
  for (const i in obj) 
    return false;
  return true;
}