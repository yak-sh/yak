// The registration: what @yaks/kernel adds to a component vocabulary, said in
// JSON Schema's own extension form. `meta/kernel.vocab.json` is the authored
// source (each keyword's schema and its prose); this module gives it a name and
// the shape `loadVocab(docs, [kernelKeywords])` takes.
//
// Three keywords, because three things about a graph of WORK are not the core
// meta-model's business: what a project governs, which log lines stay off a
// boot snapshot, and where a text column's completions come from. What IS a log
// line needs no word of its own — the core meta-model already says it, as a
// component that never claims a bare spelling (`bare: false`).

import type { Keywords } from '@yaks/vocab'
import doc from './meta/kernel.vocab.json' with { type: 'json' }

/** The URI a vocab file declares under `$vocabulary` to use these keywords. */
export let KERNEL_URI = 'https://yaks.sh/vocab/kernel'

/**
 * The kernel keyword vocabulary, ready to register: `loadVocab(docs,
 * [kernelKeywords])` carries `governed` and `lazy` onto the components that
 * declare them and `well` onto the columns that do.
 */
export let kernelKeywords: Keywords = {
  uri: KERNEL_URI,
  comp: ['governed', 'lazy'],
  column: ['well'],
  doc,
}
