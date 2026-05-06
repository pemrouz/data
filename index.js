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
// Operator dispatch table. Each entry receives the call arguments and returns
// the appropriate Operator subclass — letting one method name (`filter`,
// `length`, `za`/`az`) cover several internal implementations chosen by
// argument shape. Adding an operator means: implement the class, then a
// one-line registration here.
Operators['filter'] = (a, b) => typeof a === 'function' ? FilterValue // filter(fn)
    : typeof a === 'string' ? FilterStringValue // filter('key', val?)
        : isArray(a) ? FilterColumnValue // filter(['k','sub'], val?)
            : FilterObjectValue; // filter({k:v,...})
Operators['between'] = () => BetweenValue;
Operators['to'] = () => ToValue;
Operators['debounce'] = () => DebounceValue;
Operators['map'] = () => MapValue;
// length() counts rows; length(fn) groups by fn(row) and counts each group.
Operators['length'] = (fn) => typeof fn === 'function' ? LengthFnValue : LengthValue;
Operators['intersect'] = () => IntersectValue;
Operators['group'] = () => GroupValue;
// za/az/top all share ZAValue's machinery — direction is encoded in the
// column accessor rather than a separate flag, and `top` is just `za` with
// the identity column accessor (rows compared as-is).
Operators['za'] = (a, b) => typeof a === 'string' ? ZAColumnValue : ZANumberValue;
Operators['top'] = () => ZANumberValue;
Operators['az'] = (a, b) => typeof a === 'string' ? ZAColumnValue : ZANumberValue;
Operators['limit'] = () => LimitValue;
