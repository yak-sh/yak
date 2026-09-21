// `keyed()` and `unkeyed()`: the bundle that claims a value, and the bundle
// that gives it back.
//
// A key is written the way everything else is — as a bundle passed to
// `graph.apply()`. The entity's id is derived from the kind and the value, so
// it needs no id from anywhere: `keyed()` computes it, and writing the same
// value twice in one transaction writes one entity.
//
// Retiring a value is not a DELETE of the entity. The value is simply no longer
// claimed, and the same value may be claimed again tomorrow — by this entity or
// another — so its COMPONENTS are removed and the entity itself stays. An
// entity carrying no components is invisible to every reader; deleting it
// instead would tombstone an id DERIVED from the kind and the value, and a
// tombstone is forever: `lemon-cake` could never be used again.

import type { Bundle, Eid } from '@yaks/graph'
import { keyEid } from './eid.ts'
import { KEY } from './kinds.ts'
import { OF, VALUE } from './comp.ts'

/**
 * The bundle that claims a value: `keyed('alias', r, 'lemon-cake')`. `kind` is
 * the tag component the key carries.
 */
export let keyed = (kind: string, of: Eid, value: string): Bundle => ({
  entity: { eid: keyEid(kind, value) },
  [KEY]: { [OF]: of, [VALUE]: value },
  [kind]: {},
})

/**
 * The bundle that gives that value back: both components deleted, the entity
 * left standing so the same value can be claimed again.
 */
export let unkeyed = (kind: string, value: string): Bundle => ({
  entity: { eid: keyEid(kind, value) },
  [KEY]: null,
  [kind]: null,
})
