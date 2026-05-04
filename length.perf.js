// @ts-nocheck
import { ok } from 'node:assert';
import { test } from 'node:test';
import { $ } from "./core.js";
import { length } from "./length.js";
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
        obj[i] = { bucket: Math.floor(i / 100), val: i };
    return obj;
}
test('length count - 10000 rows', () => {
    const src = $(makeData(10000));
    const count = length(src);
    let i = 10000;
    const elapsed = measure(() => { src.insert({ bucket: 0, val: i++ }); });
    console.log(`  length insert 10k: ${elapsed.toFixed(2)}ms`);
    ok(elapsed < 50);
});
test('length fn - 10000 rows 100 buckets', () => {
    const elapsed = measure(() => {
        const src = $(makeData(10000));
        length(src, d => d.bucket);
    });
    console.log(`  length-fn setup 10k/100: ${elapsed.toFixed(2)}ms`);
    ok(elapsed < 500);
});
