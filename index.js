// @ts-nocheck
export { $, value, reactive, view, Sink, Operators, createOperator } from "./core.js";
export { default } from "./core.js";
export { render, HTML, SVG } from "./render.js";
import { isArray } from "./utils.js";
import { Operators } from "./core.js";
import { FilterValue, FilterObjectValue, FilterStringValue, FilterColumnValue } from "./filter.js";
import { BetweenValue } from "./between.js";
import { ZAColumnValue, ZANumberValue, LimitValue } from "./sort.js";
import { ToValue } from "./to.js";
import { DebounceValue } from "./debounce.js";
import { MapValue } from "./map.js";
import { GroupValue } from "./group.js";
import { LengthValue, LengthFnValue } from "./length.js";
import { IntersectValue } from "./intersect.js";
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
