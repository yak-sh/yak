// The storage interface: the one thing this package does not implement. A
// `Storage` holds the data — it turns a vocabulary into a schema, answers
// queries as bundles, and opens transactions. `apply()` never writes a row
// itself; it decides what should happen and tells a transaction to do it.
//
// Two rules keep this interface small. First, every method is async or sync:
// an embedded database returns immediately, a remote one returns a promise,
// and `apply()` handles either (see ./pipe.ts). Second, identity belongs to
// storage: `patch` creates whatever identity row an eid needs and returns the
// entities it created, including the `num` if the adapter assigns one.

import type { Query as Ast } from '@yaks/query'
import type { Bundle, Eid, Entity } from './bundle.ts'
import type { Binding, Match } from './join.ts'

/** One raw result row from a storage read — column name → value. */
export type Row = Record<string, unknown>

/** A query, as text (parsed by @yaks/query) or an already-parsed AST. */
export type Query = string | Ast

/** Options passed with a read, such as a fixed `now` for relative time
 * expressions. */
export type ReadOpts = { now?: number; durable?: boolean }

/** One entity the cascade deletes, and how far from the original delete it
 * was: the entities the change named are depth 0, the ones deleted with them
 * are depth 1, and so on. This is also the order they are returned in. */
export type Gone = { eid: Eid; depth: number }

/** One reference to clear: a surviving entity's `detach` or `release` property
 * pointing at one of the deleted entities. */
export type Loose = { eid: Eid; comp: string; prop: string }

/** What else gets deleted along with the entities a change deleted, and which
 * references have to be cleared — the whole question ./cascade.ts asks, so a
 * storage adapter that can answer it in one statement answers it in one
 * call. */
export type Doom = { gone: Gone[]; loose: Loose[] }

/**
 * An open transaction. Every phase of `apply()` between `precondition` and
 * `commit` runs against one of these, so a precondition reads the state the
 * change will be written onto, and a cascade sees the rows it is about to
 * remove. The adapter commits when the body returns and rolls back if it
 * throws.
 */
export type Tx = {
  /** a query → the matching entities as whole bundles */
  read: (query: Query, opts?: ReadOpts) => Bundle[] | Promise<Bundle[]>
  /** the same result as `read`, in one round trip: an adapter that talks over
   * a network embeds the matching set as a subquery in each statement of its
   * read, so the whole result is one request instead of one request to learn
   * the eids and another to fetch them. Only valid for a query that selects a
   * set — a windowed query would be re-evaluated per statement and could break
   * a tie differently in each — so the reverse-reference reads (./gather.ts
   * `pointing`) use it and nothing else does. An adapter with nothing to gain
   * leaves it out and `read` is used instead, which is why every read here is
   * written to work either way. */
  whole?: (query: Query, opts?: ReadOpts) => Bundle[] | Promise<Bundle[]>
  /** lookup by identity, not search: these entities as they stand. A deleted
   * one comes back carrying `tombstone`; one that does not exist is simply
   * absent from the result. `comps` names the components to read, and each
   * entity carries those of them it holds; left out, it carries every one. A
   * storage reads nothing else. The transaction `apply()` hands its hooks
   * answers from what it has already read, which may carry more
   * (./gather.ts `holding`). */
  get: (eids: Eid[], comps?: string[]) => Bundle[] | Promise<Bundle[]>
  /** the reverse direction: the entities whose reference properties point at
   * one of these, narrowed to the components named. Present only on the
   * transaction `apply()` hands its hooks, where the gather has already read
   * it (./gather.ts `holding`); read it through `about()` rather than calling
   * it directly, since `about()` falls back to a `read` when no gather ran. */
  about?: (eids: Eid[], comps?: string[]) => Bundle[] | Promise<Bundle[]>
  /** the whole delete cascade question, asked once: what else gets deleted
   * with these, and which references have to be cleared (see {@link Doom}).
   * Optional, and it may decline by returning `null` — a storage adapter that
   * can compile the whole closure into one statement (@yaks/sql's `doomSql`)
   * answers; one that cannot, or whose answer would be about rows it has not
   * written yet, returns null and ./cascade.ts walks the references
   * itself. */
  doom?: (eids: Eid[]) => Doom | null | Promise<Doom | null>
  /** what the declared rules run through: evaluate each match against this
   * graph with `batch` folded in, as though it had already been applied.
   * `covers` names the components the matches read, so a store building an
   * overlay of the pending change builds only those. A storage adapter without
   * this method runs no declared rules — a rule is a query, and a store that
   * cannot evaluate one can say nothing about it. */
  bindings?: (
    matches: Match[],
    batch: Bundle[],
    covers: string[],
  ) => Binding[][] | Promise<Binding[][]>
  /** write the bundles → the entities this patch created, with their `num`
   * when the adapter assigns one. An adapter whose numbers are picked by the
   * database may not know them yet — it fills each `num` into the very entity
   * object it returned, before its `tx()` settles. `apply()` reads them only
   * when it builds its return value, which happens after that. A bundle for
   * a tombstoned entity writes nothing. */
  patch: (bundles: Bundle[]) => Entity[] | Promise<Entity[]>
  /** remove these entities: their component rows are deleted, and their
   * identity is tombstoned, keeping its eid and number */
  remove: (entities: Entity[]) => void | Promise<void>
  /** bring these tombstoned entities back: the tombstone clears, the identity
   * keeps its eid and number, and no component returns — the patch that
   * follows gives each what it holds. Which writes may do this is the mutate
   * phase's decision (./mutate.ts); an eid that is not tombstoned is left
   * alone. */
  revive: (eids: Eid[]) => void | Promise<void>
}

