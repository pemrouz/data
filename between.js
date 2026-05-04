// @ts-nocheck
import { isArray, iter, left } from "./utils.js";
import { Operator, ViewProxy, createOperator } from "./core.js";
export class BetweenValue extends Operator {
    matches(col, [lo, hi]) {
        return this.col === col && this.plo === lo && this.phi === hi;
    }
    constructor(p, col, arg) {
        super();
        this.p = p;
        this.col = col;
        this.plo = arg[0];
        this.phi = arg[1];
        this.sorted = [];
        this.find = left(d => { return this.p.value[d][col]; });
        if (arg instanceof ViewProxy) {
            arg.connect(this, 'extent');
        }
        else {
            arg[0].connect(this, 'lo');
            arg[1].connect(this, 'hi');
        }
        this.XU0(p.value);
    }
    set lo(v) {
        this.extent = v > this.hi_val
            ? [this.hi_val, v]
            : [v, this.hi_val];
    }
    set hi(v) {
        this.extent = v < this.lo_val
            ? [v, this.lo_val]
            : [this.lo_val, v];
    }
    set extent([a = -Infinity, b = Infinity]) {
        a = +a;
        b = +b;
        const new_lo = a < b ? a : b;
        const new_hi = a < b ? b : a;
        if (!this.view.value)
            return [this.lo_val, this.hi_val] = [new_lo, new_hi];
        if (new_lo === -Infinity && new_hi === Infinity) {
            this.hi_index = this.lo_index = undefined;
            [this.lo_val, this.hi_val] = [new_lo, new_hi];
            return this.view.XU0(this.view.value = this.p.value);
        }
        if (new_lo === new_hi) {
            this.hi_index = this.lo_index = undefined;
            [this.lo_val, this.hi_val] = [new_lo, new_hi];
            return this.view.XU0(this.view.value = isArray(this.p.value) ? [] : {});
        }
        if (this.view.value === this.p.value) {
            this.view.value = isArray(this.p.value) ? [...this.p.value] : { ...this.p.value };
        }
        const I0 = [], R1 = [];
        this.lo_index ??= this.find(this.sorted, this.lo_val);
        this.hi_index ??= this.find(this.sorted, this.hi_val);
        let ti, tv;
        if (new_hi < this.hi_val) {
            while ((tv = this.p.value[ti = this.sorted[this.hi_index - 1]]) &&
                (tv[this.col] > new_hi)) {
                this.hi_index--;
                R1.push(ti, tv);
                this.view.value[ti] = undefined;
            }
            if (this.lo_index > this.hi_index)
                this.lo_index = this.hi_index;
        }
        if (new_lo > this.lo_val) {
            while ((tv = this.p.value[ti = this.sorted[this.lo_index]]) &&
                (tv[this.col] < new_lo)) {
                this.lo_index++;
                R1.push(ti, tv);
                this.view.value[ti] = undefined;
            }
            if (this.hi_index < this.lo_index)
                this.hi_index = this.lo_index;
        }
        if (new_hi > this.hi_val) {
            while ((tv = this.p.value[ti = this.sorted[this.hi_index]]) &&
                (tv[this.col] < new_hi)) {
                this.hi_index++;
                I0.push(ti, tv);
                this.view.value[ti] = tv;
            }
        }
        if (new_lo < this.lo_val) {
            while ((tv = this.p.value[ti = this.sorted[this.lo_index - 1]]) &&
                (tv[this.col] > new_lo)) {
                this.lo_index--;
                I0.push(ti, tv);
                this.view.value[ti] = tv;
            }
        }
        this.lo_val = new_lo;
        this.hi_val = new_hi;
        if (I0.length)
            this.view.BI0(I0);
        if (R1.length)
            this.view.BR1(R1);
    }
    XU0(value) {
        const { col } = this;
        this.lo_index = undefined;
        this.hi_index = undefined;
        if (typeof value !== 'object')
            return super.XU0();
        const new_value = isArray(value) ? [] : {};
        this.sorted = [];
        iter(value, (i, v) => {
            this.sorted.push('' + i);
            if (v[col] >= this.lo_val && v[col] <= this.hi_val)
                new_value[i] = value[i];
        });
        this.sorted.sort((a, b) => {
            const va = value[a][col];
            const vb = value[b][col];
            return va > vb ? 1
                : va < vb ? -1
                    : 0;
        });
        super.XU0(new_value);
    }
}
export const between = (source, col, arg) => createOperator(source, BetweenValue, col, arg);
