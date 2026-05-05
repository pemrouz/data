// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert';
import { test } from 'node:test';
import { $, value } from "../../core.js";
import { map } from "./index.js";
test('map - update/insert/remove', async () => {
    const res = $({ 0: { num: 1 }, 1: { num: 2 }, 2: { num: 3 } });
    const mapped = map(res, d => d.num * 10);
    const changes = mapped.connect([]);
    res[3] = { num: 4 };
    res[2].insert(5, 'num');
    delete res[1].num;
    delete res[1];
    delete res[value];
    res[value] = { 0: { num: 6 } };
    res[0] = { num: 7 };
    res[0].num = 8;
    same(changes, [
        { type: 'update', key: [], value: { '0': 10, '1': 20, '2': 30 } },
        { type: 'insert', key: [], value: 40, at: '3' },
        { type: 'update', key: ['2'], value: 50 },
        { type: 'update', key: ['1'], value: NaN },
        { type: 'remove', key: ['1'], value: NaN },
        { type: 'remove', key: [], value: { '0': 10, '2': 50, '3': 40 } },
        { type: 'update', key: [], value: { '0': 60 } },
        { type: 'update', key: ['0'], value: 70 },
        { type: 'update', key: ['0'], value: 80 }
    ]);
    same(mapped[value], { '0': 80 });
});
