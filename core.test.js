// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert';
import { test } from 'node:test';
import { $, value } from "./core.js";
const max = (a, b) => a > b ? a : b;
$.random = o => 1 + Object.keys(o).map(Number).sort().reduce(max, -1);
test('update (val, val)', () => {
    const res = $(5);
    const changes = res.connect([]);
    res[value] = 10;
    res.update(20);
    same(changes, [
        { type: 'update', key: [], value: 5 },
        { type: 'update', key: [], value: 10 },
        { type: 'update', key: [], value: 20 },
    ]);
    same(res[value], 20);
});
test('insert (val, val)', () => {
    const res = $(5);
    const changes1 = res.connect([]);
    const changes2 = res[0].connect([]);
    const changes3 = res[1].connect([]);
    res.insert(10);
    res.insert(20);
    same(changes1, [
        { type: 'update', key: [], value: 5 },
        { type: 'insert', key: [], value: 10, at: '0' },
        { type: 'insert', key: [], value: 20, at: '1' }
    ]);
    same(changes2, [
        { type: 'update', key: [], value: undefined },
        { type: 'update', key: [], value: 10 }
    ]);
    same(changes3, [
        { type: 'update', key: [], value: undefined },
        { type: 'update', key: [], value: 20 }
    ]);
    same(res[value], { 0: 10, 1: 20 });
    same(res[0][value], 10);
    same(res[1][value], 20);
});
test('remove (val, val)', () => {
    const res = $(5);
    const changes1 = res.connect([]);
    const changes2 = res.a.connect([]);
    delete res[value];
    delete res[value];
    same(changes1, [
        { type: 'update', key: [], value: 5 },
        { type: 'remove', key: [], value: 5 }
    ]);
    same(changes2, [
        { type: 'update', key: [], value: undefined }
    ]);
    same(res[value], undefined);
});
test('update (val, dir)', () => {
    const res = $(5);
    const changes1 = res.connect([]);
    const changes2 = res.a.connect([]);
    res[value] = { a: 1 };
    res.a = 2;
    same(changes1, [
        { type: 'update', key: [], value: 5 },
        { type: 'update', key: [], value: { a: 1 } },
        { type: 'update', key: ['a'], value: 2 },
    ]);
    same(changes2, [
        { type: 'update', key: [], value: undefined },
        { type: 'update', key: [], value: 1 },
        { type: 'update', key: [], value: 2 }
    ]);
    same(res[value], { a: 2 });
    same(res.a[value], 2);
});
test('proxy/link', () => {
    const c = $({ a: 1 });
    const d = $({ b: 2 });
    const e = $(c);
    const changes1 = c.connect([]);
    const changes2 = d.connect([]);
    const changes3 = e.connect([]);
    same(c[value], { a: 1 });
    same(d[value], { b: 2 });
    same(e[value], { a: 1 });
    e[value] = d;
    c.x = 0;
    same(c[value], { a: 1, x: 0 });
    same(d[value], { b: 2 });
    same(e[value], { b: 2 });
    e.f = 3;
    same(c[value], { a: 1, x: 0 });
    same(d[value], { b: 2, f: 3 });
    same(e[value], { b: 2, f: 3 });
    d.g = 4;
    same(c[value], { a: 1, x: 0 });
    same(d[value], { b: 2, f: 3, g: 4 });
    same(e[value], { b: 2, f: 3, g: 4 });
    delete d.g;
    same(c[value], { a: 1, x: 0 });
    same(d[value], { b: 2, f: 3 });
    same(e[value], { b: 2, f: 3 });
    same(changes1, [
        { type: 'update', key: [], value: { a: 1 } },
        { type: 'insert', key: [], value: 0, at: 'x' }
    ]);
    same(changes2, [
        { type: 'update', key: [], value: { b: 2 } },
        { type: 'insert', key: [], value: 3, at: 'f' },
        { type: 'insert', key: [], value: 4, at: 'g' },
        { type: 'remove', key: ['g'], value: 4 }
    ]);
    same(changes3, [
        { type: 'update', key: [], value: { a: 1 } },
        { type: 'update', key: [], value: { b: 2 } },
        { type: 'insert', key: [], value: 3, at: 'f' },
        { type: 'insert', key: [], value: 4, at: 'g' },
        { type: 'remove', key: ['g'], value: 4 }
    ]);
});
test('array indexing', () => {
    const res = $({ a: [1] });
    const changes1 = res.connect([]);
    const changes2 = res.a.connect([]);
    const changes3 = res.a[0].connect([]);
    const changes4 = res.a[1].connect([]);
    const changes5 = res.a[2].connect([]);
    res.a.insert(3, 0);
    res.a.insert(2, 1);
    delete res.a[1];
    same(changes1, [
        { type: 'update', key: [], value: { a: [1] } },
        { type: 'insert', key: ['a'], value: 3, at: '0' },
        { type: 'insert', key: ['a'], value: 2, at: '1' },
        { type: 'remove', key: ['a', '1'], value: 2 }
    ]);
    same(changes2, [
        { type: 'update', key: [], value: [1] },
        { type: 'insert', key: [], value: 3, at: '0' },
        { type: 'insert', key: [], value: 2, at: '1' },
        { type: 'remove', key: ['1'], value: 2 }
    ]);
    same(changes3, [
        { type: 'update', key: [], value: 1 },
        { type: 'update', key: [], value: 3 }
    ]);
    same(changes4, [
        { type: 'update', key: [], value: undefined },
        { type: 'update', key: [], value: 1 },
        { type: 'update', key: [], value: 2 },
        { type: 'update', key: [], value: 1 }
    ]);
    same(changes5, [
        { type: 'update', key: [], value: undefined },
        { type: 'update', key: [], value: 1 },
        { type: 'update', key: [], value: undefined }
    ]);
    same(res[value], { a: [3, 1] });
});
test('iterator', async () => {
    const res = $([1, 2]);
    const [one, two, three] = res;
    const changes1 = one.connect([]);
    const changes2 = two.connect([]);
    const changes3 = three.connect([]);
    same(one[value], 1);
    same(two[value], 2);
    same(three[value], undefined);
    res.insert(3);
    same(one[value], 1);
    same(two[value], 2);
    same(three[value], 3);
    res[1] = 4;
    same(one[value], 1);
    same(two[value], 4);
    same(three[value], 3);
    delete res[1];
    same(one[value], 1);
    same(two[value], 3);
    same(three[value], undefined);
    same(changes1, [
        { type: 'update', value: 1, key: [] }
    ]);
    same(changes2, [
        { type: 'update', value: 2, key: [] },
        { type: 'update', value: 4, key: [] },
        { type: 'update', value: 3, key: [] }
    ]);
    same(changes3, [
        { type: 'update', value: undefined, key: [] },
        { type: 'update', value: 3, key: [] },
        { type: 'update', value: undefined, key: [] }
    ]);
});
