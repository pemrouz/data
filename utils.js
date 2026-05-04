// @ts-nocheck
export function iter(o, fn) {
    if (isArray(o)) {
        for (let i = 0; i < o.length; i++)
            fn(i, o[i]);
    }
    else {
        for (const i in o)
            fn(i, o[i]);
    }
}
export const { isArray } = Array;
export const identity = d => d;
export const noop = () => { };
export const U = undefined;
export const left = prop => function bisect(a, v, lo = 0, hi = a.length) {
    while (lo < hi) {
        const mid = lo + hi >>> 1;
        if (prop(a[mid]) < v)
            lo = mid + 1;
        else
            hi = mid;
    }
    return lo;
};
export function bisect_right(v, lo = 0, hi = this.sorted.length) {
    while (lo < hi) {
        const mid = lo + hi >>> 1;
        if (this.col(this.p.value[this.sorted[mid]]) < v)
            hi = mid;
        else
            lo = mid + 1;
    }
    return lo;
}
export function find(a, v, lo = 0, hi = a.length) {
    while (lo < hi) {
        const mid = lo + hi >>> 1;
        if (a[mid] < v)
            lo = mid + 1;
        else
            hi = mid;
    }
    return lo;
}
export function isEmpty(obj) {
    for (const i in obj)
        return false;
    return true;
}
