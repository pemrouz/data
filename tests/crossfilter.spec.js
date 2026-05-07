// @ts-nocheck
import { test, expect } from '@playwright/test';
// Regression test for a DOMSink bug: V8's `for (i in arr)` terminates as
// soon as i ≥ arr.length, so when DOMSink.XU0's removal loop pops the
// tail mid-iteration the for-in cuts short and trailing DOM rows are
// left behind. Brushing the crossfilter charts trips LimitValue's XU0
// fallback (R1.length > n*2), which is what surfaces the bug visually
// as "empty rows" in the flight list.
test('crossfilter brush leaves no stale DOM rows', async ({ page }) => {
    await page.goto('http://127.0.0.1:3000/examples/crossfilter/', { timeout: 60_000 });
    await page.waitForSelector('.list .flight', { timeout: 60_000 });
    // Brush + resize on the time chart — the sequence that originally
    // produced 114 DOM rows for an 80-row dataset, with 34 of them empty.
    const chart = page.locator('.chart').nth(0);
    const box = (await chart.boundingBox());
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await page.mouse.down();
    for (let f = 0.31; f <= 0.7; f += 0.02) {
        await page.mouse.move(box.x + box.width * f, box.y + box.height * 0.5, { steps: 1 });
        await page.waitForTimeout(20);
    }
    await page.mouse.up();
    await page.waitForTimeout(300);
    const handle = chart.locator('.resize.e');
    const hb = (await handle.boundingBox());
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    for (let dx = 0; dx > -120; dx -= 5) {
        await page.mouse.move(hb.x + hb.width / 2 + dx, hb.y + hb.height / 2, { steps: 1 });
        await page.waitForTimeout(15);
    }
    await page.mouse.up();
    await page.waitForTimeout(500);
    const snap = await page.evaluate(() => {
        const w = window;
        const acVal = w.ac[w.v];
        let groupedTotal = 0;
        for (const k of Object.keys(acVal))
            groupedTotal += acVal[k].length;
        const domRows = document.querySelectorAll('.list .flight').length;
        const empties = Array.from(document.querySelectorAll('.list .flight'))
            .filter(r => !r.querySelector('.time').textContent?.trim()).length;
        return { groupedTotal, domRows, empties };
    });
    // DOM row count must match the data; no empty rows allowed.
    expect(snap.empties).toBe(0);
    expect(snap.domRows).toBe(snap.groupedTotal);
});
