// @ts-nocheck
import { isArray } from "../../utils.js";
import { createOperator } from "../../core.js";
import { RowOperator } from "../../row.js";
// Walks a key path against a (possibly nested) row. Returns undefined if any
// segment is missing — `r?.[...]` short-circuits the rest.
function get(k, r) {
    const p = k.concat([]);
    while (p.length)
        r = r?.[p.shift()];
    return r;
}
function otof(k, v, fns) {
    if (typeof v !== 'object')
        fns.push((r, i) => get(k, r) === v);
    else
        for (const i in v) {
            otof(k.concat(i), v[i], fns);
        }
    return fns;
}
// Recursive deep-equality for the object-shape filter form: every leaf in
// `expected` must match the corresponding leaf in `actual`. Doesn't recurse
// into `actual`'s extra keys — the row is allowed to have more fields than
// the predicate cares about.
function match(actual, expected) {
    if (typeof expected !== 'object')
        return actual === expected;
    else
        return Object
            .entries(expected)
            .every(([k, v]) => match(actual?.[k], v));
}
// FilterValue is the function-predicate form. RowOperator drives the per-row
// classification — we just have to return the row (kept) or undefined
// (dropped) from `process`. The Filter*Value subclasses wrap convenience
// argument shapes (`filter('key', val)`, `filter({k:v})`, etc.) into the
// underlying predicate function.
export class FilterValue extends RowOperator {
    constructor(p, fn) {
        super();
        this.p = p;
        this.n = 0;
        this.all = 0;
        this.fn = fn;
        this.XU0(this.p.value);
    }
    process(value, name, old_val) {
        return this.fn(value, name, old_val) ? value : undefined;
    }
}
// `filter({a: 1})` form — match-by-template against arbitrary nesting.
export class FilterObjectValue extends FilterValue {
    constructor(p, obj) {
        super(p, r => match(r, obj));
    }
}
// `filter('key')` (truthy) and `filter('key', val)` (equality on top-level key).
export class FilterStringValue extends FilterValue {
    constructor(p, name, value) {
        super(p, value === undefined
            ? r => !!r[name]
            : r => r[name] === value);
    }
}
// `filter(['a', 'b'], val)` — equality at a nested path. The lone string
// case routes to FilterStringValue above; this one is for arrays of segments.
export class FilterColumnValue extends FilterValue {
    constructor(p, name, value) {
        const key = [].concat(name);
        super(p, value === undefined
            ? r => !!get(key, r)
            : r => get(key, r) === value);
    }
}
export const filter = (source, a, b) => {
    const Class = typeof a === 'function' ? FilterValue
        : typeof a === 'string' ? FilterStringValue
            : isArray(a) ? FilterColumnValue
                : FilterObjectValue;
    return createOperator(source, Class, a, b);
};
