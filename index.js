// @ts-nocheck
export { $, value, reactive, view, Sink, Operators, createOperator } from "./core.js";
export { default } from "./core.js";
export { render, HTML, SVG } from "./render/index.js";
import { isArray } from "./utils.js";
import { Operators } from "./core.js";
import { FilterValue, FilterObjectValue, FilterStringValue, FilterColumnValue } from "./operators/filter/index.js";
import { BetweenValue } from "./operators/between/index.js";
import { ZAColumnValue, ZANumberValue, LimitValue } from "./operators/sort/index.js";
import { ToValue } from "./operators/to/index.js";
import { DebounceValue } from "./operators/debounce/index.js";
import { MapValue } from "./operators/map/index.js";
import { GroupValue } from "./operators/group/index.js";
import { LengthValue, LengthFnValue } from "./operators/length/index.js";
import { IntersectValue } from "./operators/intersect/index.js";
Operators['filter'] = (a, b) => typeof a === 'function' ? FilterValue
    : typeof a === 'string' ? FilterStringValue
        : isArray(a) ? FilterColumnValue
            : FilterObjectValue;
Operators['between'] = () => BetweenValue;
Operators['to'] = () => ToValue;
Operators['debounce'] = () => DebounceValue;
Operators['map'] = () => MapValue;
Operators['length'] = (fn) => typeof fn === 'function' ? LengthFnValue : LengthValue;
Operators['intersect'] = () => IntersectValue;
Operators['group'] = () => GroupValue;
Operators['za'] = (a, b) => typeof a === 'string' ? ZAColumnValue : ZANumberValue;
Operators['top'] = () => ZANumberValue;
Operators['az'] = (a, b) => typeof a === 'string' ? ZAColumnValue : ZANumberValue;
Operators['limit'] = () => LimitValue;
