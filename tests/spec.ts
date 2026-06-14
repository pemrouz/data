// @ts-nocheck
// spec() — a thin, backward-compatible wrapper over node:test that carries
// structured metadata for each test (subject / aspect / shape / mechanism /
// regression / assertion) so the test report can organise by BEHAVIOUR rather
// than by file. The metadata object is authoritative; the human-readable title
// is derived from it deterministically, so `node --test` output stays legible
// AND a report can recover the facets without guessing.
//
// Usage:
//   import { spec } from '../../tests/spec.ts'
//   spec({ op:'between', aspect:'correctness', shape:'array', via:'BU2',
//          asserts:'a row crossing the bound enters the view' }, () => { ... })
//
// Title it produces:  between · correctness · array · via BU2 — a row crossing the bound enters the view
//
// The name is a top-down COORDINATE, not a hand-written sentence, so the suite
// reads from 50,000ft (Subject × Guarantee) and drills down (→ Trigger → claim):
//
// Fields:
//   op         (required) subject under test — operator/area
//   guarantee  (required) the PROPERTY under test — one of:
//                Selection · Order · Reduction · Identity · Alignment ·
//                Propagation · Fidelity · Efficiency · Robustness
//   trigger    (recommended) the change that exercises it — one of:
//                construct · insert · remove · edit · overwrite · bound-move ·
//                brush · batch · re-point · dedup-call · scale  (compounds ok: 'insert/remove')
//   asserts    (required) the leaf claim, normalised: "<condition>, <observable outcome>",
//                present tense, ≤~12 words, NO operator name, NO verb codes (those are chips)
//   shape      (opt) array | object | array+object | scalar
//   via        (opt) mechanism chip(s) — verb code (BU2, BMV1…) or token (hole, reactive-bound); string|string[]
//   issue      (opt) regression chip — C1…C16, P7, #21 → DECISIONS.md / ISSUES.md
//   chain      (opt) composition pipeline, e.g. 'between→filter'
//   emits      (opt) expected change verbs asserted on the connect([]) stream — feeds the protocol checker
//   skip       (opt) forwarded to node:test as { skip } — string reason or boolean (env-gated tests).
//                NOT a facet: stripped before the registry so it never appears in the coordinate.
import { test } from 'node:test'

export const GUARANTEES = ['Selection','Order','Reduction','Identity','Alignment','Propagation','Fidelity','Efficiency','Robustness']
export const TRIGGERS = ['construct','insert','remove','edit','overwrite','bound-move','brush','batch','re-point','dedup-call','scale']

const REGISTRY = []
const COLLECT = process.env.SPEC_COLLECT === '1'

function arr(x) { return x == null ? [] : (Array.isArray(x) ? x : [x]) }

export function specTitle(m) {
  const head = [m.chain || m.op, m.guarantee]
  if (m.trigger) head.push(m.trigger)
  if (m.shape) head.push(m.shape)
  if (m.via && arr(m.via).length) head.push('via ' + arr(m.via).join('+'))
  if (m.issue) head.push(m.issue)
  return head.join(' · ') + ' — ' + m.asserts
}

export function spec(meta, fn) {
  if (!meta || !meta.op || !meta.guarantee || !meta.asserts)
    throw new Error('spec() requires { op, guarantee, asserts } — got ' + JSON.stringify(meta))
  if (!GUARANTEES.includes(meta.guarantee))
    throw new Error('spec() unknown guarantee "' + meta.guarantee + '" — pick one of ' + GUARANTEES.join(', '))
  const title = specTitle(meta)
  // `skip` is a node:test option, not a coordinate facet — keep it out of the registry.
  const { skip, ...facets } = meta
  REGISTRY.push({ ...facets, via: arr(facets.via), title })
  if (!COLLECT) {
    if (skip !== undefined) test(title, { skip }, fn)
    else test(title, fn)
  }
  return title
}

export function registry() { return REGISTRY }
