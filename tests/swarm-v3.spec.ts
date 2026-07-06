import { test, expect } from '@playwright/test'

// Smoke test for examples/swarm-v3/ — the swarm agent-simulation control room
// on the v3 engine (the patch-throughput showcase). Ports tests/swarm.spec.ts
// scenario-for-scenario (swarm-v3 reuses ../swarm's CSS and every id/class is
// identical — only the URL differs), then adds the v3 proofs DOM sampling
// alone can't show, read through window.__swarm and the shared registry
// symbol Symbol.for('data.v3.node') (the kanban-v3/library-v3 probe idiom):
//   - THE BRIDGE is one patch commit per frame: runtime.onCommit + a connect
//     spy on the raw pop node both count ≤1 settle per animation frame while
//     the sim reports tens of dirty agents per frame — an unbatched bridge
//     (one write per agent) would commit ~events times, not ~frames times;
//   - deck ≡ plain-JS oracle, EXACTLY: a single synchronous evaluate (rAF
//     can't preempt it, so the sim is frozen mid-read) recomputes every panel
//     from the pop[value] snapshot and requires exact equality — the SIR
//     histogram, the energy bands (zero-buckets persist), the filter→length
//     region leaderboard, the some()-over-histogram outbreak flag, avg, the
//     between×2→intersect cohort count/avg, and the limit(120) window whose
//     currentOrder() must match the rendered rows id-for-id (v3 ordered views
//     keep source row keys — the agent ids — so no v2 data-id read-back).

const url = '/examples/swarm-v3/?n=8000'

test('swarm-v3 boots, deck is live, no console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

  await page.goto(url)

  // fixed-slot panels exist
  await expect(page.locator('#hist .hbar')).toHaveCount(20)
  await expect(page.locator('#cohort-rows .cohort-row').first()).toBeVisible()

  const readSIR = () =>
    page.evaluate(() => ({
      S: +document.querySelector('#sir-S .n')!.textContent!.replace(/,/g, ''),
      I: +document.querySelector('#sir-I .n')!.textContent!.replace(/,/g, ''),
      R: +document.querySelector('#sir-R .n')!.textContent!.replace(/,/g, ''),
    }))

  await page.waitForTimeout(1200)
  const t1 = await readSIR()
  await page.waitForTimeout(4500)
  const t2 = await readSIR()

  // The deck is incremental, not frozen at its construction seed (same
  // rationale as the v2 spec — the sim is seeded but frame-timing varies, and
  // SIRS is oscillatory so S is non-monotonic; see tests/swarm.spec.ts):
  //  (1) Sum invariant — S+I+R === n at all times: a length(fn)/patch desync
  //      would drop or double-count agents here.
  //  (2) The recovered bucket — which did NOT exist at construction (every
  //      agent starts S or I) — has been created and populated: length(fn)
  //      re-buckets a state flip carried by a whole-row patch.
  //  (3) The counts MOVED between samples — the deck tracks the live sim.
  expect(t1.S + t1.I + t1.R).toBe(8000)
  expect(t2.S + t2.I + t2.R).toBe(8000)
  expect(t2.R).toBeGreaterThan(0)
  expect(t2.S !== t1.S || t2.I !== t1.I || t2.R !== t1.R).toBe(true)

  // The cohort table is the keyed-list showcase: ≤120 surgically-updated rows.
  const rows = await page.locator('#cohort-rows .cohort-row').count()
  expect(rows).toBeGreaterThan(0)
  expect(rows).toBeLessThanOrEqual(120)

  expect(errors).toEqual([])
})

test('brushing the cloud drives the cohort', async ({ page }) => {
  await page.goto(url)
  await page.waitForTimeout(1500)

  const before = await page.evaluate(
    () => +document.querySelector('#t-cohort')!.textContent!.replace(/,/g, '')
  )

  // drag a fresh box over a different region of the cloud — the pointermove
  // writes flow through the raf() coalescing writers, pointerup flush()es
  const box = (await page.locator('#cloud').boundingBox())!
  await page.mouse.move(box.x + box.width * 0.05, box.y + box.height * 0.05)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.4, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(600)

  await expect(page.locator('#brush')).toBeVisible()
  const after = await page.evaluate(
    () => +document.querySelector('#t-cohort')!.textContent!.replace(/,/g, '')
  )
  // the brushed-cohort count responded to the new selection
  expect(after).not.toBe(before)
})

// ── v3 engine proofs the DOM alone can't show (via window.__swarm) ───────────

