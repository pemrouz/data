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

- **Import from \`data\`** (the default entry) — it registers every operator, so \`proxy.filter(...)\` chaining works on import. Use \`data/full\` only for JSX authoring; \`data/lean\` only to tree-shake (calling \`.filter\` on a lean proxy throws).
- **Read the raw value with \`proxy[value]\`** using the exported \`value\` symbol — never \`proxy.value\`, which creates a child view named "value".
- **Mutate by assignment**, including nested paths: \`proxy.foo = 1\`, \`proxy[0].done = true\`, \`delete proxy[1]\`, \`proxy[value] = next\`. Do NOT build immutable spreads — assignment triggers the right incremental cascade.
- **Operators return new reactive views** and never mutate in place. Chain them: \`rows.filter(d => d.active).between('val', [0, 100]).length()\`.
- **\`gt\`/\`lt\`/\`gte\`/\`lte\` take literal bounds only.** For a moving threshold use \`between(col, [lo, hi])\` with ViewProxy bounds, or derive a fresh view.
- **\`length(fn)\` stores each bucket as \`{ value: count }\`** — read a bucket count via \`counts[key].value\`, not \`counts[key]\` (which stringifies to \`[object Object]\`).
- **\`between\`/\`intersect\`/\`union\`/\`except\` leave excluded slots as explicit \`undefined\`.** When binding a row template directly to such a view, densify (\`vp.to(arr => arr.filter(r => r !== undefined))\`) or write the bindings defensively.
- **\`connect\` has three forms:** \`connect([])\` pushes change events into an array; \`connect(obj, 'prop')\` mirrors the value onto a property; \`connect(obj, fn)\` calls \`fn(change)\` per event. There is no single-argument \`connect(fn)\` — it throws.
- **Render with \`render(el, HTML.div(...))\`** (builder DSL) or JSX via the \`data/full\` entry and the shared \`h\` factory.
- **Built-ins (not operators):** \`proxy.raf()\` returns a coalescing rAF writer; \`proxy.patch([name, value, ...])\` applies many child updates as one batched cascade; \`first()\`/\`last()\` snapshot the edge child.

\`\`\`js
import { $, value, render, HTML } from 'data'

const rows = $([{ id: 1, done: false }, { id: 2, done: true }])
const open = rows.filter(d => !d.done).length()   // derived reactive view
rows[0].done = true                                // mutate by assignment
console.log(open[value])                           // read raw value via the symbol
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
