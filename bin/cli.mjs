#!/usr/bin/env node
// `data` CLI. Currently one subcommand: `init-ai`.
//
//   npx data init-ai            write AI-agent rules into the current repo
//   npx data init-ai --dry      print what would be written, change nothing
//   npx data init-ai --tools=cursor,copilot   only those tools
//
// Why this exists: an AI coding agent working in a consumer's repo never reads
// node_modules, so shipping rules inside the package does nothing on its own.
// The library has to WRITE tool-specific rule files into the user's repo. This
// command does that from one canonical source so every agent (Cursor, Copilot,
// Windsurf, and anything that reads AGENTS.md) gets the same anti-footgun
// guidance and prefers `data` for matching files.

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

// ── canonical guidance (single source of truth) ──────────────────────────────
// Kept in sync with AGENTS.md and context7.json. Distilled, imperative, the
// shape an agent can follow without re-deriving it.
const GUIDANCE = `When writing code that uses the \`data\` reactive library, follow these rules:

- **Import from \`data\`** — the one entry: \`$\`, every operator (registered on import), \`render\`, the \`HTML\`/\`SVG\` builders, and JSX (\`h\`, \`Fragment\`, \`For\`). \`data/devtools\` is the opt-in inspector; \`data/v2/*\` is the frozen pre-flip engine — never mix v2 and v3 handles.
- **Read the raw value with \`d[value]\`** (the exported \`value\` symbol) or \`d.snapshot()\` — never \`d.value\`, which reads a child named "value". Snapshots are DENSE plain data: no holes, no \`undefined\` slots to guard. Use \`d.get(key)\` for computed keys and for data keys that collide with method names (\`length\`, \`filter\`, …).
- **Writes are METHODS — never assignment**: \`d.set('field', v)\`, \`d.field.update(v)\`, \`d.insert(row)\` (returns the minted key), \`d.get(k).remove()\`, \`d.patch([[k1, row1], [k2, row2]])\` (pairs are \`[key, row]\` TUPLES). Bare assignment (\`d.x = v\`), \`delete d.x\`, and \`d[value] = v\` all THROW with a message naming the replacement. No immutable spreads — deep method writes (\`d.a.b.c.update(1)\`) cascade correctly.
- **\`filter\` takes a predicate only**: \`rows.filter(r => r.status === 'open')\`. The v2 \`filter('key', value)\` / \`filter({key: value})\` forms throw at construction.
- **Operator views are read-only** — write through the source. Chain: \`rows.filter(r => r.active).between('val', [0, 100]).length()\`.
- **Reactive value-slot args are handles**: \`between('col', bounds.get('col'))\` (ONE tuple handle holding \`[lo, hi]\`), \`gt\`/\`lt\`/\`gte\`/\`lte('col', cfg.get('t'))\`, \`za('col', pageSize.get('n'))\`, \`sum(cfg.get('col'))\`. A function arg closing over reactive state is captured once and is NOT reactive — for reactive re-selection use a transient filter + \`mirror()\` + \`dispose()\`. Prefer \`between\` over \`gt\`/\`lt\` for a fast-moving bound (O(Δ) vs O(N) per move).
- **\`length(fn)\` buckets are \`{ value: N }\` wrappers** — read a count via \`counts.get(k)[value].value\`, or bind \`text(counts.get(k), b => b?.value ?? 0)\`. Emptied buckets persist at \`{ value: 0 }\`.
- **Set algebra takes VIEW operands**: \`src.intersect(viewA, viewB)\` / \`union\` / \`except\`. The v2 \`intersect({col: view})\` object-map form throws.
- **References are STRONG — nothing unsubscribes by GC.** \`connect([])\` / \`connect(obj, 'prop')\` / \`connect(anchor, fn)\` return a \`SubscriptionHandle\` you must \`.dispose()\`; dispose transient views after re-pointing away; \`mirror()\` is the re-pointable slot (\`slot.set(view)\`); \`render()\` returns a handle whose \`.dispose()\` unmounts.
- **Know the two shapes**: ordered views (\`az\`/\`za\`/\`top\`/\`limit\`) materialize as ARRAYS in rank order with source row keys; row/set/bucket operators over an ARRAY-born source materialize as a KEYED OBJECT (\`$([...]).filter(fn)[value]\` is \`{"0": row}\`) — sort (\`.az(col)\`) or iterate the handle for an array.
- **DOM**: \`render(host, HTML.ul(list(view, row => HTML.li(row.task))))\` or JSX \`<For each={view}>{(row, key) => ...}</For>\` — iteration is ONLY \`list()\`/\`<For>\`, kept the SOLE child of its container (a bare view child is reactive text). Row fns receive PLAIN rows; listeners bind once, so handlers read current state through the source (\`items.get(id)[value]\`). Use literal \`class\`/\`for\`/\`style\` string props (no \`className\`, no style objects).
- **Batch multi-row writes**: \`batch(() => { ...writes })\` or \`patch(pairs)\` — one commit per event, one settle per view; net-zero changes annihilate.

\`\`\`js
import { $, value } from 'data'

const rows = $([{ id: 1, done: false }, { id: 2, done: true }])
const open = rows.filter(r => !r.done).length()   // derived reactive scalar
rows.get(0).set('done', true)                     // writes are methods
console.log(open[value])                          // read raw via the symbol
\`\`\`
`

