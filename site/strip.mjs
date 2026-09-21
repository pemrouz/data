// site/strip.mjs — the engine build (lifted from site-v7/build.mjs). Zero dependencies (node: builtins only).
//
// 1. Strips the runtime import cones of several entries into ./lib with Node's
//    stripTypeScriptTypes (file-for-file, `.ts` specifiers → `.js`), sharing one
//    `seen` set so every module lands exactly once (single module instance).
// 2. Aliases `node:test` / `node:assert` (only ever imported by conformance
//    *.test.ts) to ./shim so the REAL conformance suite runs in a browser.
// 3. Gates: no `node:` specifier survives in lib/; every emitted module passes
//    `node --check`; package.json has no `dependencies` (the "0 dependencies"
//    claim is asserted, not typed).
// 4. Extracts the law into ./gen — clauses from contract/SCHEDULE.md (fails if
//    ≠ 11), the 18 proof gists from conformance/schedule.test.ts, the manifest
//    from exportContract() run in Node, SCHEDULE_VERSION cross-checked between
//    SCHEDULE.md's header and contract/index.ts.
// 5. Injects the importmap + modulepreload block into every HTML page that
//    carries the `<!-- importmap -->…<!-- /importmap -->` markers, with paths
//    relative to that page.
//
// Run: node site/strip.mjs   (then node site/build.mjs assembles index.html)      (Node ≥ 22.13; 26.1 installed)
import { stripTypeScriptTypes } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, resolve, relative, join, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const out = join(here, 'lib')
const gen = join(here, 'gen')
// `node build.mjs --inject [page.html ...]` — only re-inject the importmap block
// into the given pages (or every marked page) using the existing lib/; safe to
// run while other builders work, because it never touches lib/ or gen/.
const argv = process.argv.slice(2)
const INJECT_ONLY = argv[0] === '--inject'
const INJECT_FILES = INJECT_ONLY ? argv.slice(1).map(f => resolve(process.cwd(), f)) : null

const ENTRIES = [
  'api/index.ts',                  // the engine (fero's one entry)
  'conformance/harness.ts',        // conform() — legality + replay, type-only imports
  'conformance/schedule.test.ts',  // the 18 SCHEDULE proofs (node:test/assert → shim)
  'devtools/index.ts',             // pure devtools: inspect/graph/trace/profile/cascades
  'devtools/dom.ts',
  'devtools/panel/index.ts',       // mountPanel — NEVER devtools/entry.ts (auto-docks, mutates $)
]
const ALIAS = { 'node:test': join(here, 'shim', 'test.js'), 'node:assert': join(here, 'shim', 'assert.js') }

if (!INJECT_ONLY) {
  rmSync(out, { recursive: true, force: true })
  rmSync(gen, { recursive: true, force: true })
  mkdirSync(gen, { recursive: true })
}

