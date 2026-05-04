// @ts-nocheck
import { ok } from 'node:assert';
import { $, value } from "./index.js";
import { test } from 'node:test';
import { data as flights500 } from './examples/crossfilter/flights500.js';
import { data as flights50000 } from './examples/crossfilter/flights50000.js';
const { min, max, floor } = Math;
const REPS = 5;
function median(arr) {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[floor(sorted.length / 2)];
}
function measure(fn, reps = REPS) {
    const times = [];
    for (let i = 0; i < reps; i++) {
        const t0 = performance.now();
        fn();
        times.push(performance.now() - t0);
    }
    return median(times);
}
function deterministicRandom(o) {
    return 1 + Object.keys(o).map(Number).sort((a, b) => a - b).reduce((acc, k) => k > acc ? k : acc, -1);
}
function parseDate(d) {
    return new Date(2001, +d.substring(0, 2) - 1, +d.substring(2, 4), +d.substring(4, 6), +d.substring(6, 8));
}
const byDay = d => floor(+d.date / 86400000) * 86400000;
const byHour = d => floor(d.time);
const byTenMins = d => floor(d.delay / 10) * 10;
const byFiftyMiles = d => floor(d.distance / 50) * 50;
const formatDate = d => `${d.date.getMonth()}-${d.date.getDate()}-${d.date.getFullYear()}`;
function buildGraph(data) {
    $.random = deterministicRandom;
    const source = $(data);
    const flights = source.map(({ destination, origin, ...d }) => {
        const date = parseDate(d.date);
        const time = date.getHours() + date.getMinutes() / 60;
        const delay = max(-60, min(149, +d.delay));
        const distance = min(1999, +d.distance);
        return { date, time, delay, distance, origin, destination };
    }).za('date', Infinity);
    const filters = $({
        delay: [],
        distance: [],
        time: [],
        date: [+new Date(2001, 0, 2), +new Date(2001, 2, 1)],
    });
    const byDelay = flights.between('delay', filters.delay);
    const byDistance = flights.between('distance', filters.distance);
    const byDate = flights.between('date', filters.date);
    const byTime = flights.between('time', filters.time);
    const active = byDate.intersect(byDistance, byDelay, byTime);
    const charts = {
        time: byDelay.intersect(byDistance, byDate).length(byHour),
        delay: byDistance.intersect(byDate, byTime).length(byTenMins),
        distance: byDelay.intersect(byDate, byTime).length(byFiftyMiles),
        date: byDelay.intersect(byDistance, byTime).length(byDay),
    };
    const list = active.limit(40).group(formatDate);
    return { flights, filters, active, charts, list };
}
function readViews({ active, charts, list }) {
    void active[value];
    void charts.time[value];
    void charts.delay[value];
    void charts.distance[value];
    void charts.date[value];
    void list[value];
}
// ── setup benchmarks ──────────────────────────────────────────────────────────
test('crossfilter setup - 500 flights', () => {
    const elapsed = measure(() => buildGraph(flights500));
    console.log(`  setup 500: ${elapsed.toFixed(2)}ms`);
    ok(elapsed < 200, `setup took ${elapsed.toFixed(2)}ms, threshold 200ms`);
});
test('crossfilter setup - 50000 flights', () => {
    const elapsed = measure(() => buildGraph(flights50000));
    console.log(`  setup 50000: ${elapsed.toFixed(2)}ms`);
    ok(elapsed < 5000, `setup took ${elapsed.toFixed(2)}ms, threshold 5000ms`);
});
// ── filter update benchmarks ──────────────────────────────────────────────────
test('crossfilter filter update - 500 flights', () => {
    const graph = buildGraph(flights500);
    let toggle = false;
    const elapsed = measure(() => {
        toggle = !toggle;
        graph.filters.delay[value] = toggle ? [-10, 60] : [];
        readViews(graph);
    });
    console.log(`  filter update 500: ${elapsed.toFixed(2)}ms`);
    ok(elapsed < 50, `filter update took ${elapsed.toFixed(2)}ms, threshold 50ms`);
});
test('crossfilter filter update - 50000 flights', () => {
    const graph = buildGraph(flights50000);
    let toggle = false;
    const elapsed = measure(() => {
        toggle = !toggle;
        graph.filters.delay[value] = toggle ? [-10, 60] : [];
        readViews(graph);
    });
    console.log(`  filter update 50000: ${elapsed.toFixed(2)}ms`);
    ok(elapsed < 500, `filter update took ${elapsed.toFixed(2)}ms, threshold 500ms`);
});
// ── multi-filter update benchmark ────────────────────────────────────────────
test('crossfilter multi-filter update - 500 flights', () => {
    const graph = buildGraph(flights500);
    let toggle = false;
    const elapsed = measure(() => {
        toggle = !toggle;
        if (toggle) {
            graph.filters.delay[value] = [-10, 60];
            graph.filters.distance[value] = [200, 1000];
            graph.filters.time[value] = [6, 20];
            graph.filters.date[value] = [+new Date(2001, 0, 15), +new Date(2001, 1, 15)];
        }
        else {
            graph.filters.delay[value] = [];
            graph.filters.distance[value] = [];
            graph.filters.time[value] = [];
            graph.filters.date[value] = [+new Date(2001, 0, 2), +new Date(2001, 2, 1)];
        }
        readViews(graph);
    });
    console.log(`  multi-filter update 500: ${elapsed.toFixed(2)}ms`);
    ok(elapsed < 100, `multi-filter update took ${elapsed.toFixed(2)}ms, threshold 100ms`);
});
