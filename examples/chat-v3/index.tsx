/** @jsx h */
/** @jsxFrag Fragment */
// Chat, on the v3 engine — the same messaging workspace as ../chat, authored
// in classic JSX (jsxFactory: h) over data/v3: the JSX layer's first browser
// consumer.
//
//   messages  = $({ m1: …, m2: … })                     // ONE source, keyed by message id
//   chanViews = { general: messages.filter(…), … }      // one filter per channel, built ONCE
//   viewSlot  = chanViews.general.mirror()              // the re-pointable slot
//   ordered   = viewSlot.az('ts')                       // the open channel, sorted — built ONCE
//
// Switching channels (or typing in search) is one line — viewSlot.set(view).
// The mirror diffs old vs new snapshot and everything downstream — the az,
// the message count, the keyed <For> list — catches up surgically; rows in
// both channels keep their DOM elements. What v2's chat needed and this one
// doesn't: no per-switch operator rebuilds, no .to() bindings inside the row,
// no transient-undefined guards, no data-id read-back workaround (row keys
// are the stable message ids in every view, source to DOM).

import { $, value, render, text, bind, h, Fragment, For } from 'data/v3'

// ── model ────────────────────────────────────────────────────────────────────
const CHANNELS = ['general', 'random', 'dev', 'design']
const USERS = ['ana', 'bo', 'cy', 'di', 'ek']
const EMOJI = ['👍', '❤️', '😂', '🎉', '🔥']
const COLORS: any = { ana: '#6ea8ff', bo: '#43d6a0', cy: '#e3b341', di: '#f06a5b', ek: '#b98cff', you: '#9aa3b2', bot: '#6b7280' }
const LINES = [
  'shipped the fix', 'anyone reviewing my PR?', 'lunch?', 'tests are green ✅',
  'deploying now', 'nice work everyone', 'found a flaky test', 'standup in 5',
  'can someone unblock me', 'merged', 'good morning ☀️', 'that worked, thanks!',
  'wait, what changed?', 'rolling back', 'looks good to me', '+1',
]

let seed = 42
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
const pick = (a: any[]) => a[(rnd() * a.length) | 0]

let clock = 0
let nextId = 1
const mkMsg = (channel: string, user: string, text: string) => {
  const id = 'm' + nextId++
  return { id, channel, user, text, ts: ++clock, reactions: {} as any }
}

const seedMsgs: any = {}
for (let i = 0; i < 40; i++) {
  const m = mkMsg(pick(CHANNELS), pick(USERS), pick(LINES))
  seedMsgs[m.id] = m
}

// ── the reactive graph ───────────────────────────────────────────────────────

const messages = $(seedMsgs)

// UI state is data too: the open channel, the search query, the bot switch.
const ui = $({ channel: 'general', q: '', bot: true })
const cur = ui.get('channel')

// One filter per channel, created ONCE at startup. A channel switch re-points
// the slot at an EXISTING view — it never mints a new operator.
const chanViews: any = Object.fromEntries(
  CHANNELS.map(c => [c, messages.filter((m: any) => m.channel === c)]),
)

// THE VIEW SLOT. mirror() is v3's re-pointable slot (the v2 $(view) swap,
// done right): az('ts') and length() chain off it ONCE, and the <For> below
// never re-binds — a repoint is emitted as one consolidated diff commit.
const viewSlot = chanViews.general.mirror()
const ordered = viewSlot.az('ts')
const msgCount = viewSlot.length()

// Per-channel totals: a length(fn) histogram. Each bucket is a { value: N }
// wrapper (the documented bucket shape), so a count binding reads b.value.
const perChannel = messages.length((m: any) => m.channel)

// Unread badges: a plain keyed source, bumped by the bot / cleared on open.
const unread = $(Object.fromEntries(CHANNELS.map(c => [c, 0])) as any)

// ── re-pointing the slot ─────────────────────────────────────────────────────

// SEARCH composes a TRANSIENT filter over the current channel view — a fresh
// operator per query. The previous transient is dispose()d right after the
// slot re-points away: v3's answer to the v2 kanban lesson, where undisposed
// per-keystroke operators piled up on the source and every later edit paid
// for all of them. dispose() detaches the node, so the graph stays exactly
// as big as what's on screen.
let transient: any = null
const repoint = () => {
  const { channel, q } = ui[value] as any
  const query = q.trim().toLowerCase()
  const prev = transient
  transient = query
    ? chanViews[channel].filter((m: any) => m.text.toLowerCase().includes(query))
    : null
  viewSlot.set(transient ?? chanViews[channel])
  if (prev) prev.dispose()
}

// ── actions (handlers read CURRENT state through the source) ─────────────────

const openChannel = (c: string) => () => {
  ui.set('channel', c)
  unread.get(c).update(0) // mark read
  repoint() // channel clicks re-point immediately (one event each)
}

// Coalesce search re-points to one per frame (the kanban-search / library-
// slider discipline): a fast typer fires several input events per frame, but
// the slot only needs the LATEST query. The ui write itself is cheap (a few
// text bindings); the transient filter + repoint is the part worth coalescing.
let searchPending = false
const onSearch = (ev: any) => {
  ui.set('q', ev.target.value)
  if (searchPending) return
  searchPending = true
  requestAnimationFrame(() => { searchPending = false; repoint() })
}

const send = (text: string) => {
  const t = text.trim()
  if (!t) return
  const m = mkMsg((ui[value] as any).channel, 'you', t)
  messages.set(m.id, m) // keyed insert — one write, every view catches up
}
const onCompose = (ev: any) => {
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault()
    send(ev.target.value)
    ev.target.value = ''
  }
}

