// The registration: what @yaks/id adds to a component vocabulary, said in JSON
// Schema's own extension form. `meta/id.vocab.json` is the authored source (the
// keyword's schema and its prose); this module gives it a name and the shape
// `loadVocab(docs, [idKeywords])` takes.

import type { Keywords } from '@yaks/vocab'
import doc from './meta/id.vocab.json' with { type: 'json' }

/** The URI a vocab file declares under `$vocabulary` to use `prefix`. */
export let ID_URI = 'https://yaks.sh/vocab/id'

/**
 * The `prefix` keyword vocabulary, ready to register:
 * `loadVocab(docs, [idKeywords])` carries each component's declared prefix onto
 * `v.comp(name).keywords.prefix`, which is where `prefixes()` reads it.
 */
export let idKeywords: Keywords = { uri: ID_URI, comp: ['prefix'], doc }
