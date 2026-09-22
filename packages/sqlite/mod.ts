// @yaks/sqlite — a storage adapter that turns the yaks query/vocabulary/SQL
// stack into a working SQLite-backed store. It composes three sibling packages:
//
//   @yaks/query   parses a query string into an AST
//   @yaks/vocab   describes a component vocabulary and interrogates it
//   @yaks/sql     compiles an AST + a vocabulary into SQL + bound params
//
// and adds the two halves those packages leave to a backend: DDL (the schema a
// vocabulary implies) and writes (a patch applied to that schema). The reads it
// gets for free — it runs @yaks/sql's compiled statement and gathers the rows.
//
// Both halves are the reference every SQLite-shaped adapter shares. The schema
// is one derivation, and so is the write: ./write.ts builds each write as a
// self-sufficient statement — an owner id is a subquery, never a value looked up
// first — so the same statements this package runs one at a time are the ones
// @yaks/d1 gathers into a single batch.
//
// The model is the yaks entity graph: everything is an entity (a string id)
// carrying components (a row per component table). An entity is what its
// components make it — a blog post is a `doc` plus a `post`; a product is a
// `doc` plus a `price`. Each component covers one aspect of an entity; the set
// of components an entity carries is its identity. A read returns a bundle (an
// entity with its components gathered); a write takes a batch of bundles and
// patches them in — omitted columns untouched, a null column cleared, a null
// component dropped.
//
// It implements @yaks/graph's `Storage`, which is where the responsibilities
// divide: this package owns the bytes (schema, rows, identity, transactions)
// and @yaks/graph owns the decisions (admission, preconditions, which entities
// a delete takes with it, provenance). Point `graph()` at a store from here
// and the two halves are the whole thing.
//
// Beside the graph it keeps one thing of its own: `server_meta`, the key/value
// a store writes about itself — its lineage epoch, a sweep's mark — read and
// written through ./meta.ts, and carried by no bundle.
//
// The adapter is bound to a driver and a vocabulary once, by `storage()`, and
// reads and writes bundles from then on. The driver is any object with
// `query`/`exec` (see ./driver.ts) — an in-process SQLite for a test, a pooled
// handle for a server — so nothing here names a concrete SQLite library.

import type { Vocab } from '@yaks/vocab'
import type { BindOpts } from '@yaks/sql'
import type {
  Binding,
  Bundle,
  Doom,
  Entity,
  Match,
  ReadOpts,
} from '@yaks/graph'
import type { Driver, Row } from './driver.ts'
import type { Query } from './read.ts'
import {
  analyzed,
  grown,
  indexed,
  refit,
  schema,
  tabled,
  type Text,
} from './ddl.ts'
import { epoch } from './meta.ts'
import { doom, read, rows } from './read.ts'
import { keyed } from './keyed.ts'
import { unit } from './unit.ts'
import { backfill } from './archetype.ts'
import { patch, remove } from './write.ts'
import { bindings } from './rules.ts'

export * from './driver.ts'
export * from './archetype.ts'
export { catalog } from './catalog.ts'
export { fold, pointers } from './fold.ts'
export { GONE, OVER, type Overlay, overlay } from './overlay.ts'
export { bindings, matched, prefixed, statement } from './rules.ts'
export * from './bundle.ts'
export {
  analyzed,
  grown,
  indexed,
  META,
  refit,
  schema,
  tabled,
  type Text,
} from './ddl.ts'
export { EPOCH, epoch, type Meta, meta } from './meta.ts'
export {
  compSql,
  doom,
  get,
  OWNER,
  type Query,
  read,
  rows,
  setSql,
} from './read.ts'
export {
  buried,
  dropSql,
  minted,
  mintSql,
  patch,
  patchSql,
  remove,
  removeSql,
  type Spine,
  spines,
  type Sql,
  touched,
  upsertSql,
} from './write.ts'
export type { Storage } from '@yaks/graph'

/**
 * A transaction over an embedded database: the same shape @yaks/graph's `Tx`
 * has, with every method returning immediately rather than a promise. Naming
 * the synchronous form is what lets `apply()` stay synchronous over SQLite —
 * and lets a caller of this package read a bundle without awaiting one.
 */
export type Tx = {
  /** a query → the matching entities as whole bundles */
  read: (query: Query, opts?: ReadOpts) => Bundle[]
  /** identity, not search: these entities as they stand, whole */
  get: (eids: string[]) => Bundle[]
  /** identity/tombstone state and selected components (may return a
   * superset) */
  pick: (eids: string[], names: string[]) => Bundle[]
  /** which entities are deleted along with these, and what has to release
   * them — the death cascade computed by one recursive statement rather than a
   * read per level */
  doom: (eids: string[]) => Doom
  /** what declared rules are evaluated through: every match run against this
   * graph with `batch` folded in, through one batch overlay (./overlay.ts) */
  bindings: (
    matches: Match[],
    batch: Bundle[],
    covers: string[],
  ) => Binding[][]
  /** patch the bundles in → the entities this patch minted */
  patch: (bundles: Bundle[]) => Entity[]
  /** remove these entities: rows gone, identity tombstoned */
  remove: (entities: Entity[]) => void
}

/**
 * A bound store: @yaks/graph's {@link Storage}, implemented synchronously. It
 * is the same five members, each narrowed to what an embedded database can
 * guarantee — so it satisfies `Storage` wherever one is wanted, and a caller
 * holding a `Store` directly never has to await a row.
 */
