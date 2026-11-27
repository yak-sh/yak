import { identityIn, type Presence, type Vocab } from '@yaks/vocab/runtime'
import { eq, type Expr, fn, gt, lit, or } from './ast.ts'

/** What a stored descriptor (@yaks/archetype) may hold for a component, as a
 * statement over its entries asks for it (a store's `membership`): the
 * component's identity, and its name too while a descriptor written before
 * its word had an identity stands, until the migration rewrites those
 * (T-162475).
 *
 * ```ts
 * import { entriesFor } from '@yaks/sql'
 * import { loadVocab } from '@yaks/vocab'
 * import { equal } from '@yaks/testing'
 *
 * let id = crypto.randomUUID()
 * let v = loadVocab({ $defs: {
 *   note: { component: true, $id: `urn:uuid:${id}` },
 *   tag: { component: true },
 * } })
 * equal(entriesFor(v, 'note'), [id, 'note'])
 * equal(entriesFor(v, 'tag'), ['tag'])
 * ```
 */
export let entriesFor = (
  v: Pick<Vocab, 'comp'> | undefined,
  comp: string,
): string[] => {
  let id = v ? identityIn(v, comp) : comp
  return id == comp ? [comp] : [id, comp]
}

/** That a descriptor's stored text, `tables` (`archetype.tables`), holds the
 * component `comp`: a search of its text for each entry it may name `comp` by
 * ({@link entriesFor}). */
export let descriptorHolds = (
  tables: Expr,
  v: Pick<Vocab, 'comp'> | undefined,
  comp: string,
): Expr =>
  or(
    ...entriesFor(v, comp).map((e) =>
      gt(fn('instr', tables, lit(JSON.stringify(e))), lit(0))
    ),
  )

/** That a descriptor entry, `entry`, names the component `comp`
 * ({@link entriesFor}), each form written into the statement. */
export let entryIs = (
  entry: Expr,
  v: Pick<Vocab, 'comp'> | undefined,
  comp: string,
): Expr => or(...entriesFor(v, comp).map((e) => eq(entry, lit(e))))

/**
 * A snapshot of this database file's archetypes, mapped to the integer ids
 * their rows in the entity table have. Returning undefined declines, because
 * the catalog is incomplete; returning [] means no archetype matches. `held`
 * says the snapshot is in memory, so asking reads no descriptor rows: a plan
 * that can do without the catalog asks it only then. `masked` names the
 * components a reader's visibility hides some rows of: a stored shape cannot
 * settle their presence, so a test naming one declines, and a plan keeps
 * those tests as row conditions beside the shape of the rest.
 */
export type ArchetypeSet =
  & ((
    predicate: Presence,
  ) => readonly number[] | undefined)
  & {
    held?: boolean
    masked?: ReadonlySet<string>
    pending?: {
      /** Owners whose open write supersedes their stored pointer. */
      ids: readonly number[]
      matching: (predicate: Presence) => readonly number[]
    }
  }

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
