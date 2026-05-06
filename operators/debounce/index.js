// @ts-nocheck
import { Operator, createOperator } from "../../core.js";
// Debounce coalesces rapid upstream changes into one downstream emit per
// `ms` window. Rate-limit applies to the *output*, not the input: every
// upstream event arms a single trailing timer if one isn't already pending,
// and only the *latest* `fn(source, prev)` result lands when the timer
// fires. Default 1s suits user-input bounded sources (search boxes, brush
// drags); pass a smaller `ms` for animation-paced flushes.
export class DebounceValue extends Operator {
    constructor(p, fn, ms = 1000) {
        super();
        this.p = p;
        this.fn = fn;
        this.ms = ms;
        this.bulk();
    }
    calc = () => {
        delete this.pending;
        const value = this.fn(this.p.value, this.view.value);
        if (value === this.view.value)
            return;
        const o = [];
        super.U0({ value }, o);
        this.view.bulk(o);
    };
    bulk() {
        if (this.pending)
            return;
        this.pending = setTimeout(this.calc, this.ms);
    }
}
export const debounce = (source, fn, ms) => createOperator(source, DebounceValue, fn, ms);
