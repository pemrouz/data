// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert';
import { test } from 'node:test';
import { $, value } from "../../core.js";
import { intersect } from "./index.js";
test('intersect - objects', () => {
    const a = $({ 10: 'a', 20: 'b', 30: 'c' });
    const b = $({ 10: 'a', 20: 'b' });
    const res = intersect(a, b);
    const changes = res.connect([]);
    b[30] = 'x';
    a[40] = 'y';
    b[20] = 'd';
    a[20] = 'e';
    b[value] = { 20: 'g', 30: 'h' };
    delete b[20];
    delete b[value];
    same(changes, [
        { type: 'update', key: [], value: { 10: 'a', 20: 'b' } },
        { type: 'insert', key: [], value: 'c', at: '30' },
        { type: 'update', key: ['20'], value: 'e' },
        { type: 'update', key: [], value: { 20: 'e', 30: 'c' } },
        { type: 'remove', key: ['20'], value: 'e' },
        { type: 'update', key: [], value: {} }
    ]);
    same(res[value], {});
});
// Regression: when one source EXPANDS via XU0 to include rows it didn't
// have at intersect's construction time (e.g. crossfilter's `between`
// resetting from a narrow window back to the full source on reset),
// those new rows have to enter the intersection if every other source
// also has them. Previously intersect tracked filters only for rows in
// p.value at construction, so the expanding source's XU0 left filters[i]
// permanently zero (or NaN, after `undefined & off`) for the freshly
// admitted rows — they could never satisfy the all-bits-set check, and
// in the crossfilter example brushing a date range outside the initial
// filter would silently produce 0 active rows.
test('intersect - source expanding past construction-time tracking', () => {
    const a = $({ 1: 'a', 2: 'b' }); // narrow primary
    const b = $({ 1: 'a', 2: 'b', 3: 'c', 4: 'd' });
    const c = $({ 1: 'a', 2: 'b', 3: 'c', 4: 'd' });
    const res = intersect(a, b, c);
    same(res[value], { 1: 'a', 2: 'b' });
    // Expand `a` to cover the full set; intersection should pick up the
    // newly-admitted rows because they're in b and c too.
    a[value] = { 1: 'a', 2: 'b', 3: 'c', 4: 'd' };
    same(res[value], { 1: 'a', 2: 'b', 3: 'c', 4: 'd' });
    // Shrink back — only rows still in `a` survive.
    a[value] = { 1: 'a' };
    same(res[value], { 1: 'a' });
});
test('intersect - arrays', () => {
    const a = $(['a', 'b', 'c']);
    const b = $(['a', 'b']);
    const res = intersect(a, b);
    const changes = res.connect([]);
    b[2] = 'x';
    a[3] = 'y';
    b[1] = 'd';
    a[1] = 'e';
    b[value] = [, 'g', 'h'];
    delete b[1];
    delete b[value];
    same(changes, [
        { type: 'update', key: [], value: ['a', 'b'] },
        { type: 'insert', key: [], value: 'c', at: '2' },
        { type: 'update', key: ['1'], value: 'e' },
        // After `b[value] = [,'g','h']` index 0 is sparse in b, so intersection
        // excludes index 0 (was incorrectly included by the previous code which
        // iterated all positions of an array regardless of whether they were
        // present in the source).
        { type: 'update', key: [], value: [, 'e', 'c'] },
        { type: 'remove', key: ['1'], value: 'e' },
        { type: 'update', key: [], value: [] }
    ]);
    same(res[value], []);
});
