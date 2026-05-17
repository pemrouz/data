// Trades-dashboard driver. Drains a single shared tick stream into every
// mounted lib row, samples per-frame wall-clock per lib (its own
// ingest+settle), and pushes the timing into each row's cpu wave.
//
// Per-frame metric (not per-tick) because:
//   (a) every lib pushes the same number of samples per second → waves
//       advance in lockstep, comparison stays honest regardless of where
//       in the loop a lib sits.
//   (b) the metric scales with rate, so cpu reflects the slider position.
//   (c) the implicit threshold is the 16ms frame budget — exceed it and
//       the lib drops frames, which is the question this page answers.
//
// rAF pacing with fractional carry so the displayed rate matches the
// slider exactly even at low rates where ticks-per-frame < 1.

import { makeInitial, makeTickStream, N } from './gen.js'

const LIBS = [
  { src: './lib-data.js' },
  { src: './lib-crossfilter.js' },
  { src: './lib-mobx.js' },
  { src: './lib-rxjs.js' },
  { src: './lib-react.js' },
  { src: './lib-solid.js' },
  { src: './lib-preact.js' },
  { src: './lib-vue.js' },
  { src: './lib-svelte.js' },
]

const grid = document.querySelector('#cards')
const $rate = document.querySelector('#rate')
const $rateOut = document.querySelector('#rate-out')
const $toggle = document.querySelector('#toggle')
const $libToggles = document.querySelector('#lib-toggles')

function rateFromSlider() { return Math.round(Math.pow(10, +$rate.value)) }
$rateOut.textContent = fmtRate(rateFromSlider())
$rate.addEventListener('input', () => { $rateOut.textContent = fmtRate(rateFromSlider()) })

let running = true
$toggle.addEventListener('click', () => {
  running = !running
  $toggle.textContent = running ? 'pause' : 'resume'
  $toggle.dataset.paused = String(!running)
})

// Tick stream shared across all libs — each row sees identical ticks.
const nextTick = makeTickStream(7)
const initial = makeInitial()

// Mount every lib row. Each handle holds the row element, the ingest
// callback, the lib's name (for the visibility toggle), and an `active`
// flag — toggling a lib off skips it in the frame loop. We don't unmount
// because re-mounting from cold would lose the rolling-window state; the
// reactive graph keeps running but doesn't display the card.
const handles = []
for (const { src } of LIBS) {
  let mod
  try {
    mod = await import(src)
  } catch (e) {
    console.error(`[${src}] import failed`, e)
    continue
  }
  const lib = mod.default
  const card = mountCard(lib)
  let handle
  try {
    handle = lib.mount(card, { initial })
  } catch (e) {
    console.error(`[${lib.name}] mount failed`, e)
    card.querySelector('.card-tag').textContent = `failed to mount: ${e?.message ?? e}`
    card.classList.add('card-failed')
    continue
  }
  handles.push({ lib, card, handle, active: true, ticks: 0 })
}

buildLibToggles()

// rAF-driven tick scheduling with fractional carry so low slider rates
// still match the displayed value. One wave sample per frame per lib
// (push 0 if no ticks this frame) so waves advance in lockstep.
let lastFrameT = performance.now()
let pendingFrac = 0
let tpsCounter = { ticks: 0, t0: performance.now() }

function frame() {
  if (!running) { requestAnimationFrame(frame); return }
  const now = performance.now()
  const dt = now - lastFrameT
  lastFrameT = now
  const rate = rateFromSlider()
  const owed = rate * dt / 1000 + pendingFrac
  const ticksThisFrame = Math.floor(owed)
  pendingFrac = owed - ticksThisFrame

  let batch = null
  if (ticksThisFrame > 0) {
    batch = new Array(ticksThisFrame)
    for (let i = 0; i < ticksThisFrame; i++) batch[i] = nextTick()
    tpsCounter.ticks += ticksThisFrame
  }

  for (const h of handles) {
    if (!h.active) { h.handle.pushSample(0); continue }
    let elapsed = 0
    if (batch) {
      const t0 = performance.now()
      for (let i = 0; i < ticksThisFrame; i++) { h.handle.ingest(batch[i]); h.handle.read() }
      elapsed = performance.now() - t0
      h.ticks += ticksThisFrame
    }
    h.handle.pushSample(elapsed)
  }

  if (now - tpsCounter.t0 >= 500) {
    const elapsed = (now - tpsCounter.t0) / 1000
    const tps = (tpsCounter.ticks / elapsed) | 0
    for (const h of handles) h.card.querySelector('[data-target=tps]').textContent = tps
    tpsCounter = { ticks: 0, t0: now }
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

// ----------- DOM helpers -----------

function mountCard(lib) {
  const c = document.createElement('section')
  c.className = 'card'
  c.dataset.lib = lib.name
  c.innerHTML = `
    <div class="card-head">
      <span class="card-name">${escape(lib.name)} <span class="card-version">${escape(lib.version)}</span></span>
      <span class="card-tag">${escape(lib.tag || '')}</span>
      <span class="card-cpu">—</span>
    </div>
    <div class="pane ob-pane">
      <div class="pane-h">order book <span class="pane-h-sub">depth chart + price ladder · 15 levels</span></div>
      <div class="ob-body" data-target="ob">
        <canvas class="ob-depth" data-target="depth"></canvas>
        <div class="ob-ladder" data-target="ladder">
          <div class="ob-ladder-h"><span>price</span><span>qty</span><span>cum</span></div>
        </div>
      </div>
    </div>
    <div class="pane wave-pane">
      <div class="pane-h">cpu per frame <span class="pane-h-sub">peak <span class="peak-val" data-target="peak">—</span> · last 200 frames · shared scale</span></div>
      <canvas data-target="wave"></canvas>
      <div class="wave-baseline">0</div>
    </div>
    <div class="card-foot">
      <div class="foot-stat"><span class="foot-stat-k">liquid</span><span class="foot-stat-v" data-target="liquid">—</span></div>
      <div class="foot-stat"><span class="foot-stat-k">avg bid</span><span class="foot-stat-v" data-target="avg">—</span></div>
      <div class="foot-stat"><span class="foot-stat-k">tps</span><span class="foot-stat-v" data-target="tps">—</span></div>
    </div>
  `
  grid.appendChild(c)
  return c
}

function buildLibToggles() {
  $libToggles.innerHTML = ''
  for (const h of handles) {
    const lbl = document.createElement('label')
    lbl.className = 'lib-toggle'
    lbl.dataset.lib = h.lib.name
    lbl.innerHTML = `<input type="checkbox" checked> ${escape(h.lib.name)}`
    const cb = lbl.querySelector('input')
    cb.addEventListener('change', () => {
      h.active = cb.checked
      h.card.classList.toggle('is-hidden', !cb.checked)
      lbl.classList.toggle('is-off', !cb.checked)
    })
    $libToggles.appendChild(lbl)
  }
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]))
}

function fmtRate(r) {
  if (r >= 1e3) return (r / 1e3).toFixed(1) + 'k'
  return String(r)
}
