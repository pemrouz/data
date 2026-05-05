// @ts-nocheck
import { isArray } from "../../utils.js";
import { createOperator } from "../../core.js";
import { RowOperator } from "../../row.js";
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
function match(actual, expected) {
    if (typeof expected !== 'object')
        return actual === expected;
    else
        return Object
            .entries(expected)
            .every(([k, v]) => match(actual?.[k], v));
}
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
export class FilterObjectValue extends FilterValue {
    constructor(p, obj) {
        super(p, r => match(r, obj));
    }
}
export class FilterStringValue extends FilterValue {
    constructor(p, name, value) {
        super(p, value === undefined
            ? r => !!r[name]
            : r => r[name] === value);
    }
}
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
