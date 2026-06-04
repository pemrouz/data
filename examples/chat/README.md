# chat (JSX)

A messaging workspace **authored in JSX**, driven entirely by derived reactive
views over one source.

```jsx
const messages = $({})                                    // keyed by message id
const view     = messages.filter('channel', cur).az('ts') // the open channel
const perChan  = messages.length(m => m.channel)          // counts per channel

<For each={view} tag="div">{msg => <Message {...} />}</For>
```

## What it exercises

- **JSX authoring** (`h` / `Fragment` / `For`) — the whole UI is JSX, compiled
  with the shared `tsconfig.jsx.json`; `h()` returns the same `NodeProxy` AST
  the builder DSL does, so `render` / `DOMSink` behave identically.
- **High insert rate + keyed render identity** — a bot streams messages every
  1.5s and **⚡ blast 200** inserts a batch via `messages.patch([...])`. New
  messages append to whichever channel `<For>` is showing; existing rows keep
  DOM identity (scroll position, other rows untouched).
- **Re-pointable filter** — switching channels (or typing in search) re-points
  `view` via the `$(view)` swap; `length(fn)` channel counts and the unread
  badges update independently.
- **Nested in-place mutation through `<For>`** — clicking an emoji bumps
  `message.reactions[emoji]` (a `BU2`), and a `<For each={msg.reactions}>` adds
  a new chip or increments an existing one — no full message re-render.

## Library bugs

This app surfaced no new bugs — but its message list depends on
`fix(render)` (array-list inserts append at the tail) from the Kanban work,
since `filter().az('ts')` is an array-shaped view with mid-list inserts.

## Run

`npm run serve` (builds the JSX), then open `http://localhost:3000/examples/chat/`.
Switch channels, react to messages, type and press Enter, or hit **blast**.
