// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert';
import { test } from 'node:test';
import { $, value } from "../../core.js";
import { sort } from "./index.js";
const max = (a, b) => a > b ? a : b;
$.random = o => 1 + Object.keys(o).map(Number).sort().reduce(max, -1);
test('sort (za) - insert/update/remove', () => {
    const data = $({
        10: { fooo: 1, date: 1 }, 40: { fooo: 4, date: 4 },
        30: { fooo: 3, date: 3 }, 20: { fooo: 2, date: 2 },
        50: { fooo: 5, date: 5 },
    });
    const res = sort(data, 'date', 3);
    const changes1 = res.connect([]);
    const changes2 = res[0].connect([]);
    const changes3 = res[1].connect([]);
    const changes4 = res[2].connect([]);
    const changes5 = res[3].connect([]);
    same(res[value], [
        { fooo: 5, date: 5 }, { fooo: 4, date: 4 }, { fooo: 3, date: 3 },
    ]);
    data.insert({ fooo: 0, date: 0 });
    same(res[value], [{ fooo: 5, date: 5 }, { fooo: 4, date: 4 }, { fooo: 3, date: 3 }]);
    data.insert({ fooo: [], date: 6 });
    same(res[value], [{ fooo: [], date: 6 }, { fooo: 5, date: 5 }, { fooo: 4, date: 4 }]);
    data[52].fooo.insert(1);
    same(res[value], [{ fooo: [1], date: 6 }, { fooo: 5, date: 5 }, { fooo: 4, date: 4 }]);
    data[value] = {
        10: { fooo: 1, date: 1 }, 40: { fooo: 4, date: 4 },
        30: { fooo: 3, date: 3 }, 20: { fooo: 2, date: 2 }, 50: { fooo: 5, date: 5 },
    };
    same(res[value], [{ fooo: 5, date: 5 }, { fooo: 4, date: 4 }, { fooo: 3, date: 3 }]);
    data[40].fooo = 40;
    same(res[value], [{ fooo: 5, date: 5 }, { fooo: 40, date: 4 }, { fooo: 3, date: 3 }]);
    data[10].fooo = 10;
    same(res[value], [{ fooo: 5, date: 5 }, { fooo: 40, date: 4 }, { fooo: 3, date: 3 }]);
    data[10].date = 10;
    same(res[value], [{ fooo: 10, date: 10 }, { fooo: 5, date: 5 }, { fooo: 40, date: 4 }]);
    data[10].date = 4;
    same(res[value], [{ fooo: 5, date: 5 }, { fooo: 40, date: 4 }, { fooo: 10, date: 4 }]);
    data[40].date = 0;
    same(res[value], [{ fooo: 5, date: 5 }, { fooo: 10, date: 4 }, { fooo: 3, date: 3 }]);
    data[value] = {
        10: { fooo: 1, date: 1 }, 40: { fooo: 4, date: 4 },
        30: { fooo: 3, date: 3 }, 20: { fooo: 2, date: 2 }, 50: { fooo: 5, date: 5 },
    };
    same(res[value], [{ fooo: 5, date: 5 }, { fooo: 4, date: 4 }, { fooo: 3, date: 3 }]);
    delete data[50].fooo;
    same(res[value], [{ date: 5 }, { fooo: 4, date: 4 }, { fooo: 3, date: 3 }]);
    delete data[10].fooo;
    same(res[value], [{ date: 5 }, { fooo: 4, date: 4 }, { fooo: 3, date: 3 }]);
    delete data[20];
    same(res[value], [{ date: 5 }, { fooo: 4, date: 4 }, { fooo: 3, date: 3 }]);
    delete data[40];
    same(res[value], [{ date: 5 }, { fooo: 3, date: 3 }, { date: 1 }]);
    delete data[value];
    same(res[value], []);
});
