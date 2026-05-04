// @ts-nocheck
import { isArray, iter } from "./utils.js";
import { Operator, view, createOperator } from "./core.js";
export class IntersectValue extends Operator {
    constructor(p, ...sources) {
        super();
        this.vp = sources[0];
        this.p = p;
        this.sources = new Map([[p, { one: 1, off: ~1 }]]);
        this.all = 1;
        for (const src of sources) {
            const one = 1 << this.sources.size;
            src.connect(this);
            this.sources.set(src[view], { one, off: ~one });
            this.all |= one;
        }
        if (typeof p.value !== 'object') {
            super.XU0();
            return;
        }
        const new_value = isArray(this.p.value) ? [] : {};
        this.filters = isArray(this.p.value) ? [] : {};
        iter(p.value, (i, v) => {
            for (const [res, src] of this.sources) {
                if (i in res.value)
                    this.filters[i] |= src.one;
            }
            if (this.filters[i] === this.all)
                new_value[i] = v;
        });
        this.view.XU0(this.view.value = new_value);
    }
    XR0(_, v) {
        const { off } = this.sources.get(v);
        iter(this.filters, i => this.filters[i] &= off);
        this.view.XU0(this.view.value = isArray(this.view.value) ? [] : {});
    }
    XU0(value, v) {
        const { one, off } = this.sources.get(v);
        this.view.value ??= isArray(this.p.value) ? [] : {};
        if (typeof value !== 'object')
            return super.XU0();
        this.filters ??= isArray(this.p.value) ? [] : {};
        const new_value = isArray(this.p.value) ? [] : {};
        iter(this.filters, (i, v) => this.filters[i] = v & off);
        iter(value, i => {
            if ((this.filters[i] |= one) === this.all)
                new_value[i] = this.p.value[i];
        });
        this.view.XU0(this.view.value = new_value);
    }
    BR1(R1, v) {
        if (!R1.length)
            return;
        const { off } = this.sources.get(v);
        const NR1 = [];
        const zero = this.all & off;
        this.view.value ??= isArray(this.p.value) ? [] : {};
        for (let i = 0; i < R1.length; i += 2) {
            const name = R1[i];
            if ((this.filters[name] & off) === zero) {
                NR1.push(name, this.view.value[name]);
                this.view.value[name] = undefined;
            }
        }
        if (NR1.length)
            this.view.BR1(NR1);
    }
    BU1(U1) {
        if (!U1.length)
            return;
        const { all, filters } = this;
        const NU1 = [];
        for (let i = 0; i < U1.length; i++) {
            const name = U1[i++];
            if (filters[name] === all) {
                const value = this.p.value[name];
                if (value === this.view.value[name])
                    continue;
                this.view.value[name] = value;
                NU1.push(name, value);
            }
        }
        if (NU1.length)
            this.view.BU1(NU1);
    }
    BI0(I0, v) {
        if (!I0.length)
            return;
        const { all, sources, filters } = this;
        const { one } = sources.get(v);
        const me = this.view.value ??= isArray(this.p.value) ? [] : {};
        const NI0 = [];
        for (let i = 0; i < I0.length; i++) {
            const name = I0[i++];
            if ((filters[name] |= one) === all) {
                NI0.push(name, me[name] = this.p.value[name]);
            }
        }
        if (NI0.length)
            this.view.BI0(NI0);
    }
    R2() { }
    U2() { }
    I2() { }
}
export const intersect = (source, ...others) => createOperator(source, IntersectValue, ...others);
