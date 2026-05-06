// @ts-nocheck
import { createOperator } from "../../core.js";
import { RowOperator } from "../../row.js";
// Map projects each row through `fn`. RowOperator handles all the
// BU1/BR1/BI0 bookkeeping; we just supply the per-row transform. `fn`
// receives the old value (`old_val`) so callers can do "diff against last"
// logic without external state. Returning undefined drops the row — same
// machinery as filter, just a different shape of `process`.
export class MapValue extends RowOperator {
    constructor(p, fn) {
        super();
        this.p = p;
        this.fn = fn;
        this.XU0(this.p.value);
    }
    process(value, name, old_val) {
        return this.fn(value, name, old_val);
    }
}
export const map = (source, fn) => createOperator(source, MapValue, fn);
