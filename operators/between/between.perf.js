// @ts-nocheck
import { ok } from 'node:assert';
import { test } from 'node:test';
import { $ } from "../../core.js";
import { between } from "./index.js";
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
        obj[i] = { val: Math.random() * 1000 };
    return obj;
}
test('between setup - 10000 rows', () => {
    const elapsed = measure(() => {
        const src = $(makeData(10000));
        const bounds = $({ lo: 200, hi: 800 });
        between(src, 'val', [bounds.lo, bounds.hi]);
    });
    console.log(`  between setup 10k: ${elapsed.toFixed(2)}ms`);
    ok(elapsed < 500);
});
test('between narrow filter - 10000 rows', () => {
    const src = $(makeData(10000));
    const bounds = $({ lo: 0, hi: 1000 });
    between(src, 'val', [bounds.lo, bounds.hi]);
    const elapsed = measure(() => {
        bounds.lo = 400;
        bounds.hi = 600;
        bounds.lo = 0;
        bounds.hi = 1000;
    });
    console.log(`  between narrow/widen 10k: ${elapsed.toFixed(2)}ms`);
    ok(elapsed < 100);
});
