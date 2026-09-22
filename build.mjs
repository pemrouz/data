// build.mjs — the npm build. dist/ = the runtime sources type-stripped FILE-FOR-FILE with Node's
// stripTypeScriptTypes ('strip' mode: types become whitespace, nothing else changes), `.ts`
// specifiers rewritten to `.js`. Zero dependencies (node: builtins only). Same machinery the
// landing page uses (site/strip.mjs) — one module per source file, so dist mirrors the tree and
// a stack trace points at the file you would open.
//
// Why a build at all: the package is source-served for its in-repo consumer (fero imports
// ../../data/api/index.ts), but Node refuses to type-strip anything under node_modules
// (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), so an npm consumer needs JavaScript. The
// shipped types are the curated types/public.d.ts (+ the two subpath twins), not an emit.
//
// Entries = package.json's exports: api/index.ts (.), api/jsx-runtime.ts (./jsx-runtime and
// ./jsx-dev-runtime), devtools/entry.ts (./devtools). Their import cones are walked from the
// stripped text; a specifier that resolves to no file is a build error (it would be a dangling
// import in the tarball). Gates after emit: every module passes `node --check`, no `.ts` or
// `node:` specifier survives, package.json declares no runtime dependencies, and a consumer
// smoke runs the built entries in a fresh Node process (no flags): a source, a filter, a fold,
// a batch, the jsx runtime, the devtools entry attaching to $.
//
// Run: node build.mjs      (npm run build; prepublishOnly runs it before the test + type gates)

import { stripTypeScriptTypes } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, resolve, relative, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const repo = dirname(fileURLToPath(import.meta.url))
const out = join(repo, 'dist')
const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))

// the entries ARE the exports map — a new subpath in package.json builds without touching this file
const ENTRIES = [...new Set(Object.values(pkg.exports)
  .map(e => typeof e === 'string' ? e : e.import)
  .filter(p => /^\.\/dist\/.*\.js$/.test(p))
  .map(p => p.replace(/^\.\/dist\//, '').replace(/\.js$/, '.ts')))]
if (!ENTRIES.length) throw new Error('build: package.json exports name no ./dist/*.js entry')

rmSync(out, { recursive: true, force: true })

const SPEC = /(['"])(\.[^'"\n]*?)\.ts\1/g
const seen = new Map()   // abs .ts → rel .js
const queue = ENTRIES.map(e => { const f = join(repo, e); if (!existsSync(f)) throw new Error(`build: entry ${e} does not exist`); return f })
let bytes = 0
function emit (file) {
  if (seen.has(file)) return
  const src = readFileSync(file, 'utf8')
  let js = stripTypeScriptTypes(src, { mode: 'strip', sourceMap: false })
  const rel = relative(repo, file).replace(/\.ts$/, '.js')
  seen.set(file, rel)
  for (const m of js.matchAll(SPEC)) {
    const dep = resolve(dirname(file), m[2] + '.ts')
    if (!existsSync(dep)) throw new Error(`build: ${relative(repo, file)} imports ${m[2]}.ts, which does not exist`)
    if (!seen.has(dep)) queue.push(dep)
  }
  js = js.replace(SPEC, (_, q, spec) => `${q}${spec}.js${q}`)
  const dest = join(out, rel)
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, js)
  bytes += Buffer.byteLength(js)
}
while (queue.length) emit(queue.pop())

// ── gates ──────────────────────────────────────────────────────────────────────
function walk (dir, acc = []) { for (const n of readdirSync(dir)) { const p = join(dir, n); statSync(p).isDirectory() ? walk(p, acc) : acc.push(p) } return acc }
for (const f of walk(out)) {
  const txt = readFileSync(f, 'utf8')
  if (/from\s*['"]node:|import\s*\(\s*['"]node:/.test(txt)) throw new Error(`build gate: node: specifier in ${relative(repo, f)} — the runtime must run in a browser`)
  if (SPEC.test(txt)) throw new Error(`build gate: a .ts specifier survived in ${relative(repo, f)}`)
  execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' })
}
if (pkg.dependencies && Object.keys(pkg.dependencies).length) throw new Error('build gate: package.json declares runtime dependencies — the "0 dependencies" claim would be false')
for (const e of ENTRIES) if (!existsSync(join(out, e.replace(/\.ts$/, '.js')))) throw new Error(`build gate: entry ${e} was not emitted`)

// ── consumer smoke: the built entries in a fresh Node process, no flags ────────
const smoke = `
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
const u = p => pathToFileURL(${JSON.stringify(out + sep)} + p).href
const { $, value, batch, runtime } = await import(u('api/index.js'))
const rows = $([{ v: 1 }, { v: 2 }, { v: 3 }])
const big = rows.filter(r => r.v > 1)
const n = big.length()
assert.equal(n[value], 2, 'filter → length over three rows')
rows.insert({ v: 7 })
assert.equal(n[value], 3, 'an insert lands in the fold')
const before = runtime().seq
batch(() => { rows.insert({ v: 8 }); rows.insert({ v: 9 }) })
assert.equal(n[value], 5, 'a batch of two inserts lands as one commit')
assert.equal(runtime().seq, before + 1, 'one commit for the batch')
const jsx = await import(u('api/jsx-runtime.js'))
for (const k of ['jsx', 'jsxs', 'jsxDEV', 'Fragment']) assert.equal(typeof jsx[k], 'function', 'jsx-runtime exports ' + k)
const dt = await import(u('devtools/entry.js'))
assert.equal(typeof dt.inspect, 'function', 'devtools exports inspect')
assert.equal(typeof $.inspect, 'function', 'the devtools entry attaches to $ outside a browser')
const info = dt.inspect(rows)
assert.ok(info && typeof info === 'object' && Object.keys(info).length > 0, 'inspect resolves a handle to its info')
console.log('smoke ok')
`
const res = execFileSync(process.execPath, ['--input-type=module', '-e', smoke], { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
if (res !== 'smoke ok') throw new Error('build smoke: unexpected output ' + res)

console.log(`dist: ${seen.size} modules, ${(bytes / 1024).toFixed(0)} KB, from ${ENTRIES.join(' + ')}; gates + consumer smoke ok`)