// A read here takes the compiler's whole options, not just @yaks/graph's
// `ReadOpts`: a caller of this package may pass a query a derived-column
// registry or an @yaks/sql extension — the extension point @yaks/fts and
// @yaks/embedding register through — and it would be unreachable if this
// method only took `now`. `ReadOpts` is assignable to `BindOpts`, so the wider
// signature still satisfies `Storage` wherever the generic contract is what is
// wanted.
export type Store = {
  /** the schema statements the bound vocabulary implies */
  ddl: () => string[]
  /**
   * the `add column` statements the live tables are missing — what `ddl()`
   * cannot emit, since `create table if not exists` does nothing to a table
   * that already exists (ddl.ts `grown`). Read after `ddl()` has run.
   */
  grown: () => string[]
  /** run them — create the tables and indexes the vocabulary needs */
  install: () => void
  /** a query → the matching entities as whole bundles */
  read: (query: Query, opts?: BindOpts) => Bundle[]
  /** a query → the compiled statement's raw rows (counts, tallies) */
  rows: (query: Query, opts?: BindOpts) => Row[]
  /** run `body` in a transaction: commit on return, roll back on throw */
  tx: <R>(body: (tx: Tx) => R) => R
}

/**
 * What `storage()` is bound with: @yaks/sql's read options (a derived-column
 * registry, a fixed `now` for time phrases), plus `text` — how a column whose
 * stored value is not the text itself reads as text through `doc_value`,
 * rather than returning, for example, a blob's address (`blobText(vocab)` from
 * @yaks/blob is one). The read options apply to every read; `text` applies to
 * the schema.
 */
export type Opts = BindOpts & {
  text?: Text
  /** Give new spines a human-readable number. Opt-IN: left out, an entity is
   * its eid and nothing else, which is what a store whose entities nobody ever
   * types the number of wants. Identity, and reporting which entities were
   * created, still belong to storage either way. */
  number?: boolean | { except: readonly string[] }
  /** Adopt the `num` a patch's identity carries instead of minting one — a
   * given number for the entity to take, an explicit `null` for one that is to
   * have none. What a store mirroring another graph needs, and the same option
   * name @yaks/ram uses: a batch from another store is stating the identity,
   * not requesting one. Off by default, because a store nobody mirrors owns
   * its own numbering. */
  adopt?: boolean
}

/**
 * Bind a store to a driver and a vocabulary — a {@link Storage} @yaks/graph
 * can apply changes to. `base` options (a derived-column registry, a fixed
 * `now` for time phrases) ride every read; a per-call `opts` merges over them.
 */
export let storage = (
  driver: Driver,
  vocab: Vocab,
  base: Opts = {},
): Store => {
  let identity = keyed(driver, vocab, base)
  let tx: Tx = {
    read: (query, opts) => read(driver, vocab, query, { ...base, ...opts }),
    get: (eids) => identity(eids),
    pick: identity,
    doom: (eids) => doom(driver, vocab, eids),
    bindings: (matches, batch, covers) =>
      bindings(driver, vocab, matches, batch, covers, base),
    patch: (bundles) => patch(driver, vocab, bundles, base.number, base.adopt),
    remove: (entities) => remove(driver, vocab, entities),
  }
  return {
    ddl: () => schema(vocab, base.text),
    grown: () => grown(driver, vocab),
    install: () => {
      for (let stmt of tabled(vocab, base.text)) driver.exec(stmt)
      // Then the columns a component gained since its table was created — the
      // half `create table if not exists` cannot add (ddl.ts `grown`), read
      // after the creates so a brand-new table is already there to inspect.
      for (let stmt of grown(driver, vocab)) driver.exec(stmt)
      // Then the tables whose foreign keys the vocabulary has since changed
      // its mind about (ddl.ts `refit`). A rebuild drops the table, so it runs
      // outside the enforcement — a copy that re-checks every key it is
      // dropping would reject the rows it exists to keep — and before the
      // indexes, which the drop took with the old table.
      let rebuilt = refit(driver, vocab)
      if (rebuilt.length) {
        driver.exec('pragma foreign_keys = off')
        try {
          for (let stmt of rebuilt) driver.exec(stmt)
        } finally {
          driver.exec('pragma foreign_keys = on')
        }
      }
      // The indexes last: one may name a column this boot just added.
      for (let stmt of indexed(vocab)) driver.exec(stmt)
      // The store's lineage identity, minted on the first install and read
      // back on every one after (meta.ts `epoch`).
      epoch(driver)
      if (vocab.comp('archetype')) {
        backfill(
          driver,
          typeof base.number == 'object'
            ? !base.number.except.includes('archetype')
            : base.number,
        )
      }
      // And the sizes those tables are read with (ddl.ts `analyzed`). An index
      // the planner cannot size is half an index: it costs a scan of the whole
      // spine to find the fifty thousand rows that carry a component. Last,
      // because it measures what the statements above just raised.
      analyzed(driver)
    },
    read: (query, opts) => read(driver, vocab, query, { ...base, ...opts }),
    rows: (query, opts) => rows(driver, vocab, query, { ...base, ...opts }),
    tx: (body) => unit(driver, () => body(tx)),
  }
}

export * from './migration.ts'
