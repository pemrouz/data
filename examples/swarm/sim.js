// sim.js — a pure plain-JS SIRS epidemic over a moving population.
//
// This file knows NOTHING about `data`. It owns the hot O(N) numeric core the
// two-tier discipline deliberately keeps OUT of the reactive layer: typed-array
// position integration, a spatial-hash transmission pass, and SIRS state logic.
//
// The bridge to the reactive layer is the `dirty` list `step()` fills. Instead
// of letting the reactive graph re-read N rows every frame, `step()` records the
// id of every agent that changed something DISCRETE this frame — a state flip, a
// coarse-grid cell crossing, or an energy-band crossing — deduped, so an agent
// that flipped AND crossed a cell appears once. The caller turns the list into
// one batched whole-row `patch` (operators see a single BU1 carrying every dirty
// row), so the per-frame cost is one dispatch per sink, not one per agent.
// Most agents move a sub-cell distance per frame and stay clean.

const SC = ['S', 'I', 'R'] // state code → char (0 = susceptible, 1 = infected, 2 = recovered)

export function createSim({
  n = 12000,
  grid = 16,       // coarse GRID×GRID cells — the region/cohort resolution
  infGrid = 120,   // fine cells for neighbour lookup (cell size ≈ infection radius)
  bands = 20,      // energy-histogram bands
  speed = 0.0003,  // slow drift — cell crossings are the dominant event, so a
                   // low speed keeps the per-frame event volume (and thus the
                   // reactive cascade) bounded. The epidemic still sweeps the
                   // field through contact, which is the motion that matters.
  infectProb = 0.04, // mild enough that the infected band stays a thin sweeping
                     // wave (a few %) instead of overshooting into a big blob
                     // whose flip-rate would spike the event volume.
  recover = 95,    // frames infected before → R
  immunity = 210,  // frames recovered before → S (SIRS keeps the waves alive)
  drainEnergy = 0.6,
  seed = 1,
} = {}) {
  // mulberry32 — deterministic so the demo is reproducible frame-for-frame
  let s = seed >>> 0
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const x = new Float32Array(n)
  const y = new Float32Array(n)
  const vx = new Float32Array(n)
  const vy = new Float32Array(n)
  const state = new Uint8Array(n)
  const clock = new Float32Array(n) // frames spent in the current state
  const energy = new Float32Array(n)

  // last-emitted discretisations, so we only report a change on a real crossing
  const lgx = new Int16Array(n)
  const lgy = new Int16Array(n)
  const leb = new Int16Array(n)
  const BANDW = 100 / bands

  const cellOf = (v) => {
    const c = (v * grid) | 0
    return c < 0 ? 0 : c >= grid ? grid - 1 : c
  }
  const bandOf = (e) => {
    const b = (e / BANDW) | 0
    return b < 0 ? 0 : b >= bands ? bands - 1 : b
  }

  for (let i = 0; i < n; i++) {
    x[i] = rnd()
    y[i] = rnd()
    const a = rnd() * Math.PI * 2
    vx[i] = Math.cos(a) * speed
    vy[i] = Math.sin(a) * speed
    energy[i] = 70 + rnd() * 30
    lgx[i] = cellOf(x[i])
    lgy[i] = cellOf(y[i])
    leb[i] = bandOf(energy[i])
  }
  // seed an infected cluster in one corner; the wavefront sweeps out from here
  for (let i = 0; i < n; i++) {
    if (x[i] < 0.1 && y[i] < 0.1) {
      state[i] = 1
      energy[i] = 45
      leb[i] = bandOf(energy[i])
    }
  }

  // infection grid — rebuilt each frame as head/next linked lists (counting sort)
  const head = new Int32Array(infGrid * infGrid)
  const next = new Int32Array(n)
  const radius2 = (1 / infGrid) * (1 / infGrid)

  // counts kept here only for the rate-counter HUD; the reactive layer keeps its own
  const counts = new Int32Array(3)
  for (let i = 0; i < n; i++) counts[state[i]]++

  // dirty list — ids of agents that changed something reportable this frame,
  // deduped via dflag, reused across frames and drained by the caller.
  const dirty = []
  const dflag = new Uint8Array(n)
  const mark = (i) => { if (!dflag[i]) { dflag[i] = 1; dirty.push(i) } }

  function step(dt) {
    for (let k = 0; k < dirty.length; k++) dflag[dirty[k]] = 0
    dirty.length = 0
    const onState = mark
    const onCell = mark
    const onEnergy = mark
    // 1) integrate positions + bucket into the infection grid
    head.fill(-1)
    for (let i = 0; i < n; i++) {
      let nx = x[i] + vx[i] * dt
      let ny = y[i] + vy[i] * dt
      if (nx < 0) { nx = -nx; vx[i] = -vx[i] } else if (nx > 1) { nx = 2 - nx; vx[i] = -vx[i] }
      if (ny < 0) { ny = -ny; vy[i] = -vy[i] } else if (ny > 1) { ny = 2 - ny; vy[i] = -vy[i] }
      x[i] = nx
      y[i] = ny
      const ix = Math.min(infGrid - 1, (nx * infGrid) | 0)
      const iy = Math.min(infGrid - 1, (ny * infGrid) | 0)
      const c = iy * infGrid + ix
      next[i] = head[c]
      head[c] = i
      clock[i] += dt
    }

    // 2) transmission — each infected agent infects nearby susceptibles
    for (let i = 0; i < n; i++) {
      if (state[i] !== 1) continue
      const ix = Math.min(infGrid - 1, (x[i] * infGrid) | 0)
      const iy = Math.min(infGrid - 1, (y[i] * infGrid) | 0)
      for (let cy = Math.max(0, iy - 1); cy <= Math.min(infGrid - 1, iy + 1); cy++) {
        for (let cx = Math.max(0, ix - 1); cx <= Math.min(infGrid - 1, ix + 1); cx++) {
          for (let j = head[cy * infGrid + cx]; j !== -1; j = next[j]) {
            if (state[j] !== 0) continue
            const dx = x[j] - x[i]
            const dy = y[j] - y[i]
            if (dx * dx + dy * dy <= radius2 && rnd() < infectProb) {
              state[j] = 1
              clock[j] = 0
              counts[0]--; counts[1]++
              onState(j)
            }
          }
        }
      }
    }

    // 3) recovery / waning, energy drift, and crossing detection
    for (let i = 0; i < n; i++) {
      const st = state[i]
      if (st === 1) {
        energy[i] -= drainEnergy * dt
        if (energy[i] < 0) energy[i] = 0
        if (clock[i] >= recover) { state[i] = 2; clock[i] = 0; counts[1]--; counts[2]++; onState(i) }
      } else if (st === 2) {
        energy[i] += 0.3 * dt
        if (energy[i] > 100) energy[i] = 100
        if (clock[i] >= immunity) { state[i] = 0; clock[i] = 0; counts[2]--; counts[0]++; onState(i) }
      } else {
        energy[i] += 0.2 * dt
        if (energy[i] > 100) energy[i] = 100
      }

      const gx = cellOf(x[i])
      const gy = cellOf(y[i])
      if (gx !== lgx[i] || gy !== lgy[i]) { lgx[i] = gx; lgy[i] = gy; onCell(i) }

      const eb = bandOf(energy[i])
      if (eb !== leb[i]) { leb[i] = eb; onEnergy(i) }
    }
  }

  // initial snapshot used to seed the reactive proxy once at mount
  const rows = () => {
    const out = new Array(n)
    for (let i = 0; i < n; i++) {
      out[i] = { state: SC[state[i]], gx: lgx[i], gy: lgy[i], energy: leb[i] * BANDW }
    }
    return out
  }

  // expose the per-agent discretised columns so the caller can build a row
  // snapshot for each dirty id without re-deriving them
  return {
    n, grid, bands, BANDW, SC,
    x, y, state, energy, counts,
    gx: lgx, gy: lgy, eband: leb,
    dirty, cellOf, bandOf, step, rows,
  }
}
