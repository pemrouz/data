// @ts-nocheck
import { createOperator } from "../../core.js";
import { RowOperator } from "../../row.js";
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
