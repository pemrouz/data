// @ts-nocheck
import { Operator, createOperator } from "./core.js";
export class ToValue extends Operator {
    constructor(p, fn) {
        super();
        this.p = p;
        this.fn = fn;
        this.XU0(this.p.value);
    }
    XU0(value) {
        const new_value = this.fn(value, this.view.value);
        if (new_value === this.view.value)
            return;
        this.view.XU0(this.view.value = new_value);
    }
    XR0() { this.XU0(this.p.value); }
    BR1() { this.XU0(this.p.value); }
    BU1() { this.XU0(this.p.value); }
    BI0() { this.XU0(this.p.value); }
    BR2() { this.XU0(this.p.value); }
    BU2() { this.XU0(this.p.value); }
    BI2() { this.XU0(this.p.value); }
}
export const to = (source, fn) => createOperator(source, ToValue, fn);
