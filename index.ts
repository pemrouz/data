// @ts-nocheck
export { $, value, reactive, view, Sink, Operators, createOperator } from './core.ts'
export { default } from './core.ts'
export { render, HTML, SVG } from './render/index.ts'

import { isArray } from './utils.ts'
import { Operators } from './core.ts'
import { FilterValue, FilterObjectValue, FilterStringValue, FilterColumnValue } from './operators/filter/index.ts'
import { BetweenValue } from './operators/between/index.ts'
import { ZAColumnValue, ZANumberValue, LimitValue } from './operators/sort/index.ts'
import { ToValue } from './operators/to/index.ts'
import { DebounceValue } from './operators/debounce/index.ts'
import { MapValue } from './operators/map/index.ts'
import { GroupValue } from './operators/group/index.ts'
import { LengthValue, LengthFnValue } from './operators/length/index.ts'
import { IntersectValue } from './operators/intersect/index.ts'

Operators['filter']    = (a, b) => typeof a === 'function' ? FilterValue
                                 : typeof a === 'string'   ? FilterStringValue
                                 : isArray(a)              ? FilterColumnValue
                                 : FilterObjectValue
Operators['between']   = () => BetweenValue
Operators['to']        = () => ToValue
Operators['debounce']  = () => DebounceValue
Operators['map']       = () => MapValue
Operators['length']    = (fn) => typeof fn === 'function' ? LengthFnValue : LengthValue
Operators['intersect'] = () => IntersectValue
Operators['group']     = () => GroupValue
Operators['za']        = (a, b) => typeof a === 'string' ? ZAColumnValue : ZANumberValue
Operators['top']       = () => ZANumberValue
Operators['az']        = (a, b) => typeof a === 'string' ? ZAColumnValue : ZANumberValue
Operators['limit']     = () => LimitValue
