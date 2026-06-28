/** @jsx h */
/** @jsxFrag Fragment */
// Chat — a messaging workspace authored in JSX, driven entirely by derived
// reactive views over one source.
//
//   messages = $({})                                     // keyed by message id
//   view     = messages.filter('channel', cur).az('ts')  // the open channel
//   perChan  = messages.length(m => m.channel)           // totals per channel
//
// Switching channels (or typing in search) re-points `view` via the $(view)
// swap. A bot streams messages into random channels; each insert is one keyed
// row added to whichever channel view is open (DOM identity preserved — your
// scroll position and the other rows survive). Reactions are nested in-place
// edits: clicking 😀 bumps `message.reactions[emoji]`, and a <For> over that
// object adds/updates just the affected chip.
import { $, value, render, h, Fragment, For } from 'data/full'

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
const messages = (window as any).messages = $(seedMsgs)
;(window as any).value = value

// current channel + reactive, re-pointable view of its messages
const cur = $('general')
const search = $('')
const view: any = $(buildView())

function buildView() {
  const q = (search[value] as string).trim().toLowerCase()
  let base: any = messages.filter('channel', cur[value])
  if (q) base = base.filter((m: any) => m.text.toLowerCase().includes(q))
  return base.az('ts')
}
function repoint() { view[value] = buildView() }

// per-channel total counts (length(fn) histogram) + unread tracking
const perChannel: any = messages.length((m: any) => m.channel)
const unread = $(Object.fromEntries(CHANNELS.map(c => [c, 0])) as any)

// ── actions ──────────────────────────────────────────────────────────────────
const openChannel = (c: string) => () => {
  cur[value] = c
  unread[c].update(0)          // mark read
  repoint()
}
// Coalesce the search re-point to one rebuild per frame (see kanban's search /
// the library slider): a fast typer fires several input events per frame, but
// `view` only needs to re-point once with the latest query. Channel clicks stay
// immediate (one event each).
let searchPending = false
const onSearch = (ev: any) => {
  search[value] = ev.target.value
  if (searchPending) return
  searchPending = true
  requestAnimationFrame(() => { searchPending = false; repoint() })
}

const send = (text: string) => {
  const t = text.trim(); if (!t) return
  const m = mkMsg(cur[value], 'you', t)
  messages.insert(m, [m.id])
}
const onCompose = (ev: any) => {
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault()
    send(ev.target.value)
    ev.target.value = ''
  }
}

// reaction: read the live message id off the row's data-id (the az view is
// array-keyed, so the For key is positional — not the message id)
const react = (emoji: string) => (ev: any) => {
  const id = ev.target.closest('.msg')?.dataset.id
  if (!id) return
  const m = messages[value][id]
  const next = { ...m.reactions, [emoji]: (m.reactions[emoji] || 0) + 1 }
  messages[id].reactions.update(next)
}

// bot: stream a message into a random channel
const botTick = () => {
  const channel = pick(CHANNELS)
  const m = mkMsg(channel, pick(USERS), pick(LINES))
  messages.insert(m, [m.id])
  if (channel !== cur[value]) unread[channel].update((unread[value] as any)[channel] + 1)
}
let botTimer: any = setInterval(botTick, 1500)

// blast: high-rate batched insert (stress test) via patch
const blast = () => {
  const batch: any[] = []
  for (let i = 0; i < 200; i++) {
    const m = mkMsg(pick(CHANNELS), pick(USERS), pick(LINES))
    batch.push(m.id, m)
  }
  messages.patch(batch)
}
const toggleBot = (ev: any) => {
  if (botTimer) { clearInterval(botTimer); botTimer = null; ev.target.textContent = '▶ bot' }
  else { botTimer = setInterval(botTick, 1500); ev.target.textContent = '⏸ bot' }
}

// ── helpers ──────────────────────────────────────────────────────────────────
// Guard against the transient `undefined` a row's field shows while the row is
// leaving the view during a re-point cascade (the documented sparse-view gotcha
// — the same reason the library example binds defensively). Without the guard,
// `undefined[0]` throws inside the remove cascade and aborts it, leaving stale
// message nodes behind (search/channel-switch then appear not to filter).
const initial = (u: string) => u ? u[0].toUpperCase() : ''
const fmtTime = (ts: number) => {
  const h = 8 + ((ts / 6) | 0) % 12
  const m = (ts * 7) % 60
  return `${h}:${('' + m).padStart(2, '0')}`
}

// ── views ────────────────────────────────────────────────────────────────────
const ChannelRow = (c: string) => (
  <div
    class={{ chan: true, active: cur.to((x: string) => x === c) }}
    onClick={openChannel(c)}
  >
    <span className="chan-hash">#</span>
    <span className="chan-name">{c}</span>
    <span className="chan-count">{perChannel.to((b: any) => `${b[c]?.value ?? 0}`)}</span>
    <span class={{ unread: true, hidden: unread.to((u: any) => !u[c]) }}>
      {unread.to((u: any) => u[c] || '')}
    </span>
  </div>
)

const Message = (msg: any) => (
  <div className="msg" data-id={msg.id}>
    <div className="avatar" style={{ background: msg.user.to((u: string) => COLORS[u] || '#666') }}>
      {msg.user.to(initial)}
    </div>
    <div className="msg-body">
      <div className="msg-head">
        <span className="msg-user" style={{ color: msg.user.to((u: string) => COLORS[u] || '#aaa') }}>
          {msg.user}
        </span>
        <span className="msg-time">{msg.ts.to(fmtTime)}</span>
      </div>
      <div className="msg-text">{msg.text}</div>
      <div className="msg-reactions">
        <For each={msg.reactions} tag="span">
          {(count: any, emoji: any) => (
            <span className="rx"><span className="rx-e">{emoji}</span><span className="rx-n">{count}</span></span>
          )}
        </For>
        <span className="rx-add">
          {EMOJI.map(e => <button className="rx-pick" onClick={react(e)}>{e}</button>)}
        </span>
      </div>
    </div>
  </div>
)

render(document.body, (
  <body>
    <aside className="sidebar">
      <div className="ws-head">
        <div className="ws-name">data·chat</div>
        <div className="ws-sub">reactive workspace</div>
      </div>
      <div className="chan-list">
        {CHANNELS.map(ChannelRow)}
      </div>
      <div className="sidebar-foot">
        <button className="botbtn" onClick={toggleBot}>⏸ bot</button>
        <button className="botbtn" onClick={blast}>⚡ blast 200</button>
      </div>
    </aside>

    <main className="main">
      <header className="chan-header">
        <span className="chan-title">{cur.to((c: string) => `# ${c}`)}</span>
        <span className="chan-meta">{view.to((v: any) => `${Object.keys(v).length} messages`)}</span>
        <span className="spacer" />
        <input className="search" placeholder="Search messages…" onInput={onSearch} />
      </header>

      <div className="messages" id="messages">
        <For each={view} tag="div">
          {(msg: any) => Message(msg)}
        </For>
      </div>

      <footer className="composer">
        <input
          className="compose-input"
          placeholder={cur.to((c: string) => `Message #${c}`)}
          onKeyDown={onCompose}
        />
      </footer>
    </main>
  </body>
))
