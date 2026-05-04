// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert';
import { test } from 'node:test';
import { $, value } from "./core.js";
import { to } from "./to.js";
test('to - scalar', async () => {
    const res = $({ a: { b: 1 } });
    const result = to(res, r => r.a.b * 10);
    const changes = result.connect([]);
    res.a.b = 2;
    res.a = { b: 3 };
    res[value] = { a: { b: 4 } };
    same(changes, [
        { type: 'update', key: [], value: 10 },
        { type: 'update', key: [], value: 20 },
        { type: 'update', key: [], value: 30 },
        { type: 'update', key: [], value: 40 },
    ]);
    same(result[value], 40);
});
test('to - nested property', async () => {
    const res = $({ a: { b: 1 } });
    const result = to(res.a, a => a.b * 100);
    const changes = result.connect([]);
    res.a.b = 2;
    res.a = { b: 3 };
    same(changes, [
        { type: 'update', key: [], value: 100 },
        { type: 'update', key: [], value: 200 },
        { type: 'update', key: [], value: 300 },
    ]);
    same(result[value], 300);
});
