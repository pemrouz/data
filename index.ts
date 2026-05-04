// @ts-nocheck
export { $, value, reactive, view, Sink, Operators, createOperator } from './core.ts'
export { default } from './core.ts'
export { render, HTML, SVG } from './render.ts'

import { isArray } from './utils.ts'
import { Operators } from './core.ts'
import { FilterValue, FilterObjectValue, FilterStringValue, FilterColumnValue } from './filter.ts'
import { BetweenValue } from './between.ts'
import { ZAColumnValue, ZANumberValue, LimitValue } from './sort.ts'
import { ToValue } from './to.ts'
import { DebounceValue } from './debounce.ts'
import { MapValue } from './map.ts'
import { GroupValue } from './group.ts'
import { LengthValue, LengthFnValue } from './length.ts'
import { IntersectValue } from './intersect.ts'

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
