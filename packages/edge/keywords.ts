// The registration: what @yaks/edge adds to a component vocabulary, written in
// JSON Schema's own extension form. `meta/edge.vocab.json` is the authored
// source (the keyword's schema and its documentation); this module gives it a
// name and the shape `loadVocab(docs, [edgeKeywords])` expects.
//
// One keyword, because one thing is open: which relations exist. The `edge`
// component itself is fixed and ships with the package; the components stored
// beside it belong to the application's vocabulary — a blog links post to post,
// a bookstore has a book cite another book — so they are ordinary components
// that declare `relation` about themselves.

import type { Keywords } from '@yaks/vocab'
import doc from './meta/edge.vocab.json' with { type: 'json' }

/** The URI a vocab file declares under `$vocabulary` to use `relation`. */
export let EDGE_URI = 'https://yaks.sh/vocab/edge'

/**
 * The `edge` keyword vocabulary, ready to register:
 * `loadVocab(docs, [edgeKeywords])` copies each component's declaration onto
 * `v.comp(name).keywords.edge`, which is where {@link relations} reads it.
 *
 * `relation` is the older name for the same keyword and is still accepted —
 * {@link relations} reads either. The newer name is the name of the component
 * it accompanies, so one rule ("this component is stored beside that one")
 * covers both an edge's relations and
 * {@link https://jsr.io/@yaks/key | @yaks/key}'s.
 */
export let edgeKeywords: Keywords = {
  uri: EDGE_URI,
  comp: ['edge', 'relation'],
  doc,
}
