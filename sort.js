// @ts-nocheck
import { isArray, bisect_right } from "./utils.js";
import { Operator, value, createOperator } from "./core.js";
export class ZAValue extends Operator {
    matches(col, n) { return this.col_name == col && this.n == n; }
    constructor(p, col, col_name, n) {
        super();
        this.p = p;
        this.n = n;
        this.col = col;
        this.col_name = col_name;
        this.XU0(p.value);
    }
    XR0() {
        this.sorted = [];
        this.view.XU0(this.view.value = []);
    }
    XU0(value) {
        if (typeof value !== 'object')
            return this.XR0();
        this.sorted = Object
            .keys(value)
            .sort((a, b) => {
            const va = this.col(value[a]);
            const vb = this.col(value[b]);
            return va > vb ? -1
                : va < vb ? 1
                    : 0;
        });
        this.view.XU0(this.view.value = this.sorted
            .slice(0, this.n)
            .map(i => value[i]));
    }
    BR1(R1) {
        for (let i = 0; i < R1.length; i++) {
            const oidx = this.get_index(R1[i++]);
            this.sorted.splice(oidx, 1);
            if (oidx >= this.n)
                return;
            super.BR1A([oidx]);
            const len = this.view.value.length;
            if (this.sorted.length > len)
                super.BI0A([len, this.p.value[this.sorted[len]]]);
        }
    }
    BU1(U1) {
        for (let i = 0; i < U1.length; i++) {
            const name = U1[i++];
            const value = U1[i];
            const { n, p, sorted } = this;
            let oidx = this.get_index(name);
            if (oidx === -1) {
                this.BI0([name, value]);
                continue;
            }
            let nidx = this.find(this.col(this.p.value[name]));
            if (oidx === nidx) {
                super.BU1([oidx, value]);
                continue;
            }
            if (nidx > oidx)
                nidx--;
            sorted.splice(oidx, 1);
            sorted.splice(nidx, 0, name);
            if (oidx >= n && nidx >= n) { }
            else if (oidx >= n && nidx < n) {
                super.BR1A([n - 1]);
                super.BI0A([nidx, p.value[sorted[nidx]]]);
            }
            else if (oidx < n && nidx >= n) {
                super.BR1A([oidx]);
                super.BI0A([n - 1, p.value[sorted[n - 1]]]);
            }
            else if (oidx < n && nidx < n) {
                const lo = oidx < nidx ? oidx : nidx;
                const hi = oidx < nidx ? nidx : oidx;
                for (let idx = lo; idx <= hi; idx++) {
                    super.BU1(['' + idx, p.value[sorted[idx]]]);
                }
            }
        }
    }
    BI0(I0) {
        for (let i = 0; i < I0.length; i++) {
            const at = I0[i++];
            const value = I0[i];
            const new_idx = this.find(this.col(this.p.value[at]));
            this.sorted.splice(new_idx, 0, at);
            if (new_idx >= this.n)
                return;
            if (this.view.value.length === this.n)
                super.BR1A([this.n - 1]);
            super.BI0A([new_idx, value]);
        }
    }
    BR2(R2) {
        for (let i = 0; i < R2.length; i++) {
            const [name, col, ...rest] = R2[i++];
            const value = R2[i];
            if (col === this.col_name) {
                this.BU1([name, this.p.value[name]]);
            }
            else {
                const oidx = this.get_index(name);
                if (oidx < this.n)
                    this.view.BR2([[`${oidx}`, col, ...rest], value]);
            }
        }
    }
    BU2(U2) {
        for (let i = 0; i < U2.length; i++) {
            const [name, col, ...rest] = U2[i++];
            const value = U2[i];
            if (col === this.col_name) {
                this.BU1([name, this.p.value[name]]);
            }
            else {
                const oidx = this.get_index(name);
                if (oidx < this.n) {
                    this.view.BU2([[`${oidx}`, col, ...rest], value]);
                }
            }
        }
    }
    BI2(I2) {
        for (let i = 0; i < I2.length; i++) {
            const [name, ...rest] = I2[i++];
            const value = I2[i++];
            const at = I2[i];
            if (!this.has(name)) {
                this.BI0([name, this.p.value[name]]);
                continue;
            }
            const nidx = this.get_index(name);
            if (nidx >= this.n)
                continue;
            this.view.BI2([[`${nidx}`, ...rest], value, at]);
        }
    }
    get_index(id) {
        return this.sorted.indexOf(id);
    }
    has(id) { return !!~this.get_index(id); }
}
ZAValue.prototype.find = bisect_right;
export class ZAColumnValue extends ZAValue {
    constructor(p, col, n = Infinity) {
        super(p, d => d[col], col, n);
    }
}
export class ZANumberValue extends ZAValue {
    constructor(p, n = Infinity) {
        super(p, d => d, value, n);
    }
}
export class LimitValue extends Operator {
    constructor(p, n) {
        super();
        this.p = p;
        this.n = n;
        this.XU0(this.p.value);
    }
    XR0() { this.XU0(this.p.value); }
    BU1(U1) { if (U1[0] < this.last)
        this.XU0(this.p.value); }
    BI0(I0) { if (I0[0] < this.last || this.view.value.length < this.n)
        this.XU0(this.p.value); }
    BR1(R1) { if (R1[0] < this.last || this.view.value.length < this.n)
        this.XU0(this.p.value); }
    XU0(value) {
        this.view.value = [];
        this.index = [];
        if (typeof value === 'object') {
            if (isArray(value)) {
                let i = -1;
                while (i < value.length) {
                    if (value[++i] !== undefined) {
                        this.view.value.push(value[i]);
                        this.index.push(i);
                        if (this.view.value.length === this.n)
                            break;
                    }
                }
            }
            else {
                for (const i in value) {
                    if (value[i] !== undefined) {
                        this.view.value.push(value[i]);
                        this.index.push(i);
                        if (this.view.value.length === this.n)
                            break;
                    }
                }
            }
        }
        this.last = this.index.at(-1);
        this.view.XU0(this.view.value);
    }
}
export const sort = (source, a, b) => {
    const Class = typeof a === 'string' ? ZAColumnValue : ZANumberValue;
    return createOperator(source, Class, a, b);
};
export const limit = (source, n) => createOperator(source, LimitValue, n);