// Reaction bump: the handler closes over the STABLE row id (row keys are
// message ids in every view — no v2 data-id read-back) and reads the CURRENT
// count through the source, never its captured row snapshot (listeners bind
// once per row build; rows patch). The write is path-addressed: one nested
// set lands at reactions[emoji] with copy-on-write structural sharing.
const react = (id: string, emoji: string) => () => {
  const rx = messages.get(id).get('reactions')
  rx.set(emoji, ((rx[value] ?? {})[emoji] ?? 0) + 1)
}

// Bot: stream a message into a random channel; bump unread if it's closed.
const botTick = () => {
  const channel = pick(CHANNELS)
  const m = mkMsg(channel, pick(USERS), pick(LINES))
  messages.set(m.id, m)
  if (channel !== (ui[value] as any).channel)
    unread.get(channel).update((unread[value] as any)[channel] + 1)
}
let botTimer: any = setInterval(botTick, 1500)
const toggleBot = () => {
  if (botTimer) { clearInterval(botTimer); botTimer = null; ui.set('bot', false) }
  else { botTimer = setInterval(botTick, 1500); ui.set('bot', true) }
}

// Blast: 200 keyed inserts as ONE patch batch — pairs are [key, row] TUPLES
// in v3. One commit, one settle per view, one DOM catch-up.
const blast = () => {
  const pairs: [string, any][] = []
  for (let i = 0; i < 200; i++) {
    const m = mkMsg(pick(CHANNELS), pick(USERS), pick(LINES))
    pairs.push([m.id, m])
  }
  messages.patch(pairs)
}

// ── helpers ──────────────────────────────────────────────────────────────────
const fmtTime = (ts: number) => {
  const h = 8 + ((ts / 6) | 0) % 12
  const m = (ts * 7) % 60
  return `${h}:${('' + m).padStart(2, '0')}`
}

// ── views ────────────────────────────────────────────────────────────────────

const ChannelRow = (c: string) => (
  <div class={bind(cur, (x: string) => x === c ? 'chan active' : 'chan')} onClick={openChannel(c)}>
    <span class="chan-hash">#</span>
    <span class="chan-name">{c}</span>
    <span class="chan-count">{text(perChannel.get(c), (b: any) => b?.value ?? 0)}</span>
    <span class={bind(unread.get(c), (n: number) => n ? 'unread' : 'unread hidden')}>
      {text(unread.get(c), (n: number) => n || '')}
    </span>
  </div>
)

// The message row — THE headline readability win over v2 chat. The row fn
// receives PLAIN data (a snapshot, not a proxy), so every cell is a plain
// expression: no .to() bindings, no transient-undefined guards (v2 needed
// `u => u ? u[0] : ''` because a leaving row's fields could flash undefined
// mid-cascade). On a row update the renderer re-runs this fn and diffs the
// output in place. Reactions render statically from the row — no inner <For>:
// a reaction bump arrives as a row update and the list sink reconciles the
// row structurally (the new chip appears; untouched rows never re-render).
const Message = (m: any) => (
  <div class="msg" data-id={m.id}>
    <div class="avatar" style={`background:${COLORS[m.user] || '#666'}`}>
      {m.user[0].toUpperCase()}
    </div>
    <div class="msg-body">
      <div class="msg-head">
        <span class="msg-user" style={`color:${COLORS[m.user] || '#aaa'}`}>{m.user}</span>
        <span class="msg-time">{fmtTime(m.ts)}</span>
      </div>
      <div class="msg-text">{m.text}</div>
      <div class="msg-reactions">
        {Object.entries(m.reactions).map(([emoji, count]) => (
          <span class="rx"><span class="rx-e">{emoji}</span><span class="rx-n">{count}</span></span>
        ))}
        <span class="rx-add">
          {EMOJI.map(e => <button class="rx-pick" onClick={react(m.id, e)}>{e}</button>)}
        </span>
      </div>
    </div>
  </div>
)

render(document.body, (
  <>
    <aside class="sidebar">
      <div class="ws-head">
        <div class="ws-name">data·chat</div>
        <div class="ws-sub">v3 · reactive workspace</div>
      </div>
      <div class="chan-list">
        {CHANNELS.map(ChannelRow)}
      </div>
      <div class="sidebar-foot">
        <button class="botbtn" onClick={toggleBot}>
          {text(ui.get('bot'), (on: boolean) => on ? '⏸ bot' : '▶ bot')}
        </button>
        <button class="botbtn" onClick={blast}>⚡ blast 200</button>
      </div>
    </aside>

    <main class="main">
      <header class="chan-header">
        {/* v3's ordered children make static + reactive text compose in
            order — no v2 single-static-slot trap, but .to()-folding a prefix
            into text() reads best here anyway */}
        <span class="chan-title">{text(cur, (c: string) => `# ${c}`)}</span>
        <span class="chan-meta">{text(msgCount, (n: number) => `${n} messages`)}</span>
        <span class="spacer" />
        <input class="search" placeholder="Search messages…" onInput={onSearch} />
      </header>

      <div class="messages" id="messages">
        {/* THE keyed list. <For> is v3's ONLY iteration form (a bare view
            child is reactive text) and stays the SOLE child of its container
            — the list owns the parent's child order via its anchor. */}
        <For each={ordered}>{(m: any) => Message(m)}</For>
      </div>

      <footer class="composer">
        <input
          class="compose-input"
          placeholder={bind(cur, (c: string) => `Message #${c}`)}
          onKeyDown={onCompose}
        />
      </footer>
    </main>
  </>
))

// debug / test hooks
;(window as any).__chat = { messages, viewSlot, ordered, ui, perChannel, unread, value }
