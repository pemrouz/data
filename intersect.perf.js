// @ts-nocheck
import { ok } from 'node:assert';
import { test } from 'node:test';
import { $ } from "./core.js";
import { intersect } from "./intersect.js";
const REPS = 5;
const measure = (fn, reps = REPS) => {
    const times = [];
    for (let i = 0; i < reps; i++) {
        const t0 = performance.now();
        fn();
        times.push(performance.now() - t0);
    }
    return [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)];
};
function makeData(n) {
    const obj = {};
    for (let i = 0; i < n; i++)
        obj[i] = `v${i}`;
    return obj;
}
test('intersect setup - 10000 rows 3 sources', () => {
    const elapsed = measure(() => {
        const a = $(makeData(10000));
        const b = $(makeData(8000));
        const c = $(makeData(6000));
        intersect(a, b, c);
    });
    console.log(`  intersect setup 10k x3: ${elapsed.toFixed(2)}ms`);
    ok(elapsed < 500);
});
test('intersect filter update - remove 1000 from b', () => {
    const a = $(makeData(10000));
    const b = $(makeData(8000));
    const c = $(makeData(6000));
    intersect(a, b, c);
    const elapsed = measure(() => {
        for (let i = 0; i < 1000; i++)
            delete b[i];
        for (let i = 0; i < 1000; i++)
            b[i] = `v${i}`;
    });
    console.log(`  intersect update 10k: ${elapsed.toFixed(2)}ms`);
    ok(elapsed < 200);
});
