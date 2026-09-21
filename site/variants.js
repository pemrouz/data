/* variants.js — prototype-only. Every section that offers options wraps them:
     <div class="opt" data-section="race">
       <div data-variant="a" data-label="nine engines">…</div>
       <div data-variant="b" data-label="one engine · two workloads">…</div>
     </div>
   ?race=b picks a variant at load; the bottom-right bar switches live and keeps
   the URL in sync (so the picks can be copied as a link). ?all=1 shows every
   variant stacked with a ribbon; ?bar=0 hides the bar (clean screenshots).
   On a switch, the shown variant's root gets a 'variantshow' event and the
   hidden one 'varianthide' — section scripts should pause loops while hidden. */
(() => {
  const url = new URL(location.href)
  const all = url.searchParams.get('all') === '1'
  const showBar = url.searchParams.get('bar') === '1'   // hidden unless asked for (?bar=1)
  // THE PICKS (2026-09-12): the variant a section shows when the URL says nothing.
  const DEFAULTS = { lede: 'b', race: 'd', argument: 'b', operators: 'b', start: 'b', devtools: 'b', contract: 'b', gallery: 'b', wire: 'a' }
  if (all) document.documentElement.classList.add('opt-all')
  const groups = [...document.querySelectorAll('.opt[data-section]')]
  const state = {}
  const fire = (el, type) => el.dispatchEvent(new CustomEvent(type, { bubbles: false }))
  function apply(section, v, initial) {
    const g = groups.find(x => x.dataset.section === section)
    if (!g) return
    state[section] = v
    for (const el of g.querySelectorAll(':scope > [data-variant]')) {
      const on = all || el.dataset.variant === v
      const was = !el.hidden
      el.hidden = !on
      if (on && (!was || initial)) fire(el, 'variantshow')
      if (!on && was) fire(el, 'varianthide')
    }
    if (!initial) {
      const u = new URL(location.href)
      const first = DEFAULTS[section] || g.querySelector(':scope > [data-variant]')?.dataset.variant
      if (v === first) u.searchParams.delete(section); else u.searchParams.set(section, v)
      history.replaceState(null, '', u)
    }
    document.querySelectorAll(`#optbar button[data-s="${section}"]`).forEach(b => b.classList.toggle('on', b.dataset.v === v))
  }
  for (const g of groups) {
    const vs = [...g.querySelectorAll(':scope > [data-variant]')]
    for (const el of vs) {
      if (!el.querySelector(':scope > .opt-ribbon')) {
        const r = document.createElement('span'); r.className = 'opt-ribbon'
        r.textContent = `${g.dataset.section} · ${el.dataset.variant} · ${el.dataset.label || ''}`
        el.prepend(r)
      }
    }
    const want = url.searchParams.get(g.dataset.section) || DEFAULTS[g.dataset.section]
    const v = vs.some(x => x.dataset.variant === want) ? want : vs[0]?.dataset.variant
    if (v) apply(g.dataset.section, v, true)
  }
  if (!groups.length) return
  const bar = document.createElement('div'); bar.id = 'optbar'
  bar.hidden = !showBar
  for (const g of groups) {
    const row = document.createElement('div'); row.className = 'row'
    const b = document.createElement('b'); b.textContent = g.dataset.section; row.append(b)
    for (const el of g.querySelectorAll(':scope > [data-variant]')) {
      const btn = document.createElement('button')
      btn.dataset.s = g.dataset.section; btn.dataset.v = el.dataset.variant
      btn.textContent = el.dataset.variant.toUpperCase()
      btn.title = el.dataset.label || ''
      btn.classList.toggle('on', state[g.dataset.section] === el.dataset.variant)
      btn.addEventListener('click', () => apply(g.dataset.section, el.dataset.variant, false))
      row.append(btn)
    }
    const lab = document.createElement('span'); lab.style.color = '#5c5c58'; lab.style.marginLeft = '4px'
    row.append(lab)
    row.addEventListener('mouseover', (e) => { if (e.target.tagName === 'BUTTON') lab.textContent = e.target.title })
    row.addEventListener('mouseout', () => { lab.textContent = '' })
    bar.append(row)
  }
  const foot = document.createElement('div'); foot.className = 'foot'
  const copy = document.createElement('a'); copy.textContent = 'copy picks'
  copy.addEventListener('click', () => { navigator.clipboard?.writeText(location.href); copy.textContent = 'copied'; setTimeout(() => copy.textContent = 'copy picks', 1200) })
  const allA = document.createElement('a'); allA.textContent = all ? 'one at a time' : 'show all'
  allA.addEventListener('click', () => { const u = new URL(location.href); if (all) u.searchParams.delete('all'); else u.searchParams.set('all', '1'); location.href = u })
  const hide = document.createElement('a'); hide.textContent = 'hide'
  hide.addEventListener('click', () => { bar.hidden = true })
  foot.append(copy, allA, hide)
  bar.append(foot)
  document.body.append(bar)
  window.__variants = { state, apply }
})()
