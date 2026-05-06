// @ts-nocheck
import { isArray, iter, isEmpty } from "../../utils.js";
import { Operator, createOperator } from "../../core.js";
export class GroupValue extends Operator {
    constructor(p, fn) {
        super();
        this.p = p;
        this.fn = fn;
        this.XU0(this.p.value);
    }
    static ArrayMapping = class {
        map = [];
        insert(k, v) { this.map.splice(k, 0, v); }
        update(k, v) { this.map[k] = v; }
        remove(k) { this.map.splice(k, 1); }
        get(k) { return this.map[k]; }
    };
    static ObjectMapping = class {
        map = new Map;
        insert(k, v) { this.map.set(k, v); }
        update(k, v) { this.map.set(k, v); }
        remove(k) { this.map.delete(k); }
        get(k) { return this.map.get(k); }
    };
    XR0() {
        this.mapping = undefined;
        this.view.XU0(this.view.value = {});
    }
    XU0(value) {
        this.mapping = isArray(value) ? new GroupValue.ArrayMapping : new GroupValue.ObjectMapping;
        const new_value = {};
        iter(value, (i, v) => {
            const g = this.fn(v);
            this.mapping.update(i, g);
            new_value[g] ??= {};
            new_value[g][i] = v;
        });
        this.view.XU0(this.view.value = new_value);
    }
    BR1(R1) {
        const leaving = new Map();
        for (let i = 0; i < R1.length; i++) {
            const name = R1[i++];
            const group = this.mapping.get(name);
            if (group === undefined) {
                throw new Error('unexpected group r1: ' + name + ' ' + typeof name);
            }
            this.mapping.remove(name);
            const bucket = this.view.value[group];
            if (bucket !== undefined && name in bucket) {
                let leavers = leaving.get(group);
                if (!leavers)
                    leaving.set(group, leavers = {});
                leavers[name] = bucket[name];
                delete bucket[name];
            }
        }
        const NR1 = [];
        const NR2 = [];
        for (const [group, leavers] of leaving) {
            if (isEmpty(this.view.value[group])) {
                NR1.push(group, leavers);
                delete this.view.value[group];
            }
            else {
                for (const name in leavers) {
                    NR2.push([group, name], leavers[name]);
                }
            }
        }
        if (NR1.length)
            this.view.BR1(NR1);
        if (NR2.length)
            this.view.BR2(NR2);
    }
    BU1(U1) {
        const NU2 = [];
        const NI2 = [];
        const leaving = new Map();
        for (let i = 0; i < U1.length; i++) {
            const name = U1[i++];
            const value = U1[i];
            const old_group = this.mapping.get(name);
            const new_group = this.fn(value);
            if (old_group === new_group) {
                NU2.push([new_group, name], this.view.value[new_group][name] = value);
            }
            else {
                if (old_group !== undefined) {
                    // bucket entry may be missing if the inner key drifted upstream
                    // (e.g. LimitValue spliced its array under us); skip the leave
                    // side rather than emit a BR2 with an undefined value
                    const oldVal = this.view.value[old_group]?.[name];
                    if (oldVal !== undefined) {
                        let leavers = leaving.get(old_group);
                        if (!leavers)
                            leaving.set(old_group, leavers = {});
                        leavers[name] = oldVal;
                        delete this.view.value[old_group][name];
                    }
                }
                this.view.value[new_group] ??= {};
                NI2.push([new_group], this.view.value[new_group][name] = value, name);
                this.mapping.update(name, new_group);
            }
        }
        const NR1 = [];
        const NR2 = [];
        for (const [group, leavers] of leaving) {
            if (isEmpty(this.view.value[group])) {
                NR1.push(group, leavers);
                delete this.view.value[group];
            }
            else {
                for (const name in leavers) {
                    NR2.push([group, name], leavers[name]);
                }
            }
        }
        if (NR1.length)
            this.view.BR1(NR1);
        if (NR2.length)
            this.view.BR2(NR2);
        if (NU2.length)
            this.view.BU2(NU2);
        if (NI2.length)
            this.view.BI2(NI2);
    }
    BI0(I0) {
        const NI2 = [];
        for (let i = 0; i < I0.length; i++) {
            const name = I0[i++];
            const value = I0[i];
            const new_group = this.fn(value);
            this.view.value[new_group] ??= {};
            NI2.push([new_group], this.view.value[new_group][name] = value, name);
            this.mapping.insert(name, new_group);
        }
        if (NI2.length)
            this.view.BI2(NI2);
    }
    BR2() { }
    BU2() { }
    BI2() { }
}
export const group = (source, fn) => createOperator(source, GroupValue, fn);
