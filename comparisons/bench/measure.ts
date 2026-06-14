// @ts-nocheck
// Shim — the timing primitive now lives in perf/measure.ts. The cross-library
// bench wants the WARM preset (one warmup rep + forced gc between reps) for
// low-noise peer numbers, so `measure` here binds benchMeasure. Every existing
// *.bench.ts keeps its behaviour unchanged (same `measure`/`median`/`pkgVersion`
// import surface). Do NOT rebind this to the lean gateMeasure — that would
// silently strip warmup+gc from the peer comparison and regress the numbers.
export { median, pkgVersion, benchMeasure as measure } from '../../perf/measure.ts'
export type { BenchResult } from '../../perf/measure.ts'
