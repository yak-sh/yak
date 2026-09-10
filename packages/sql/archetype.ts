import type { Archetypes, Presence } from '@yaks/archetype'

/**
 * A snapshot of the file's archetypes, mapped to local integer spine ids.
 * Undefined declines an incomplete catalog; [] means no archetype matches.
 */
export type ArchetypeSet = (
  predicate: Presence,
) => readonly number[] | undefined

/**
 * Bind immutable, cached table-set matching to a CURRENT id map. The caller
 * owns the snapshot: never retain a database id across rollback or another
 * writer's commit. Content may outlive both; storage identity may not.
 */
export function archetypeSet(
  cache: Archetypes,
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
