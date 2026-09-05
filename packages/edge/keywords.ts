// The registration: what @yaks/edge adds to a component vocabulary, said in
// JSON Schema's own extension form. `meta/edge.vocab.json` is the authored
// source (the keyword's schema and its prose); this module gives it a name and
// the shape `loadVocab(docs, [edgeKeywords])` takes.
//
// One keyword, because one thing is open: WHICH RELATIONS EXIST. The `edge`
// component itself is closed and ships with the package; the tags an edge wears
// are the application's vocabulary — a blog links post to post, a bookstore has
// a book cite another book — so they arrive as ordinary components that say
// `relation` about themselves.

import type { Keywords } from '@yaks/vocab'
import doc from './meta/edge.vocab.json' with { type: 'json' }

/** The URI a vocab file declares under `$vocabulary` to use `relation`. */
export let EDGE_URI = 'https://yaks.sh/vocab/edge'

/**
 * The `relation` keyword vocabulary, ready to register:
 * `loadVocab(docs, [edgeKeywords])` carries each component's declaration onto
 * `v.comp(name).keywords.relation`, which is where {@link relations} reads it.
 */
export let edgeKeywords: Keywords = { uri: EDGE_URI, comp: ['relation'], doc }
