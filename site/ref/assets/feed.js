/* Shared reactive feed for the landing page.
 *
 * One `$(trades)` proxy, one streaming engine. Every live panel on the page —
 * the operator gallery, the "this page runs on data" counter — derives from
 * this single source, so the whole site is itself a `data` graph. Imported by
 * operators.js and landing.js; the hero (hero.js) keeps its own larger graph.
 *
 * Hand-written `.js` with no `.ts` sibling (see CLAUDE.md). */

import { $, value, render, HTML, SVG } from 'data/full'

export { $, value, render, HTML, SVG }

export const { div, span, ul, li, b } = HTML
export const { svg: svgEl, rect, line, text, circle, g } = SVG

export const $$ = (sel, root = document) => root.querySelector(sel)

/* ---------- formatters shared across panels ---------- */

export const fmt2     = v => Number(v).toFixed(2)
export const fmtPnl   = p => (p > 0 ? '+' : '') + Math.round(p).toLocaleString()
export const fmtMoney = v => v === undefined ? '—'
                          : (v > 0 ? '+' : '') + Math.round(v).toLocaleString()
export const fmtAvg   = v => v === undefined ? '—' : (v > 0 ? '+' : '') + v.toFixed(0)
export const fmtBool  = b => b ? 'true' : 'false'

/* Tiny inline-token helpers for the live-updating code captions. */
export const STR = s => `<span class="tok-str">'${s}'</span>`
export const NUM = n => `<span class="tok-num">${n}</span>`

export const TENORS = ['1Y', '2Y', '5Y', '10Y', '30Y']

/* ---------- the source ---------- */

const TRADE_DEFS = [
  { id: 'USD-1Y',  tenor: '1Y'  },
  { id: 'USD-5Y',  tenor: '5Y'  },
  { id: 'USD-10Y', tenor: '10Y' },
  { id: 'USD-30Y', tenor: '30Y' },
  { id: 'EUR-2Y',  tenor: '2Y'  },
  { id: 'EUR-5Y',  tenor: '5Y'  },
  { id: 'EUR-10Y', tenor: '10Y' },
  { id: 'GBP-5Y',  tenor: '5Y'  },
  { id: 'GBP-10Y', tenor: '10Y' },
  { id: 'JPY-10Y', tenor: '10Y' },
]

export const trades = $(TRADE_DEFS.map(({ id, tenor }) => {
  const base = 1 + Math.random() * 5
  return {
    id, tenor,
    bid:  +(base - 0.05 - Math.random() * 0.05).toFixed(2),
    ask:  +(base + 0.05 + Math.random() * 0.05).toFixed(2),
    last: +base.toFixed(2),
    pnl:  Math.round((Math.random() - 0.5) * 3000),
  }
}))

/* Path of the most recent mutation, surfaced in the hero/explainer captions. */
export const lastTick = $('—')

/* ---------- streaming engine ---------- */

const NUM_FIELDS = ['bid', 'ask', 'last', 'pnl']
let streaming = true
let streamId = null
const tickListeners = new Set()

/** Register a callback fired after each applied mutation: fn({ row, field }). */
export function onTick (fn) { tickListeners.add(fn); return () => tickListeners.delete(fn) }

export function mutateOnce () {
  const N = trades[value].length
  const i = (Math.random() * N) | 0
  const f = NUM_FIELDS[(Math.random() * NUM_FIELDS.length) | 0]
  const row = trades[i]
  const cur = row[f][value]
  const fmt = f === 'pnl' ? fmtPnl : fmt2
  let next
  if (f === 'pnl') {
    const raw = Math.round(cur + (Math.random() - 0.5) * 600)
    next = Math.max(-1900, Math.min(1900, raw))
  } else {
    const raw = cur + (Math.random() - 0.5) * 0.08
    next = +Math.max(0.5, raw).toFixed(2)
  }
  // Skip if the formatted display wouldn't change — reactive .to() already
  // dedupes the DOM text update, so flashing here would be noise.
  if (fmt(cur) === fmt(next)) return
  row[f].update(next)
  lastTick[value] = `trades[${i}].${f} = ${fmt(next)}`
  const id = row.id[value]
  for (const fn of tickListeners) fn({ row: i, field: f, id })
}

function streamTick () {
  if (!streaming || document.visibilityState === 'hidden') return
  mutateOnce(); mutateOnce()
}

export function startStream () { if (!streamId) streamId = setInterval(streamTick, 90) }
export function stopStream  () { if (streamId) { clearInterval(streamId); streamId = null } }
export function isStreaming () { return streaming }
export function setStreaming (on) {
  streaming = on
  if (streaming) startStream(); else stopStream()
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') stopStream()
  else if (streaming) startStream()
})

/* Flash only the cell(s) whose displayed value depends on the changed field.
 * A cell tagged data-fields="bid" flashes on bid ticks; data-fields="bid ask"
 * (e.g. map's spread column) flashes on either. */
export function flashOperatorCell (tradeId, field) {
  const sel = `[data-trade-id="${tradeId}"] [data-fields~="${field}"]`
  document.querySelectorAll(sel).forEach(cell => {
    cell.classList.remove('flash')
    void cell.offsetWidth
    cell.classList.add('flash')
  })
}

startStream()
