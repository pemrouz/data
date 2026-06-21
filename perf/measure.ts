// perf/measure.ts — the ONE timing primitive for the whole repo. Two presets,
// never one global default:
//
//   gateMeasure  — lean: no warmup, no gc, median of 5. BYTE-PARITY with the
//                  inline median-of-5 the *.perf.ts gate files each used, so
//                  consolidating onto it does not move any ok() threshold.
//   benchMeasure — warm: one discarded warmup rep + a forced gc between reps,
//                  for low-noise numbers when many graphs run back-to-back in
//                  one process (the cross-library bench and the perf report).
//
// Keep them two presets: a single global default serving both is wrong — the
// gate needs lean for parity; the bench deliberately warms+gcs. comparisons/
// bench/measure.ts is a shim that binds the WARM preset.
import { createRequire } from 'node:module'

const _require = createRequire(import.meta.url)

export function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

// One sampler; presets pick warmup/gc. The per-rep timed region is identical to
// the old inline loop (t0 → fn() → push), so gateMeasure's numbers match it.
export function measureStats(
  fn: () => void,
  { reps = 5, warmup = 0, gc = false }: { reps?: number; warmup?: number; gc?: boolean } = {},
) {
  for (let i = 0; i < warmup; i++) fn()
  const g = gc ? (globalThis as any).gc : null
  const times: number[] = []
  for (let i = 0; i < reps; i++) {
    if (g) g()
    const t0 = performance.now()
    fn()
    times.push(performance.now() - t0)
  }
  return { median: median(times), min: Math.min(...times), times }
}

export const gateMeasure = (fn: () => void, reps = 5) => measureStats(fn, { reps, warmup: 0, gc: false }).median
export const benchMeasure = (fn: () => void, reps = 5) => measureStats(fn, { reps, warmup: 1, gc: true }).median

export function pkgVersion(name: string): string {
  // Try the subpath import first (works for most libs).
  try {
    return _require(`${name}/package.json`).version
  } catch {}
  // Strict-exports packages (e.g. @preact/signals-core) refuse the subpath.
  // Fall back to resolving the entry and walking up to its package.json.
  try {
    const fs = _require('node:fs') as typeof import('node:fs')
    const path = _require('node:path') as typeof import('node:path')
    let dir = path.dirname(_require.resolve(name))
    for (let i = 0; i < 8; i++) {
      const pkg = path.join(dir, 'package.json')
      if (fs.existsSync(pkg)) return JSON.parse(fs.readFileSync(pkg, 'utf8')).version
      const next = path.dirname(dir)
      if (next === dir) break
      dir = next
    }
  } catch {}
  return 'unknown'
}

export type BenchResult = {
  name: string
  version: string
  setup: number
  single: number
  batch: number
  dashboard?: number
  notes?: string
}