function walk(dir, acc = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    statSync(p).isDirectory() ? walk(p, acc) : acc.push(p)
  }
  return acc
}
let preload, seen = new Map(), proofs = [], manifest = { operators: {}, reserved: [] }, moduleVersion = 0
if (INJECT_ONLY) {
  preload = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')).preload
} else {
// ── 1+2 · strip ─────────────────────────────────────────────────────────────
const SPEC = /(['"])(\.[^'"\n]*?)\.ts\1/g
const NODE = /(from\s*|import\s*\(?\s*)(['"])(node:[a-z_/]+)\2/g
seen = new Map() // abs .ts → rel .js
const perEntry = {}
const queue = []
for (const e of ENTRIES) queue.push(join(repo, e))

function emit(file) {
  if (seen.has(file)) return
  const src = readFileSync(file, 'utf8')
  let js = stripTypeScriptTypes(src, { mode: 'strip', sourceMap: false })
  const rel = relative(repo, file).replace(/\.ts$/, '.js')
  const dest = join(out, rel)
  seen.set(file, rel)
  for (const m of js.matchAll(SPEC)) {
    const dep = resolve(dirname(file), m[2] + '.ts')
    if (!seen.has(dep) && existsSync(dep)) queue.push(dep)
  }
  js = js.replace(SPEC, (_, q, spec) => `${q}${spec}.js${q}`)
  if (/\.test\.ts$/.test(file)) {
    js = js.replace(NODE, (_, lead, q, spec) => {
      const target = ALIAS[spec]
      if (!target) throw new Error(`build: no shim for ${spec} in ${rel}`)
      let r = relative(dirname(dest), target).split(sep).join('/')
      if (!r.startsWith('.')) r = './' + r
      return `${lead}${q}${r}${q}`
    })
  }
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, js)
}
while (queue.length) emit(queue.pop())

// which modules belong to the api cone (for modulepreload)
const apiCone = new Set()
{
  const q = [join(repo, 'api/index.ts')]
  while (q.length) {
    const f = q.pop()
    if (apiCone.has(f)) continue
    apiCone.add(f)
    const js = stripTypeScriptTypes(readFileSync(f, 'utf8'), { mode: 'strip', sourceMap: false })
    for (const m of js.matchAll(SPEC)) {
      const dep = resolve(dirname(f), m[2] + '.ts')
      if (existsSync(dep)) q.push(dep)
    }
  }
}
preload = [...apiCone].map(f => seen.get(f)).sort()

// ── 3 · gates ───────────────────────────────────────────────────────────────
for (const f of walk(out)) {
  const txt = readFileSync(f, 'utf8')
  const bad = txt.match(/from\s*['"]node:|import\s*\(\s*['"]node:/)
  if (bad) throw new Error(`build gate: node: specifier survived in ${relative(here, f)}`)
  execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' })
}
const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
if (pkg.dependencies && Object.keys(pkg.dependencies).length)
  throw new Error('build gate: package.json declares runtime dependencies — the "0 dependencies" claim is false')

// ── 4 · gen ─────────────────────────────────────────────────────────────────
// clauses (site-v4's extraction, without its styling)
const md = readFileSync(join(repo, 'contract', 'SCHEDULE.md'), 'utf8')
const headerVersion = +(/SCHEDULE_VERSION\s+(\d+)/.exec(md.split('\n')[0]) ?? [])[1]
const model = md.split('## The model')[1] ?? md
const clauses = {}
const CL = /^(\d+)\.\s+([\s\S]*?)(?=^\d+\.\s|\n## |$(?![\s\S]))/gm
for (const m of model.matchAll(CL)) {
  const n = +m[1]
  if (n < 1 || n > 11) continue
  clauses[n] = m[2].replace(/\n {3,}/g, '\n').trim()
}
if (Object.keys(clauses).length !== 11)
  throw new Error(`build gate: SCHEDULE.md extraction found ${Object.keys(clauses).length} clauses, expected 11`)
moduleVersion = +/SCHEDULE_VERSION = (\d+)/.exec(readFileSync(join(repo, 'contract', 'index.ts'), 'utf8'))[1]
if (headerVersion !== moduleVersion)
  throw new Error(`build gate: SCHEDULE.md header says VERSION ${headerVersion}, contract/index.ts says ${moduleVersion}`)
writeFileSync(join(gen, 'schedule.json'), JSON.stringify({ SCHEDULE_VERSION: moduleVersion, clauses }, null, 1))

// proofs: every test(), with the `//!` gist block directly above it (blank lines
// allowed). One clause-5 test has no gist of its own (schedule.test.ts:160) and
// inherits the previous test's — recorded as `inherited: true`.
const suite = readFileSync(join(repo, 'conformance', 'schedule.test.ts'), 'utf8')
const lines = suite.split('\n')
proofs = []
for (let j = 0; j < lines.length; j++) {
  const name = /^test\('((?:[^'\\]|\\.)*)'/.exec(lines[j])?.[1]
  if (!name) continue
  let i = j - 1
  while (i >= 0 && lines[i].trim() === '') i--
  const gist = []
  while (i >= 0 && lines[i].startsWith('//!')) gist.unshift(lines[i].slice(3).trim()), i--
  let k = j + 1
  while (k < lines.length && !/^test\(/.test(lines[k]) && !lines[k].startsWith('//!')) k++
  const source = lines.slice(j, k).join('\n').replace(/\n+$/, '')
  const clause = /clause (\d+)/.exec(name)?.[1]
  const inherited = gist.length === 0
  proofs.push({ index: proofs.length, line: j + 1, name, clause: clause ? +clause : 'version', gist: inherited ? proofs.at(-1)?.gist ?? '' : gist.join(' '), inherited, source })
}
const testCount = (suite.match(/^test\(/gm) ?? []).length
if (proofs.length !== testCount) throw new Error(`build gate: parsed ${proofs.length} proofs vs ${testCount} tests`)
if (proofs.filter(p => p.inherited).length > 1) throw new Error('build gate: more than one test without a //! gist — write the gist')
const clauseSet = new Set(proofs.map(p => p.clause).filter(c => c !== 'version'))
for (let n = 1; n <= 11; n++) if (!clauseSet.has(n)) throw new Error(`build gate: no proof for clause ${n}`)
writeFileSync(join(gen, 'proofs.json'), JSON.stringify(proofs, null, 1))

// manifest: the engine run in Node — exportContract() and the api export list
const api = await import(pathToFileURL(join(repo, 'api/index.ts')).href)
const contract = await import(pathToFileURL(join(repo, 'contract/index.ts')).href)
manifest = api.exportContract()
if (contract.SCHEDULE_VERSION !== moduleVersion) throw new Error('build gate: imported SCHEDULE_VERSION differs from the source text')
// build-tier facts the page may print (stamped data-attested="build"): the dependency count
// (asserted 0 above) and the number of test() calls across the suite's directories.
let suiteTests = 0
for (const d of ['api', 'kernel', 'ops', 'seam', 'conformance', 'render', 'jsx', 'devtools']) {
  const dir = join(repo, d); if (!existsSync(dir)) continue
  for (const f of walk(dir)) if (/\.test\.ts$/.test(f)) suiteTests += (readFileSync(f, 'utf8').match(/^\s*test\(/gm) ?? []).length
}
writeFileSync(join(gen, 'manifest.json'), JSON.stringify({
  dependencies: Object.keys(pkg.dependencies ?? {}).length,
  tests: suiteTests,
  SCHEDULE_VERSION: contract.SCHEDULE_VERSION,
  SCHEMA_VERSION: manifest.SCHEMA_VERSION,
  operators: manifest.operators,
  reserved: manifest.reserved,
  exports: Object.keys(api).sort(),
  builtAt: new Date().toISOString(),
}, null, 1))
writeFileSync(join(out, 'manifest.json'), JSON.stringify({
  builtAt: new Date().toISOString(),
  entries: ENTRIES,
  modules: [...seen.values()].sort(),
  preload,
}, null, 1))

} // end of the full build
// ── 5 · inject importmap + preload into marked pages ────────────────────────
const MAP = {
  'data': 'api/index.js',
  'data/contract': 'contract/index.js',
  'data/conform': 'conformance/harness.js',
  'data/replay': 'conformance/replay.js',
  'data/legality': 'conformance/legality.js',
  'data/schedule-suite': 'conformance/schedule.test.js',
  'data/shim-test': null, // resolved to ../shim/test.js relative to the page
  'data/devtools': 'devtools/index.js',
  'data/devtools-dom': 'devtools/dom.js',
  'data/devtools-panel': 'devtools/panel/index.js',
  // the race's peers — loaded from esm.sh ONLY when a visitor selects one (never on first paint)
  'mobx': 'https://esm.sh/mobx@6.15.3',
  'solid-js': 'https://esm.sh/solid-js@1.9.12',
  '@preact/signals-core': 'https://esm.sh/@preact/signals-core@1.14.1',
  '@vue/reactivity': 'https://esm.sh/@vue/reactivity@3.5.34',
  'crossfilter2': 'https://esm.sh/crossfilter2@1.5.4',
  'rxjs': 'https://esm.sh/rxjs@7.8.2',
  'rxjs/operators': 'https://esm.sh/rxjs@7.8.2/operators',
  'react': 'https://esm.sh/react@19.2.6',
  'react-dom': 'https://esm.sh/react-dom@19.2.6',
  'react-dom/client': 'https://esm.sh/react-dom@19.2.6/client',
  'svelte/store': 'https://esm.sh/svelte@5.55.5/store',
}
let injected = 0
for (const f of (INJECT_FILES && INJECT_FILES.length ? INJECT_FILES : [join(here, 'page.html')])) {
  if (!f.endsWith('.html')) continue
  const html = readFileSync(f, 'utf8')
  if (!html.includes('<!-- importmap -->')) continue
  const dot = p => (p === '' ? '.' : /^\.\.?\//.test(p) || p === '..' ? p : './' + p) // import-map addresses must start with ./ ../ or /
  const toLib = dot(relative(dirname(f), out).split(sep).join('/'))
  const toShim = dot(relative(dirname(f), join(here, 'shim')).split(sep).join('/'))
  const imports = {}
  for (const [k, v] of Object.entries(MAP)) imports[k] = v === null ? `${toShim}/test.js` : /^https?:/.test(v) ? v : `${toLib}/${v}`
  const block = [
    '<!-- importmap -->',
    '<script type="importmap">' + JSON.stringify({ imports }, null, 0) + '</script>',
    ...preload.map(p => `<link rel="modulepreload" href="${toLib}/${p}">`),
    '<!-- /importmap -->',
  ].join('\n')
  const next = html.replace(/<!-- importmap -->[\s\S]*?<!-- \/importmap -->/, block)
  if (next !== html) { writeFileSync(f, next); injected++ }
}

if (INJECT_ONLY) console.log(`importmap injected into ${injected} page(s) (lib/ untouched)`)
else console.log(`stripped ${seen.size} modules (${preload.length} in the api cone) → ${relative(process.cwd(), out)}; gen: 11 clauses, ${proofs.length} proofs, ${Object.keys(manifest.operators).length} operators, ${manifest.reserved.length} reserved, SCHEDULE_VERSION ${moduleVersion}; importmap injected into ${injected} page(s)`)
