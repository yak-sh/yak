// The registration: the custom JSON Schema keyword @yaks/key adds to a
// component vocabulary, declared in JSON Schema's own extension form.
// `meta/key.vocab.json` is the authored source (the keyword's schema and the
// prose describing it); this module gives it a name and the shape
// `loadVocab(docs, [keyKeywords])` expects.
//
// One keyword, because one thing is open: WHICH KINDS OF VALUE EXIST. The `key`
// component itself is fixed and ships with the package; the tags a key carries
// are the application's — a store identifies its recipes by a short name, a
// directory its people by email address — so they arrive as ordinary components
// declaring `key` about themselves.
//
// THE KEYWORD IS NAMED AFTER THE CARRIER IT TAGS (Jeff, 2026-09-05: "why not
// edge:true and key:true?"). A tag that goes on an edge declares `edge`, a tag
// that goes on a key declares `key`, and one rule — "this tag belongs to that
// component" — reads them all. The two packages do not share a helper to read
// it: it is eight lines each, and a shared one would need a home package that
// neither of them is.

import type { Keywords } from '@yaks/vocab'
import doc from './meta/key.vocab.json' with { type: 'json' }

/** The URI a vocabulary file declares under `$vocabulary` to use `key`. */
export let KEY_URI = 'https://yaks.sh/vocab/key'

/**
 * The `key` keyword vocabulary, ready to register:
 * `loadVocab(docs, [keyKeywords])` carries each component's declaration onto
 * `v.comp(name).keywords.key`, which is where {@link kinds} reads it.
 */
export let keyKeywords: Keywords = { uri: KEY_URI, comp: ['key'], doc }
