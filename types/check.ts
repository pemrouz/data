// Consumer-perspective type-check fixture (the #65 gate). Imports the public
// surface and exercises every DOCUMENTED pattern; `npm run typecheck` compiles
// this with noCheck:false so the Data<T>/HTML/SVG/jsx types are actually
// validated against how the docs say to use them.
import { $, value, render, HTML, SVG } from '../full.ts'
import type { Data, DataOps, ChangeRecord, Reactive, RowOf } from '../full.ts'

// --- operator chains, OBJECT source ---
const obj = $({ a: { n: 1 }, b: { n: 5 } })
obj.filter(d => d.n > 3).length().connect([])
obj.between('n', [0, 10]).sum('n')
obj.gt('n', 3); obj.lt('n', 3); obj.gte('n', 3); obj.lte('n', 3)
obj.map(r => r.n).az('n').za('n', 5)
obj.group(r => r.n).keys()

// --- operator chains, ARRAY source (#66) ---
const arr = $([{ n: 1 }, { n: 5 }])
arr.filter(d => d.n > 3).length().connect([])
arr.filter(d => d.n > 3).between('n', [0, 1])
arr.some(r => r.n > 0).connect([])
arr.map(r => r.n)

// --- mutation by assignment (#67) ---
// Fixed-shape source: assign to known keys / nested paths (the documented
// mutate-by-assignment API). Reads still yield Data<child> for chaining.
const todos = $({ a: { done: false }, b: { done: true } })
todos.a.done = true
todos.b.done = false
// Dynamic-key sources are typed Record<string, V> — then arbitrary keys assign
// and `delete` works (an index-signature member is optional):
const board = $<Record<string, { done: boolean }>>({})
board.x = { done: false }
delete board.x
// Typed removal of a known key uses .remove() (bare `delete` on a fixed-shape
// property needs the key optional — use .remove() or a Record source):
todos.remove(['a'])

// --- patch + 3-arg reduce (#68) ---
obj.patch(['a', { n: 9 }])
obj.reduce((acc: number, r) => acc + r.n, (acc: number, r) => acc - r.n, 0)

// --- builders (#69) ---
render(document.body, HTML.ul(HTML.li(arr, (li, item) => li.text(item.n))))
SVG.path['d=M0,0']()

// --- the public type vocabulary is NAMEABLE by consumers (the export gate) ---
// A consumer annotating their own variables / callbacks must be able to import
// these by name; if any loses its `export` again, this block fails to compile.
type Order = { amount: number }
const typedRows: Data<Order[]> = $([{ amount: 1 }])
const onChange = (change: ChangeRecord): void => { void change.type; void change.key }
typedRows.connect(document.body, onChange)
const _ops: DataOps<Order[]> = typedRows
const _bound: Reactive<number> = $(3)
const _row: RowOf<Order[]> = { amount: 2 }
void _ops; void _bound; void _row

void value
