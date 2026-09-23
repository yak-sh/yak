// The registration: the custom JSON Schema keywords @yaks/kernel adds to a
// component vocabulary, declared in JSON Schema's own extension form.
// `meta/kernel.vocab.json` is the authored source (each keyword's schema and
// the prose describing it); this module gives it a name and the shape
// `loadVocab(docs, [kernelKeywords])` expects.
//
// Three keywords, because three things about a graph of work are not the core
// meta-model's business: which components a project answers for, which
// components stay out of the snapshot a client loads at startup, and where a
// text column's suggested values come from. What makes a component a log line
// needs no keyword of its own — the core meta-model already covers it, as a
// component reached only by its qualified filter name (`bare: false`).

import type { Keywords } from '@yaks/vocab'
import doc from './meta/kernel.vocab.json' with { type: 'json' }

/** The URI a vocabulary file declares under `$vocabulary` to use these
 * keywords. */
export let KERNEL_URI = 'https://yak.sh/vocab/kernel'

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
