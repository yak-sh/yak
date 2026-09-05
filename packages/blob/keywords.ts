// The registration: what @yaks/blob adds to a component vocabulary, said in
// JSON Schema's own extension form. `meta/blob.vocab.json` is the authored
// source (the keyword's schema and its prose); this module gives it a name and
// the shape `loadVocab(docs, [blobKeywords])` takes.
//
// One keyword, on a COLUMN rather than a component, because what is open is
// which values are too big — or too repeated — to keep in the row. The
// meta-model has no opinion about that; it only carries the word.

import type { Keywords } from '@yaks/vocab'
import doc from './meta/blob.vocab.json' with { type: 'json' }

/** The URI a vocab file declares under `$vocabulary` to use `store`. */
export let BLOB_URI = 'https://yaks.sh/vocab/blob'

/**
 * The `store` keyword vocabulary, ready to register:
 * `loadVocab(docs, [blobKeywords])` carries each column's declaration onto
 * `v.column(comp, prop).keywords.store`, which is where {@link bodies} reads
 * it.
 */
export let blobKeywords: Keywords = { uri: BLOB_URI, column: ['store'], doc }
