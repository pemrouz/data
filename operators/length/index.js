// @ts-nocheck
import { isArray, iter } from "../../utils.js";
import { Operator, createOperator } from "../../core.js";
// Two flavours of length: a scalar count of rows (LengthValue) and a
// histogram-by-fn (LengthFnValue). The scalar form just adds/subtracts
// payload sizes on insert/remove — `length/2` because the protocol arrays
// pack [name, value, name, value, ...]. BU1 is a no-op because updating a
// row's value doesn't change the count.
export class LengthValue extends Operator {
    constructor(p) {
        super();
        this.p = p;
        this.view.value = 0;
        this.XU0(p.value);
    }
    XR0() {
        this.view.XU0(this.view.value = 0);
    }
    XU0(value) {
        this.view.value = 0;
        if (isArray(value)) {
            this.view.XU0(this.view.value = value.length);
        }
        else {
            iter(value, () => this.view.value++);
            this.view.XU0(this.view.value);
        }
    }
    BR1(R1) {
        if (!R1.length)
            return;
        this.view.XU0(this.view.value -= R1.length / 2);
    }
    BU1(U1) { }
    BI0(I0) {
        if (!I0.length)
            return;
        this.view.XU0(this.view.value += I0.length / 2);
    }
    BR2() { }
    BU2() { }
    BI2() { }
}
// Histogram-by-fn: each output bucket is `{ value: count }` — a tiny
// reactive object so downstream views (e.g. histogram bars in crossfilter)
// can subscribe to a single counter without re-rendering all bars on every
// change. `mapping[name]` is the bucket each upstream row currently belongs
// to, so cross-bucket moves are decremented from old / incremented into new
// without re-iterating the source.
export class LengthFnValue extends Operator {
    constructor(p, fn) {
        super();
        this.p = p;
        this.fn = fn;
        this.XU0(this.p.value);
    }
    XR0() {
        this.mapping = {};
        this.view.XU0(this.view.value = {});
    }
    XU0(value) {
        const new_value = {};
        this.mapping = {};
        iter(value, (i, v) => {
            if (v === undefined)
                return;
            (this.mapping[i] = new_value[this.fn(v)] ??= { value: 0 }).value++;
        });
        this.view.XU0(this.view.value = new_value);
    }
    BR1(R1) {
        if (!R1.length)
            return;
        const { mapping } = this;
        for (let i = 0; i < R1.length; i++) {
            const n = R1[i++];
            const m = mapping[n];
            if (!m)
                continue;
            m.value--;
            mapping[n] = undefined;
        }
        this.view.XU0(this.view.value);
    }
    BU1(U1) {
        if (!U1.length)
            return;
        const { mapping, view, fn } = this;
        for (let i = 0; i < U1.length; i++) {
            const n = U1[i++];
            const v = U1[i];
            const og = mapping[n];
            const ng = view.value[fn(v)] ??= { value: 0 };
            if (og !== ng) {
                mapping[n] = ng;
                if (og)
                    og.value--;
                ng.value++;
            }
        }
        this.view.XU0(this.view.value);
    }
    BI0(I0) {
        if (!I0.length)
            return;
        const { mapping, view, fn } = this;
        for (let i = 0; i < I0.length; i++) {
            const n = I0[i++];
            const v = I0[i];
            if (v === undefined)
                continue;
            (mapping[n] = view.value[fn(v)] ??= { value: 0 }).value++;
        }
        this.view.XU0(this.view.value);
    }
    BR2() { }
    BU2() { }
    BI2() { }
}
export const length = (source, fn) => createOperator(source, fn ? LengthFnValue : LengthValue, fn);
