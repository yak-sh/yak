// The registration: what @yaks/key adds to a component vocabulary, said in
// JSON Schema's own extension form. `meta/key.vocab.json` is the authored
// source (the keyword's schema and its prose); this module gives it a name and
// the shape `loadVocab(docs, [keyKeywords])` takes.
//
// One keyword, because one thing is open: WHICH KINDS OF VALUE EXIST. The `key`
// component itself is closed and ships with the package; the tags a key wears
// are the application's vocabulary — a store names its recipes, a directory its
// people by email address — so they arrive as ordinary components that say
// `key` about themselves.
//
// THE KEYWORD IS THE CARRIER'S NAME (Jeff, 2026-09-05: "why not edge:true and
// key:true?"). A tag that rides an edge says `edge`, a tag that rides a key
// says `key`, and one rule — "this tag rides that component" — reads them all.
// The two packages do not share a helper to read it: it is eight lines each,
// and a shared one would need a home package that neither of them is.

import type { Keywords } from '@yaks/vocab'
import doc from './meta/key.vocab.json' with { type: 'json' }

/** The URI a vocab file declares under `$vocabulary` to use `key`. */
export let KEY_URI = 'https://yaks.sh/vocab/key'

/**
 * The `key` keyword vocabulary, ready to register:
 * `loadVocab(docs, [keyKeywords])` carries each component's declaration onto
 * `v.comp(name).keywords.key`, which is where {@link kinds} reads it.
 */
export let keyKeywords: Keywords = { uri: KEY_URI, comp: ['key'], doc }
