// The one component this package ships: `key{of, value}`.
//
// It is to a has-many VALUE what `edge{from, to}` is to a link. An entity does
// not hold its identifying values in a property; each value is a key entity of
// its own — `key{of, value}` plus a kind tag component naming which kind of
// value it is — so a recipe is identified by both `lemon-cake` and
// `recipe:2019-07` because two rows point at it, adding one is a write, and
// retiring one means deleting that row. A list property would have been the
// other design and it is the worse one: every write would be a
// read-modify-write of somebody else's property, and two writers adding a value
// at once would lose one.
//
// `of` is a reference declared `death: release`, which is the whole of a key's
// lifecycle: a value for a deleted thing identifies nothing, and the row is
// removed rather than the entity, so the value can be claimed again. (A cascade
// would tombstone an id derived from the value, and a tombstone is forever —
// the value could never be used again by anyone.)
//
// The value is unique within its kind, and nothing declares that — the key's
// own id is `sha256("<tag>|<value>")` (./eid.ts), so two writers giving the
// same value in the same kind land on one row by construction. A `unique` on
// the property would have been wrong anyway: two kinds may hold the same
// string, and only the pair is the constraint.
//
// Both properties give up their unqualified filter names (`bare: false`): `of`
// and `value` are far too ordinary to claim vocabulary-wide, so a filter names
// them in full — `.key.value=lemon-cake`.
//
// The document itself is `./vocab.json` — plain JSON Schema, readable by
// anything that reads JSON. This file re-exports it under the name callers
// import and holds the explanation of why it is shaped the way it is.

import type { Bundle, Comp, Eid } from '@yaks/graph'
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import { KEY } from './kinds.ts'

/** The property naming the entity the value identifies. */
export let OF = 'of'

/** The property carrying the value. */
export let VALUE = 'value'

/**
 * The `key` component as a vocabulary document, to load beside your own:
 * `loadVocab([keyDoc, ...mine], [keyKeywords])`. The kind tags are yours to
 * declare — this document is only the carrier.
 */
export let keyDoc: VocabDoc = doc

/** The `key` component in a bundle, if it has one. */
export let keyOf = (b: Bundle): Comp | undefined => {
  let comp = b[KEY]
  return comp && typeof comp == 'object' ? comp as Comp : undefined
}

// One property of a bundle's key, as a non-empty string, or nothing.
let said = (b: Bundle | undefined, prop: string): string | undefined => {
  let v = b && keyOf(b)?.[prop]
  return typeof v == 'string' && v ? v : undefined
}

/** The value in a bundle's key. An absent component, a cleared one and an
 * empty string all mean there is no value. */
export let valueOf = (b: Bundle): string | undefined => said(b, VALUE)

/** The entity a bundle's key identifies, if it identifies one. */
export let ofOf = (b: Bundle | undefined): Eid | undefined => said(b, OF)
