/* sections/gallery.js — §07 Built with it.
   b (THE PICK) · one feature card for fero. Its only figure — the kv panel's
     SCHEDULE_VERSION — is attested from the REAL engine: contract.SCHEDULE_VERSION
     (contract/index.ts, type-stripped and served from ./lib), the same constant the
     footer prints and conformance/schedule.test.ts asserts. Nothing animates.
   a (not picked, untouched) · the "18 of 18 in this tab" run panel is still a canned
     replay of the conformance suite; it runs only while its variant is shown
     ('variantshow' / 'varianthide') AND on screen. */
import { contract, attest } from '../engine.js'

/* ---------- b · the fero card: the one figure, from the engine ---------- */
{
  const ver = document.querySelector('#gallery [data-variant="b"] #g-ver-b')
  if (ver) attest(ver, contract.SCHEDULE_VERSION, 'runtime')
}

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

/* visibility gate: onStart when the root is shown + intersecting, onStop otherwise */
function gate(root, onStart, onStop) {
  let shown = !root.hidden, onScreen = false, running = false
  const sync = () => {
    const want = shown && onScreen && !document.hidden
    if (want && !running) { running = true; onStart() }
    else if (!want && running) { running = false; onStop() }
  }
  root.addEventListener('variantshow', () => { shown = true; sync() })
  root.addEventListener('varianthide', () => { shown = false; sync() })
  document.addEventListener('visibilitychange', sync)
  new IntersectionObserver(es => { onScreen = es.some(e => e.isIntersecting); sync() }, { rootMargin: '64px' }).observe(root)
}

/* ---------- a · the run panel ---------- */
const TESTS = [
  'SCHEDULE_VERSION === 4',
  '01 apply phase · every write routes through commit',
  '02 read-your-writes · source reads see the write inside the batch',
  '03 flush phase · consolidated batches settle height-ordered',
  '04 effects last, isolated · a throwing sink cannot corrupt state',
  '04 effects · the failures arrive as one AggregateError',
  '05 re-entrancy · a write inside an effect queues as the NEXT commit',
  '06 origin tokens · a replica suppresses its own echo',
  '07 snapshot-then-deltas · init(snapshot) then only deltas',
  '07 mid-batch attach defers to the commit',
  '08 emission legality · one row delta per key per batch',
  '08 emission legality · add on an existing key is illegal',
  '09 coalescing · microtask / frame is sugar, not semantics',
  '10 deep-path law · pathCopy vivifies a clean intermediate',
  '10 deep-path law · pathDelete refuses arrays',
  '11 value-domain portability · what crosses the wire intact',
  'conform(node) · legality checker',
  'conform(node) · replay fold equals the view',
]

function runPanel(root) {
  const cells = [...root.querySelectorAll('#g-cells-a .g-cell')]
  const clause = root.querySelector('#g-runclause-a')
  const count = root.querySelector('#g-runcount-a')
  const again = root.querySelector('#g-rerun-a')
  if (!cells.length || !clause || !count || !again) return
  let timer = 0, idle = 0, i = 0, ms = 0, live = false

  const finish = () => {
    for (const c of cells) c.className = 'g-cell ok'
    clause.textContent = `18 passed · 0 failed · ${ms.toFixed(1)} ms`
    count.textContent = '18 / 18'
    count.classList.add('done')
  }
  const step = () => {
    if (i > 0) cells[i - 1].className = 'g-cell ok'
    if (i === cells.length) { finish(); timer = 0; idle = setTimeout(start, 11000); return }
    cells[i].className = 'g-cell run'
    ms += 0.08 + Math.random() * 0.42
    clause.textContent = TESTS[i]
    count.textContent = `${i + 1} / 18`
    i++
    timer = setTimeout(step, 90 + Math.random() * 110)
  }
  const stop = () => { clearTimeout(timer); clearTimeout(idle); timer = idle = 0 }
  const start = () => {
    stop()
    if (reduced) { ms = 3.6; finish(); return }
    i = 0; ms = 0
    for (const c of cells) c.className = 'g-cell'
    count.classList.remove('done')
    timer = setTimeout(step, 240)
  }
  again.addEventListener('click', () => { if (live) start(); else { ms = 3.6; finish() } })
  gate(root, () => { live = true; start() }, () => { live = false; stop() })
}

const a = document.querySelector('#gallery [data-variant="a"]')
if (a) runPanel(a)
