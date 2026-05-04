// @ts-nocheck
import { isArray, iter } from "./utils.js";
import { Operator, createOperator } from "./core.js";
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
        this.view.XU0(this.view.value -= R1.length / 2);
    }
    BU1(U1) { }
    BI0(I0) {
        this.view.XU0(this.view.value += I0.length / 2);
    }
    BR2() { }
    BU2() { }
    BI2() { }
}
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