test('the bridge is ONE patch commit per frame — not one per dirty agent', async ({ page }) => {
  await page.goto(url)
  await page.waitForFunction(() => !!(window as any).__swarm)
  await page.waitForTimeout(500) // past boot — steady event flow

  // Count runtime commits and pop settles against animation frames and the
  // sim's own event volume. sim.dirty holds the CURRENT frame's dirty ids
  // until the next step() drains it, and our rAF tick is registered after the
  // app's frame loop, so each tick reads the frame that just committed.
  const probe = await page.evaluate(
    () =>
      new Promise<{ commits: number; settles: number; frames: number; events: number }>((resolve) => {
        const w = window as any
        const NODE = Symbol.for('data.v3.node')
        const rt = w.__swarm.pop[NODE].runtime
        let commits = 0
        let settles = 0
        const hook = rt.onCommit(() => commits++)
        // effect spy on the raw source node: fires once per commit pop emits in
        w.__swarm.pop[NODE].connect({ wantsOrder: false, origin: null, apply: () => settles++ })
        let frames = 0
        let events = 0
        const tick = () => {
          frames++
          events += w.__swarm.sim.dirty.length
          if (frames >= 60) {
            hook.dispose()
            resolve({ commits, settles, frames, events })
          } else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
  )

  // the sim was genuinely churning: many dirty agents per frame on average
  // (cell crossings alone run tens per frame at n=8000)
  expect(probe.events).toBeGreaterThan(probe.frames)
  // the deck was live: frames with events committed (≥10 of 60 is very lax)
  expect(probe.commits).toBeGreaterThanOrEqual(10)
  // THE proof: at most one commit per frame (+2 slack for attach/latch skew).
  // An unbatched bridge would commit once per dirty agent — ~events times.
  expect(probe.commits).toBeLessThanOrEqual(probe.frames + 2)
  expect(probe.commits).toBeLessThan(probe.events)
  // and every commit was the pop patch settling exactly once — nothing else
  // writes during a hands-off run (the brush bounds are untouched)
  expect(probe.settles).toBe(probe.commits)
})

test('deck ≡ plain-JS oracle under churn — every view exact, DOM in lockstep', async ({ page }) => {
  await page.goto(url)
  await page.waitForFunction(() => !!(window as any).__swarm)

  // No pause hook needed: a synchronous evaluate can't be preempted by rAF,
  // so pop[value], every derived view, and the DOM (patched synchronously in
  // the same frame() as the patch commit) are all read at ONE sim tick —
  // exact assertions, no tolerance polling. Run it twice across the churn.
  for (const settle of [1500, 2500]) {
    await page.waitForTimeout(settle)
    const res = await page.evaluate(() => {
      const w = window as any
      const sw = w.__swarm
      const V = sw.value // the exported value symbol (Symbol.for('data.v3.value'))
      const NODE = Symbol.for('data.v3.node')
      const GRID = sw.sim.grid as number
      const NB = sw.sim.bands as number
      const BANDW = sw.sim.BANDW as number
      const OUTBREAK = 22 // main.js's alarm threshold
      const rows = sw.pop[V] as { state: string; gx: number; gy: number; energy: number }[]

      // the oracle: recompute every panel from the dense snapshot
      const st: Record<string, number> = {}
      const eb: Record<number, number> = {}
      const reg: Record<number, number> = {}
      let esum = 0
      const [gxLo, gxHi] = sw.sel.get('gx')[V] as [number, number]
      const [gyLo, gyHi] = sw.sel.get('gy')[V] as [number, number]
      const inBrush = (a: { gx: number; gy: number }) =>
        a.gx >= gxLo && a.gx <= gxHi && a.gy >= gyLo && a.gy <= gyHi
      let cN = 0
      let cE = 0
      for (const a of rows) {
        st[a.state] = (st[a.state] || 0) + 1
        const b = Math.min(Math.max((a.energy / BANDW) | 0, 0), NB - 1)
        eb[b] = (eb[b] || 0) + 1
        if (a.state === 'I') {
          const c = a.gy * GRID + a.gx
          reg[c] = (reg[c] || 0) + 1
        }
        esum += a.energy
        if (inBrush(a)) {
          cN++
          cE += a.energy
        }
      }

      // {value:N} bucket views: every view key matches the oracle (a key the
      // oracle lacks must be a persisted zero-bucket) and every oracle key is
      // present with the exact count
      const bucketsMatch = (view: Record<string, { value: number }>, want: Record<string, number>) =>
        Object.keys(view).every((k) => (view[k]?.value || 0) === (want[k] || 0)) &&
        Object.keys(want).every((k) => view[k]?.value === want[k])

      const order = (sw.cohortTable[NODE].currentOrder() ?? []) as (string | number)[]
      const domRows = [...document.querySelectorAll('#cohort-rows .cohort-row')] as HTMLElement[]
      const domIds = domRows.map((el) => (el.querySelector('.cid')?.textContent || '').slice(1))

      return {
        okStates: bucketsMatch(sw.states[V] || {}, st),
        okEbands: bucketsMatch(sw.ebands[V] || {}, eb),
        okRegions: bucketsMatch(sw.regionInf[V] || {}, reg),
        // some() chained over the histogram's {value:N} buckets — both directions
        okOutbreak: !!sw.outbreak[V] === Object.values(reg).some((c) => c >= OUTBREAK),
        okAvg: Math.abs((sw.avgE[V] ?? 0) - esum / rows.length) < 1e-6,
        okCohortN: sw.cohortN[V] === cN,
        // v3 empty-set avg reads undefined — the ternary mirrors the paint guard
        okCohortE: cN
          ? Math.abs((sw.cohortE[V] ?? 0) - cE / cN) < 1e-6
          : sw.cohortE[V] === undefined,
        // the limit window is exactly min(120, cohortN) — zero ghost rows
        okWindowSize: order.length === Math.min(120, cN) && domRows.length === order.length,
        // window keys are agent ids and all genuinely in the brush
        okMembership: order.every((k) => rows[+k] && inBrush(rows[+k])),
        // DOM ≡ view order, id-for-id (the keyed list sink renders in rank order)
        okOrderParity: domIds.every((id, i) => id === String(order[i])),
        // each row's data-state cell is this agent's CURRENT state
        okRowStates: domRows.every((el, i) => {
          const a = rows[+order[i]]
          return !!a && el.getAttribute('data-state') === a.state
        }),
        // the tile painted from the same aggregate agrees with the oracle
        okTile: +(document.querySelector('#t-cohort')!.textContent!.replace(/,/g, '')) === cN,
      }
    })

    expect(res).toEqual({
      okStates: true,
      okEbands: true,
      okRegions: true,
      okOutbreak: true,
      okAvg: true,
      okCohortN: true,
      okCohortE: true,
      okWindowSize: true,
      okMembership: true,
      okOrderParity: true,
      okRowStates: true,
      okTile: true,
    })
  }
})
