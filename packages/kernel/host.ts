// The server's own identity: the entity a host signs its own writing with.
//
// A write has an author even when nobody is at a door. The rules a batch
// fires, the effects that run after it commits, the pass a plugin makes at
// boot, a file somebody pours in — all of it is the HOST writing, and a graph
// where that lands as `created.by` null is a graph that cannot say who did
// half of what is in it.
//
// So a host is an entity like everything else, and it is named by what it is
// CALLED: `hostEid` derives the id from the name the config gave it, the way
// a key is named by its value and an edge by its sentence. Nothing has to be
// looked up, nothing has to be written down twice, and the same name is the
// same host in every graph it writes to — which is what makes minting the row
// idempotent and a config able to name its own writer without pasting a uuid.

import { type Bundle, derivedEid, type Eid } from '@yaks/graph'

/** The component a host wears. */
export let HOST = 'host'

/**
 * The id a host runs under: `sha256("host|<name>")` worn as a uuid, the one
 * derivation everything content-addressed here shares.
 *
 * ```ts
 * hostEid('yak') == hostEid('yak') // true
 * ```
 */
export let hostEid = (name: string): Eid => derivedEid(`${HOST}|${name}`)

/**
 * The host itself, as the bundle that mints it. Written every time a server
 * starts, which costs one idempotent patch and means a graph always holds the
 * row its own provenance points at.
 */
export let hosted = (name: string): Bundle => ({
  entity: { eid: hostEid(name) },
  [HOST]: { name },
})
