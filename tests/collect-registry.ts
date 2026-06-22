// Collect spec() metadata into tests/registry.json WITHOUT running the tests.
// Run:  SPEC_COLLECT=1 node --experimental-strip-types tests/collect-registry.ts
//
// In collect mode spec() records its metadata and skips test(), so importing a
// migrated test file just registers its specs. We import each file individually
// and tag the new entries with their source path (for the File column).
import { writeFileSync } from 'node:fs'
import { registry } from './spec.ts'

// Files migrated to the spec() format. Add to this list as more convert.
const FILES = [
  'operators/between/between.test.ts',
  'operators/sort/sort.test.ts',
  'operators/sort/za-replace.test.ts',
  'operators/intersect/intersect.test.ts',
  'operators/union/union.test.ts',
  'operators/except/except.test.ts',
  'operators/aggregate/aggregate.test.ts',
  'operators/compare/compare.test.ts',
  'operators/distinct/distinct.test.ts',
  'operators/filter/filter.test.ts',
  'operators/group/group.test.ts',
  'operators/keys/keys.test.ts',
  'operators/length/length.test.ts',
  'operators/map/map.test.ts',
  'operators/reduce/reduce.test.ts',
  'operators/reverse/reverse.test.ts',
  'operators/tap/tap.test.ts',
  'operators/to/to.test.ts',
  'entry.test.ts',
  'render/devtools_link.test.ts',
  'render/list.test.ts',
  'jsx/jsx.test.ts',
  'devtools/devtools.test.ts',
  'core.test.ts',
  'index.test.ts',
  'differential.test.ts',
]

for (const f of FILES) {
  const before = registry().length
  await import(new URL('../' + f, import.meta.url).href)
  for (let i = before; i < registry().length; i++) registry()[i].file = f
}

const out = new URL('./registry.json', import.meta.url)
writeFileSync(out, JSON.stringify(registry(), null, 2) + '\n')
console.log('wrote tests/registry.json —', registry().length, 'specs from', FILES.length, 'file(s)')
