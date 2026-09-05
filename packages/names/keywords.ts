// The registration: what @yaks/names adds to a component vocabulary, said in
// JSON Schema's own extension form. `meta/names.vocab.json` is the authored
// source (the keyword's schema and its prose); this module gives it a name and
// the shape `loadVocab(docs, [nameKeywords])` takes.

import type { Keywords } from '@yaks/vocab'
import doc from './meta/names.vocab.json' with { type: 'json' }

/** The URI a vocab file declares under `$vocabulary` to use `by_name`. */
export let NAMES_URI = 'https://yaks.sh/vocab/names'

/**
 * The `by_name` keyword vocabulary, ready to register:
 * `loadVocab(docs, [nameKeywords])` carries each component's declaration onto
 * `v.comp(name).keywords.by_name`, which is where `named()` reads it.
 */
export let nameKeywords: Keywords = {
  uri: NAMES_URI,
  comp: ['by_name'],
  doc,
}