/**
 * A storage adapter. `@yaks/sqlite` implements this over an embedded database;
 * an in-memory map, a Durable Object and a remote SQL service implement the
 * same members. `tx` opens a transaction: it runs the body against a
 * {@link Tx} and returns whatever the body returned, so a synchronous adapter
 * keeps `apply()` synchronous and an asynchronous one makes it return a
 * promise.
 */
export type Storage = {
  /** make the store ready for the bound vocabulary: its schema, where it has
   * one */
  install: () => void | Promise<void>
  /** a query → the matching entities as whole bundles */
  read: (query: Query, opts?: ReadOpts) => Bundle[] | Promise<Bundle[]>
  /** a query → the compiled statement's raw rows (counts, tallies) */
  rows: (query: Query, opts?: ReadOpts) => Row[] | Promise<Row[]>
  /** these entities as they stand, carrying the components `comps` names or
   * every one ({@link Tx.get}), read without a write transaction: a lookup
   * never waits on a writer and never makes one wait, the way `read` does
   * not */
  get: (eids: Eid[], comps?: string[]) => Bundle[] | Promise<Bundle[]>
  /** run `body` in a transaction: commit on return, roll back on throw. Like
   * every other member it is async or sync — an embedded adapter returns
   * whatever the body returned, an adapter over a network returns a promise
   * that settles once the transaction has committed. */
  tx: <R>(body: (tx: Tx) => R) => R | Promise<Awaited<R>>
}

/**
 * A `Tx` that is not a transaction: each call is its own unit of work against
 * the storage. This is what a hook receives in the phases that run outside the
 * change's transaction — `normalize` before it opens, `effect` after it
 * commits, `audit` after it rolled back — where writing into the change's
 * transaction is either impossible or exactly the wrong thing.
 */
export let detached = (storage: Storage): Tx => ({
  read: (query, opts) => storage.read(query, opts),
  get: (eids, comps) => storage.get(eids, comps),
  // A match is a question about committed data, which is exactly what there
  // is to ask out here: an effect registered on a pattern (@yaks/effects) asks
  // it after the change has been applied. A store that cannot evaluate one
  // throws when it is asked rather than omitting the method, because whether
  // it can is not known until a transaction is open.
  bindings: (matches, batch, covers) =>
    storage.tx((tx) => {
      if (!tx.bindings) {
        throw new Error(
          'this storage evaluates no bindings — a match is a ' +
            'query, and it cannot evaluate one',
        )
      }
      return tx.bindings(matches, batch, covers)
    }),
  patch: (bundles) => storage.tx((tx) => tx.patch(bundles)),
  remove: (entities) => storage.tx((tx) => tx.remove(entities)),
  revive: (eids) => storage.tx((tx) => tx.revive(eids)),
})
