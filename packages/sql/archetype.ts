import type { Presence } from '@yaks/vocab'

/**
 * A snapshot of this database file's archetypes, mapped to the integer ids
 * their rows in the entity table have. Returning undefined declines, because
 * the catalog is incomplete; returning [] means no archetype matches.
 */
export type ArchetypeSet = (
  predicate: Presence,
) => readonly number[] | undefined

/** Anything that can report which archetype eids satisfy a presence test — the
 * one thing this binding needs, so the compiler never has to import the cache's
 * own package (@yaks/archetype sits above it, on @yaks/graph). */
export type Matching = { matching: (predicate: Presence) => readonly string[] }

/**
 * Combine cached, immutable matching on sets of component tables with a current
 * map of eids to integer ids. The caller owns that map: never keep a database
 * id across a rollback or another writer's commit. The matching itself may
 * outlive both, because it is about content; the integer ids may not, because
 * they are storage identity.
 */
export function archetypeSet(
  cache: Matching,
  ids: ReadonlyMap<string, number>,
): ArchetypeSet {
  let matched = new Map<readonly string[], readonly number[]>()
  return (predicate) => {
    let eids = cache.matching(predicate)
    let found = matched.get(eids)
    if (!found) {
      found = eids.flatMap((eid) => {
        let id = ids.get(eid)
        return id == null ? [] : [id]
      })
      matched.set(eids, found)
    }
    return found
  }
}
