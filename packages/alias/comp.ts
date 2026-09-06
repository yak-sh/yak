// The one word this package ships: `alias`, a KIND OF KEY.
//
// @yaks/key carries every value an entity answers to — `key{of, value}` plus a
// tag saying what sort of value it is. `alias` is the sort that is a NAME: the
// word a person or an agent types instead of an id. So this package declares a
// tag, and everything underneath it is the carrier's.
//
//   { entity: { eid: k }, key: { of: r, value: 'lemon-cake' }, alias: {} }
//
// The document itself is `./vocab.json` — plain JSON Schema, readable by
// anything that reads JSON. This file re-exports it under the name callers say
// and keeps the prose about why it is shaped the way it is.
//
// THE SUGAR IS THE SPELLING EVERYONE USES: `alias: {name: 'lemon-cake'}` on the
// entity's own bundle, which the plugin lifts into the row above (./sugar.ts).
// `name` is not a column — the tag declares none — it is a word the normalize
// phase consumes before the vocabulary is ever asked about it.
//
// NO SIGIL. `recipe:lemon-cakes` is a name with a colon in it, not a namespace
// the vocabulary knows about — the fleet's own store has resolved bare names
// this way for as long as it has had them (src/db.ts `resolveId`), and a caller
// who wants their names namespaced writes the prefix they like. A `$` would say
// the opposite of what this word means: `$cake` is the BATCH-local alias
// @yaks/graph mints an id for and forgets, and this is the one that outlives
// the batch.

import type { Bundle, Comp, Eid } from '@yaks/graph'
import { keyEid } from '@yaks/key'
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The tag a key wears when its value is a name. */
export let ALIAS = 'alias'

/** The word the sugar carries the name in: `alias: {name: 'lemon-cake'}`. */
export let NAME = 'name'

/** The path a query says a name by: `.key.value=lemon-cake&.alias!`. */
export let PATH = 'key.value'

/**
 * The alias vocabulary, to load beside @yaks/key's and your own:
 * `loadVocab([keyDoc, aliasDoc, ...mine], [keyKeywords])`. It says nothing
 * about what the named entity IS — that is your own document's word — only that
 * a name is a kind of key.
 */
export let aliasDoc: VocabDoc = doc

/** The entity a name lands on — the key's own derived id, computed here so
 * every door computes it the same way. */
export let aliasEid = (name: string): Eid => keyEid(ALIAS, name)

/** The name a bundle's sugar states — an absent tag, a cleared one and an empty
 * string all say it states none. */
export let nameOf = (b: Bundle): string | undefined => {
  let tag = b[ALIAS]
  let name = tag && typeof tag == 'object' ? (tag as Comp)[NAME] : undefined
  return typeof name == 'string' && name ? name : undefined
}
