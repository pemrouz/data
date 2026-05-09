// @ts-nocheck
// Median-of-5 with a discarded warmup run. If --expose-gc is set we also force a
// collection between reps so retained heap from prior reps doesn't bias later
// timings. The existing *.perf.ts files don't do this; comparison benches do
// because we're running multiple peer libraries back-to-back in one process and
// each leaves its own retained graph behind.

import { createRequire } from 'node:module'

const REPS = 5
const WARMUP = 1

const _require = createRequire(import.meta.url)

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

export function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

export function measure(fn: () => void, reps: number = REPS): number {
  for (let i = 0; i < WARMUP; i++) fn()
  const gc = (globalThis as any).gc
  const times: number[] = []
  for (let i = 0; i < reps; i++) {
    if (gc) gc()
    const t0 = performance.now()
    fn()
    times.push(performance.now() - t0)
  }
  return median(times)
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
