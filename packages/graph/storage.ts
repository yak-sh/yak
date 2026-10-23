// The storage interface: the one thing this package does not implement. A
// `Storage` holds the data — it turns a vocabulary into a schema, answers
// queries as bundles, and opens transactions. `apply()` never writes a row
// itself; it decides what should happen and tells a transaction to do it.
//
// Two rules keep this interface small. First, every method is async or sync:
// an embedded database returns immediately, a remote one returns a promise,
// and `apply()` handles either (see @yaks/fp `after`). Second, identity belongs to
// storage: `patch` creates whatever identity row an eid needs and returns the
// entities it created, including the `num` if the adapter assigns one.

import type { Query as Ast } from '@yaks/query'
import type { Bundle, Eid, Entity } from './bundle.ts'
import type { Binding, Match } from './join.ts'

/** One raw result row from a storage read — column name → value. */
export type Row = Record<string, unknown>

/** A query, as text (parsed by @yaks/query) or an already-parsed AST. */
export type Query = string | Ast

/** The owners visible in a read. Component queries hide that component while
 * preserving the entity's other aspects. Evaluated against committed rows. */
export type Visibility = {
  entity?: Query
  components?: Record<string, Query>
}

/** Options passed with a read, such as a fixed `now` for relative time
 * expressions. */
export type ReadOpts = {
  /** The caller stopped waiting. Read executors may cancel their own work;
   * this never cancels an admitted write. */
  signal?: AbortSignal
  /** Restrict root candidates to canonical eids, before shaping the answer.
   * Referenced entities and query operands keep their ordinary semantics. */
  eids?: readonly Eid[]
  /** Authenticated person; null is a guest, absent is an internal read. */
  person?: Eid | null
  /** Explicit administrative access vouched by the host. */
  administrative?: boolean
  /** Relational visibility, applied before predicates, references and shaping. */
  visibility?: Visibility
  /** Answering applied patches rather than complete read snapshots. */
  patch?: boolean
  /** Vocabulary versions spoken by the caller, keyed by package eid. */
  speaks?: Record<string, number>
  /** Read the storage vocabulary directly, for already rewritten queries and
   * subscription membership; skip ask/answer hooks. */
  native?: boolean
  now?: number
  /** Page in physical insertion order, ignoring imported entity numbers. Only
   * unordered windows use it; a missing eid cursor answers an empty page. */
  storageOrder?: boolean
  /** Accept any matching rows when no order or cursor is requested. */
  unordered?: boolean
  /** Match the deleted too: a tombstoned entity holds no component, is
   * matched as an entity holding nothing would be, and comes back carrying
   * `tombstone`. Under a `visibility`, only the deleted the scope would have
   * seen as they last were, as their history tells (@yaks/sql `ghostly`), as
   * a get answers and a reference names them. What finds the entity a deleted
   * entity's number still names (@yaks/id). */
  graves?: boolean
  durable?: boolean
  /** A graph-local runtime activity parent; storage adapters need not use it. */
  parent?: string
}

/** One entity the cascade deletes, and how far from the original delete it
 * was: the entities the batch named are depth 0, the ones deleted with them
 * are depth 1, and so on. This is also the order they are returned in. */
export type Gone = { eid: Eid; depth: number }

/** One reference to clear: a surviving entity's `detach` or `release` property
 * pointing at one of the deleted entities. */
export type Loose = { eid: Eid; comp: string; prop: string }

/** What else gets deleted along with the entities a batch deleted, and which
 * references have to be cleared — the whole question ./cascade.ts asks, so a
 * storage adapter that can answer it in one statement answers it in one
 * call. */
export type Doom = { gone: Gone[]; loose: Loose[] }

/**
 * An open transaction. Every phase of `apply()` between `precondition` and
 * `commit` runs against one of these, so a precondition reads the state the
 * batch will be written onto, and a cascade sees the rows it is about to
 * remove. The adapter commits when the body returns and rolls back if it
 * throws.
 */
