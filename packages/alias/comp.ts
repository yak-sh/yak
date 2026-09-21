// The one component this package ships: `alias`, a KIND OF KEY.
//
// @yaks/key stores every value an entity can be looked up by — `key{of, value}`
// plus a component naming what sort of value it is. `alias` is the sort whose
// value is a NAME: what a person or an agent types instead of an id. So this
// package declares that one component, and everything underneath it belongs to
// @yaks/key.
//
//   { entity: { eid: k }, key: { of: r, value: 'lemon-cake' }, alias: {} }
//
// The component itself is declared in `./vocab.json` — plain JSON Schema,
// readable by anything that reads JSON. This file re-exports it under the name
// callers import and keeps the explanation of why it is shaped this way.
//
// THE SHORTHAND IS WHAT EVERYONE WRITES: `alias: {name: 'lemon-cake'}` on the
// entity's own bundle, which the plugin turns into the key entity above
// (./sugar.ts). `name` is not a column — this component declares none — it is a
// property the `normalize` phase consumes before the vocabulary is ever asked
// about it.
//
// NO PREFIX CHARACTER. `recipe:lemon-cakes` is a name that happens to contain a
// colon, not a namespace the vocabulary knows about — the fleet's own store has
// resolved bare names this way for as long as it has had them (src/db.ts
// `resolveId`), and a caller who wants namespaced names writes whatever prefix
// they like. A leading `$` would mean the opposite of what this component
// means: `$cake` is an alias local to one list of changes, which @yaks/graph
// assigns an id and then forgets, whereas this name is stored and outlives the
// write.

import type { Bundle, Comp, Eid } from '@yaks/graph'
import { keyEid } from '@yaks/key'
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The component stored beside a key whose value is a name. */
export let ALIAS = 'alias'

/** The property the shorthand carries the name in:
 * `alias: {name: 'lemon-cake'}`. */
export let NAME = 'name'

/** The path a query uses to match a name: `.key.value=lemon-cake&.alias!`. */
export let PATH = 'key.value'

/**
 * The alias vocabulary, to load beside @yaks/key's and your own:
 * `loadVocab([keyDoc, aliasDoc, ...mine], [keyKeywords])`. It declares nothing
 * about what the named entity IS — that is your own document's job — only that
 * a name is a kind of key.
 */
export let aliasDoc: VocabDoc = doc

/** The id of the key entity a name lands on, derived from the name and
 * computed here so that every caller computes it the same way. */
export let aliasEid = (name: string): Eid => keyEid(ALIAS, name)

/** The name in a bundle's shorthand — a missing `alias` component, a cleared
 * one and an empty string all mean there is none. */
export let nameOf = (b: Bundle): string | undefined => {
  let tag = b[ALIAS]
  let name = tag && typeof tag == 'object' ? (tag as Comp)[NAME] : undefined
  return typeof name == 'string' && name ? name : undefined
}
