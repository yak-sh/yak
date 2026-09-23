// The registration: what @yaks/blob adds to a component vocabulary, declared in
// JSON Schema's own extension form. `meta/blob.vocab.json` is the authored
// source (the keyword's schema and its prose); this module gives it a URI and
// wraps it in the shape `loadVocab(docs, [blobKeywords])` accepts.
//
// One keyword, on a column rather than a component, because what varies from
// application to application is which values are too big — or too repeated — to
// keep in the row. The schema language itself has no opinion about that; it
// only carries the keyword.

import type { Keywords } from '@yaks/vocab'
import doc from './meta/blob.vocab.json' with { type: 'json' }

/** The URI a vocabulary file lists under `$vocabulary` to use `store`. */
export let BLOB_URI = 'https://yak.sh/vocab/blob'

/**
 * The `store` keyword vocabulary, ready to register:
 * `loadVocab(docs, [blobKeywords])` carries each column's declaration onto
 * `v.column(comp, prop).keywords.store`, which is where {@link bodies} reads
 * it.
 */
export let blobKeywords: Keywords = { uri: BLOB_URI, prop: ['store'], doc }
