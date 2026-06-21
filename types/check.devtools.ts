// Devtools surface fixture. Importing `data/devtools` runs devtools/augment.ts's
// `declare module` merge, so the inspection helpers are typed on `$`. Compiled
// by tsc -p tsconfig.typecheck.devtools.json (noCheck:false), ISOLATED from the
// base gate so the augmentation doesn't leak into types/check.negative.ts (which
// asserts the opposite — that `$.inspect` is NOT on the base `$`).
import { $ } from '../full.ts'
import '../devtools/index.ts' // side-effect: attaches the helpers + augments the type

const items = $([1, 2, 3])

// Inspection helpers are typed once devtools is imported.
const snap = $.inspect(items)
$.graph()
$.highlight(items, 500)
$.trace(items)
$.profile()
$.cascades()
$.fromDOM(document.body)
void snap

// Always-present knobs are typed even without devtools (named on `Dollar`).
$.random()
$.debug = true