export type Tx = {
  /** The id of the transaction this unit's kept versions name, taken on the
   * first ask; only a store that keeps history has one (@yaks/sqlite
   * `History`). Its history plugin writes the transaction's row under it. */
  clock?: () => number
  /** a query → whole bundles, or only `comps` when named */
  read: (
    query: Query,
    opts?: ReadOpts,
    comps?: string[],
  ) => Bundle[] | Promise<Bundle[]>
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
  get: (
    eids: Eid[],
    comps?: string[],
    opts?: ReadOpts,
  ) => Bundle[] | Promise<Bundle[]>
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
   * graph with `bundles` folded in, as though it had already been applied.
   * `covers` names the components the matches read, so a store building an
   * overlay of the pending batch builds only those. A storage adapter without
   * this method runs no declared rules — a rule is a query, and a store that
   * cannot evaluate one can say nothing about it. */
  bindings?: (
    matches: Match[],
    bundles: Bundle[],
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
  /** Erase identity rows already checked as empty and unreferenced by the
   * graph's explicit repair request. Ordinary deletion uses `remove`. */
  prune?: (eids: Eid[]) => void | Promise<void>
  /** bring these tombstoned entities back: the tombstone clears, the identity
   * keeps its eid and number, and no component returns — the patch that
   * follows gives each what it holds. Which writes may do this is the mutate
   * phase's decision (./mutate.ts); an eid that is not tombstoned is left
   * alone. */
  revive: (eids: Eid[]) => void | Promise<void>
  /** Up to `limit` tombstoned identities deleted before `before` (ISO-8601)
   * that nothing refers to: what a retention sweep may `$prune`. A walk goes
   * in the store's own order, resuming at `after`, the `next` the page before
   * it answered; a page that ends the walk answers none. A store that keeps
   * no deletion time leaves it out. */
  buried?: (
    before: string,
    page: { after?: string; limit: number },
  ) => Graves | Promise<Graves>
}

/** A page of graves, and where the walk resumes after them. */
export type Graves = { eids: Eid[]; next?: string }

/** What a store's file keeps: its bytes, how many of them are free, and each
 * table's bytes with its indexes and its rows. */
export type Measure = {
  bytes: number
  free: number
  tables: Record<string, [bytes: number, rows: number]>
}

/** Reads against committed data outside a write transaction. Writes go
 * through the graph's `apply()` so its admission, rules and effects run. */
export type ReadTx = Pick<
  Tx,
  'read' | 'get' | 'whole' | 'about' | 'bindings' | 'buried'
>

/**
 * A storage adapter. `@yaks/sqlite` implements this over an embedded database;
 * an in-memory map, a Durable Object and a remote SQL service implement the
 * same members. `tx` opens a transaction: it runs the body against a
 * {@link Tx} and returns whatever the body returned, so a synchronous adapter
 * keeps `apply()` synchronous and an asynchronous one makes it return a
 * promise.
 */
export type Storage = {
  /** A connection-local token invalidated by every committed data/schema
   * change, including other connections. Optional: read-result memoization
   * must not survive a call when the store cannot prove this token. */
  revision?: () => unknown
  /** Whether a value this store reads for the property means its entity
   * wears the component. A stored property's does; a computed one's may be
   * answered from elsewhere (@yaks/sql `worn`). */
  worn?: (comp: string, prop: string) => boolean
  /** make the store ready for the bound vocabulary: its schema, where it has
   * one. A store may answer what it had to leave undone, each already
   * reported (a table whose rows do not fit, a unique index they break); it
   * serves the shape it holds meanwhile. */
  install: () => void | Error[] | Promise<void | Error[]>
  /** a query → its entities, with `comps` only where the caller names them */
  read: (
    query: Query,
    opts?: ReadOpts,
    comps?: string[],
  ) => Bundle[] | Promise<Bundle[]>
  /** a query → the compiled statement's raw rows (counts, tallies) */
  rows: (query: Query, opts?: ReadOpts) => Row[] | Promise<Row[]>
  /** these entities as they stand, carrying the components `comps` names or
   * every one ({@link Tx.get}), read without a write transaction: a lookup
   * never waits on a writer and never makes one wait, the way `read` does
   * not */
  get: (
    eids: Eid[],
    comps?: string[],
    opts?: ReadOpts,
  ) => Bundle[] | Promise<Bundle[]>
  /** the graves a retention sweep may prune, read without a write
   * transaction ({@link Tx.buried}) */
  buried?: (
    before: string,
    page: { after?: string; limit: number },
  ) => Graves | Promise<Graves>
  /** The absolute path of the file it keeps its pages in, on the computer
   * that opened it. A store kept in memory or elsewhere leaves it out. */
  file?: string
  /** What the file keeps, read a table at a time without a write transaction,
   * so the work around it goes on; undefined once `signal` aborts. A store
   * that keeps no file of pages leaves it out. */
  measure?: (signal?: AbortSignal) => Promise<Measure | undefined>
  /** run `body` in a transaction: commit on return, roll back on throw. Like
   * every other member it is async or sync — an embedded adapter returns
   * whatever the body returned, an adapter over a network returns a promise
   * that settles once the transaction has committed. A refusal before the
   * body runs may carry `retryable: true`: no work ran or committed, so the
   * caller may safely retry the same transaction. */
  tx: <R>(body: (tx: Tx) => R, opts?: {
    /** Certified admission rehearses writes in memory. An adapter may reuse
     * coherent authoritative reads; permissions and rules still run afresh. */
    admission?: boolean
  }) => R | Promise<Awaited<R>>
}

/**
 * A `Tx` that is not a transaction: each call is its own unit of work against
 * the storage. This is what a hook receives in the phases that run outside the
 * batch's transaction — `normalize` before it opens, `effect` after it
 * commits, `audit` after it rolled back — where writing into the batch's
 * transaction is either impossible or exactly the wrong thing.
 */
export let detached = (storage: Storage): Tx => ({
  read: (query, opts, comps) => storage.read(query, opts, comps),
  get: (eids, comps, opts) => storage.get(eids, comps, opts),
  ...storage.buried
    ? { buried: (before, page) => storage.buried!(before, page) }
    : {},
  // A match is a question about committed data, which is exactly what there
  // is to ask out here: an effect registered on a pattern (@yaks/effects) asks
  // it after the batch has been applied. A store that cannot evaluate one
  // throws when it is asked rather than omitting the method, because whether
  // it can is not known until a transaction is open.
  bindings: (matches, bundles, covers) =>
    storage.tx((tx) => {
      if (!tx.bindings) {
        throw new Error(
          'this storage evaluates no bindings — a match is a ' +
            'query, and it cannot evaluate one',
        )
      }
      return tx.bindings(matches, bundles, covers)
    }),
  patch: (bundles) => storage.tx((tx) => tx.patch(bundles)),
  remove: (entities) => storage.tx((tx) => tx.remove(entities)),
  revive: (eids) => storage.tx((tx) => tx.revive(eids)),
})
