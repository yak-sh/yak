// The one component this package ships: `key{of, value}`.
//
// It is to a has-many VALUE what `edge{from, to}` is to a link. An entity does
// not carry its names in a column; the names carry the entity. Each one is a
// key entity of its own — `key{of, value}` plus a KIND TAG saying which
// kind of value it is — so a recipe answers to `lemon-cake` and to
// `recipe:2019-07` because two rows point at it, adding one is a write, and
// retiring one is dropping that row. A list column would have been the other
// design and it is the worse one: every write would be a read-modify-write of
// somebody else's column, and two writers adding a name at once would lose one.
//
// `of` is a reference with `death: release`, which is the whole of a key's
// lifecycle: a value for a deleted thing is not a value for anything, and the
// ROW goes rather than the entity, so the value is free to be claimed again.
// (A cascade would tombstone an id derived from the value, and a tombstone is
// forever — the value could never be used again by anyone.)
//
// THE VALUE IS UNIQUE WITHIN ITS KIND, and nothing declares that — the key's
// own id is `sha256("<tag>|<value>")` (./eid.ts), so two writers who state the
// same value in the same kind land on one row by construction. A `unique` on
// the column would have been wrong anyway: two kinds may hold the same word,
// and only the pair is the constraint.
//
// Both columns yield their bare words (`bare: false`): `of` and `value` are far
// too ordinary to be claimed vocabulary-wide, so they are said in full —
// `.key.value=lemon-cake`.
//
// The document itself is `./vocab.json` — plain JSON Schema, readable by
// anything that reads JSON. This file re-exports it under the name callers say
// and keeps the prose about why it is shaped the way it is.

import type { Bundle, Comp, Eid } from '@yaks/graph'
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import { KEY } from './kinds.ts'

/** The column naming what the value is for. */
export let OF = 'of'

/** The column carrying the value. */
export let VALUE = 'value'

/**
 * The `key` component as a vocabulary document, to load beside your own:
 * `loadVocab([keyDoc, ...mine], [keyKeywords])`. The kind tags are yours
 * to declare — this document is only the carrier.
 */
export let keyDoc: VocabDoc = doc

/** The key a bundle states, if it states one. */
export let keyOf = (b: Bundle): Comp | undefined => {
  let comp = b[KEY]
  return comp && typeof comp == 'object' ? comp as Comp : undefined
}

// One column of a stated key, as the non-empty string it is or nothing.
let said = (b: Bundle | undefined, col: string): string | undefined => {
  let v = b && keyOf(b)?.[col]
  return typeof v == 'string' && v ? v : undefined
}

/** The value a bundle states — an absent component, a cleared one and an empty
 * string all say it states none. */
export let valueOf = (b: Bundle): string | undefined => said(b, VALUE)

/** What a bundle's key names, if it names anything. */
export let ofOf = (b: Bundle | undefined): Eid | undefined => said(b, OF)