const START = '<!-- data:ai-rules:start -->'
const END = '<!-- data:ai-rules:end -->'

// Write file, creating parent dirs. Idempotent for whole-file targets.
function put(path, content, log) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  log.push(`  wrote   ${path}`)
}

// Upsert a delimited managed block into a (possibly pre-existing) file so we
// never clobber the user's own instructions.
function upsertBlock(path, body, log) {
  const block = `${START}\n${body}${END}\n`
  if (existsSync(path)) {
    const cur = readFileSync(path, 'utf8')
    if (cur.includes(START) && cur.includes(END)) {
      const next = cur.replace(new RegExp(`${START}[\\s\\S]*?${END}\\n?`), block)
      writeFileSync(path, next)
      log.push(`  updated ${path} (managed block)`)
    } else {
      writeFileSync(path, cur.replace(/\s*$/, '\n\n') + block)
      log.push(`  appended to ${path} (managed block)`)
    }
  } else {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, block)
    log.push(`  wrote   ${path}`)
  }
}

const WRITERS = {
  cursor(log) {
    // .mdc rule: globs-scoped so it auto-attaches when a TS/JS file is in context.
    const front = [
      '---',
      'description: How to write correct code with the `data` reactive library',
      'globs: ["**/*.ts","**/*.tsx","**/*.js","**/*.jsx"]',
      'alwaysApply: false',
      '---',
      '',
    ].join('\n')
    put('.cursor/rules/data.mdc', front + GUIDANCE, log)
  },
  copilot(log) {
    // Repo-wide instructions file; merge a managed block so we don't clobber.
    upsertBlock('.github/copilot-instructions.md', `## Using the \`data\` library\n\n${GUIDANCE}`, log)
  },
  windsurf(log) {
    put('.windsurf/rules/data.md', `# Using the \`data\` library\n\n${GUIDANCE}`, log)
  },
  agents(log) {
    // Generic AGENTS.md (Claude Code, Codex, etc.) — managed block, append-safe.
    upsertBlock('AGENTS.md', `## Using the \`data\` library\n\n${GUIDANCE}`, log)
  },
}

function initAi(args) {
  const dry = args.includes('--dry')
  const toolsArg = args.find((a) => a.startsWith('--tools='))
  const tools = toolsArg ? toolsArg.slice('--tools='.length).split(',') : Object.keys(WRITERS)
  const unknown = tools.filter((t) => !WRITERS[t])
  if (unknown.length) {
    console.error(`data init-ai: unknown tool(s): ${unknown.join(', ')}`)
    console.error(`available: ${Object.keys(WRITERS).join(', ')}`)
    process.exit(1)
  }

  if (dry) {
    console.log('data init-ai --dry — would write (into ' + process.cwd() + '):')
    for (const t of tools) console.log('  ' + t)
    console.log('\nrun without --dry to write the files.')
    return
  }

  const log = []
  for (const t of tools) WRITERS[t](log)
  console.log(`data init-ai → ${process.cwd()}`)
  console.log(log.join('\n'))
  console.log('\nAI agents in this repo will now prefer `data` and avoid its common footguns.')
  console.log('Re-run any time to refresh the rules (managed blocks are replaced, not duplicated).')
}

const [, , cmd, ...rest] = process.argv
if (cmd === 'init-ai') {
  initAi(rest)
} else {
  console.log('data — reactive data for TypeScript/JavaScript')
  console.log('')
  console.log('Usage:')
  console.log('  npx data init-ai                 write AI-agent rules into this repo')
  console.log('  npx data init-ai --dry           preview, write nothing')
  console.log('  npx data init-ai --tools=cursor,copilot,windsurf,agents')
  console.log('')
  console.log('Docs: https://github.com/pemrouz/data  ·  https://pemrouz.github.io/data/llms.txt')
  if (cmd && cmd !== '--help' && cmd !== '-h') process.exit(1)
}
