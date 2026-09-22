// What a graph looks like from here: the structural shapes the two plugins in
// this package need, and deliberately not an import of
// {@link https://jsr.io/@yaks/graph | @yaks/graph}'s own — each of these is one
// of those, and passes wherever one is asked for.
//
// The dependency between the two packages runs one direction, and this is the
// leaf end of it: @yaks/sql reads a human id (`B-7` is the entity numbered 7)
// with this package's `parse`, and @yaks/graph is built over @yaks/sql, so
// @yaks/graph sits above this package. @yaks/match states the same thing about
// a bundle for the same reason.

import type { VocabDoc } from '@yaks/vocab'

/** An entity's id: a client-minted string (a uuid, or a content hash). */
export type Eid = string

/** An entity's identity: the eid, and the number this package's plugin gives
 * it. */
export type Entity = { eid: Eid; num?: number | null }

/** A bundle: the identity under `entity`, every component under its own name,
 * columns inside, plus the `$`-prefixed requests that ride beside them. */
export type Bundle = {
  entity: Entity
  [comp: string]:
    | Record<string, unknown>
    | null
    | boolean
    | string
    | undefined
}

/** A transaction, as these plugins use one: read entities by id, or by query. */
export type Tx = {
  get: (eids: Eid[]) => Bundle[] | Promise<Bundle[]>
  read: (query: string) => Bundle[] | Promise<Bundle[]>
}

/** A graph plugin, narrowed to what this package contributes: a vocabulary,
 * the `$` requests it answers, one write hook, and the door that turns an id a
 * person typed into an eid. */
export type Plugin = {
  name: string
  vocab?: VocabDoc[]
  requests?: string[]
  hooks?: {
    cascade?: (bundles: Bundle[], tx: Tx) => Bundle[] | Promise<Bundle[]>
  }
  address?: (
    tx: Tx,
    ids: string[],
  ) => Map<string, Eid> | Promise<Map<string, Eid>>
}
