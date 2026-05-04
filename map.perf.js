// @ts-nocheck
import { ok } from 'node:assert';
import { test } from 'node:test';
import { $ } from "./core.js";
import { map } from "./map.js";
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
        obj[i] = { x: i, y: i * 2 };
    return obj;
}
test('map setup - 10000 rows', () => {
    const elapsed = measure(() => {
        const src = $(makeData(10000));
        map(src, d => d.x + d.y);
    });
    console.log(`  map setup 10k: ${elapsed.toFixed(2)}ms`);
    ok(elapsed < 500);
});
test('map insert - 10000 rows', () => {
    const src = $(makeData(10000));
    map(src, d => d.x + d.y);
    let i = 10000;
    const elapsed = measure(() => {
        src.insert({ x: i, y: i * 2 });
        i++;
    });
    console.log(`  map insert 10k: ${elapsed.toFixed(2)}ms`);
    ok(elapsed < 50);
});
