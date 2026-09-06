// Saying a value, and taking it back.
//
// A key is written the way everything else is — as a bundle. The entity is the
// pair itself, so it needs no id from anywhere: `keyed()` derives it, and a
// batch that states the same value twice writes one entity.
//
// Retiring a value is not a DEATH. The value is no longer claimed, and the same
// value may be claimed again tomorrow — by this entity or another — so its
// COMPONENTS go and the identity stays. An entity wearing nothing is invisible
// to every reader; deleting it instead would tombstone an id DERIVED from the
// pair, and a tombstone is forever: `lemon-cake` could never be a name again.

import type { Bundle, Eid } from '@yaks/graph'
import { keyEid } from './eid.ts'
import { KEY } from './kinds.ts'
import { OF, VALUE } from './comp.ts'

/**
 * The bundle that states a value: `keyed('alias', r, 'lemon-cake')`.
 * `kind` is the tag component the key wears.
 */
export let keyed = (kind: string, of: Eid, value: string): Bundle => ({
  entity: { eid: keyEid(kind, value) },
  [KEY]: { [OF]: of, [VALUE]: value },
  [kind]: {},
})

/**
 * The bundle that takes that value back: both components dropped, the identity
 * left standing so the same value can be claimed again.
 */
export let unkeyed = (kind: string, value: string): Bundle => ({
  entity: { eid: keyEid(kind, value) },
  [KEY]: null,
  [kind]: null,
})
