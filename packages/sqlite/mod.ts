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
// patches them in — omitted properties untouched, a null property cleared, a
// null component dropped.
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
// `query`/`exec` (@yaks/sql `Driver`) — an in-process SQLite for a test, a pooled
// handle for a server — so nothing here names a concrete SQLite library.

import type { Vocab } from '@yaks/vocab'
import {
  type BindOpts,
  type Derived,
  type Driver,
  type Raw,
  render,
  type Row,
  type Stmt,
  worn,
} from '@yaks/sql'
import type {
  Binding,
  Bundle,
  Doom,
  Eid,
  Entity,
  Match,
  ReadOpts,
} from '@yaks/graph'
import { sha256 } from '@yaks/graph'
import { after } from '@yaks/fp'
import { context, scope } from '@yaks/trace'
import type { Query } from './read.ts'
import {
  analyzed,
  atOnce,
  FIT,
  fit,
  grown,
  indexed,
  logged,
  retabled,
  retired,
  standing,
  tabled,
} from './ddl.ts'
import { EPOCH, epoch, installed, meta, SCHEMA } from './meta.ts'
import { doom, get, read, rows, screened, tagOf } from './read.ts'
import { unit } from './unit.ts'
import { backfill, entomb, ledger, reclassify } from './archetype.ts'
import { componentTables, shape } from './physical.ts'
import { patch, remove, revive } from './write.ts'
import { bindings } from './rules.ts'
import { memoized } from './memo.ts'
import { revision } from './revision.ts'

export * from './archetype.ts'
export { catalog } from './catalog.ts'
export {
  type Identity,
  identity,
  inspect,
  type StoreSize,
  type TableSize,
} from './inspect.ts'
export {
  asked,
  checks,
  columns,
  defined,
  heard,
  objects,
  type Stood,
} from './physical.ts'
export { GONE, OVER, type Overlay, overlay } from './overlay.ts'
export { bindings, matched } from './rules.ts'
export * from './bundle.ts'
export {
  analyzed,
  FIT,
  fit,
  fitting,
  grown,
  indexed,
  logged,
  META,
  refit,
  retired,
  schema,
  type Standing,
  standing,
  tabled,
  unfit,
  unresolved,
} from './ddl.ts'
export { EPOCH, epoch, epochAt, type Meta, meta } from './meta.ts'
export { decoded, isJsonb, jsonIn, jsonOut, projected } from './jsonb.ts'
export {
  compSql,
  doom,
  get,
  OWNER,
  type Query,
  read,
  rows,
  setSql,
  spine,
  tagOf,
} from './read.ts'
export {
  buried,
  dropSql,
  minted,
  mintSql,
  numberSql,
  patch,
  patchSql,
  remove,
  removeSql,
  revive,
  type Spine,
  spines,
  touched,
  unburySql,
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
  /** identity, not search: these entities as they stand, carrying the
   * components `comps` names or every one */
  get: (eids: string[], comps?: string[]) => Bundle[]
  /** which entities are deleted along with these, and what has to release
   * them — the death cascade computed by one recursive statement rather than a
   * read per level */
  doom: (eids: string[]) => Doom
  /** what declared rules are evaluated through: every match run against this
   * graph with `bundles` folded in, through one batch overlay (./overlay.ts) */
  bindings: (
    matches: Match[],
    bundles: Bundle[],
    covers: string[],
  ) => Binding[][]
  /** patch the bundles in → the entities this patch minted */
  patch: (bundles: Bundle[]) => Entity[]
  /** remove these entities: rows gone, identity tombstoned */
  remove: (entities: Entity[]) => void
  /** bring these tombstoned entities back: tombstone gone, identity kept */
  revive: (eids: string[]) => void
}

/**
 * A bound store: @yaks/graph's {@link Storage}, implemented synchronously. It
 * is the same five members, each narrowed to what an embedded database can
 * guarantee — so it satisfies `Storage` wherever one is wanted, and a caller
 * holding a `Store` directly never has to await a row.
 */
// A read here takes the compiler's whole options, not just @yaks/graph's
// `ReadOpts`: a caller of this package may pass a query a derived-property
// registry or an @yaks/sql extension — the extension point @yaks/fts and
// @yaks/embedding register through — and it would be unreachable if this
// method only took `now`. `ReadOpts` is assignable to `BindOpts`, so the wider
// signature still satisfies `Storage` wherever the generic contract is what is
// wanted.
export type Store = {
  /** Whether a value this store reads for the property means its entity
   * wears the component (@yaks/sql `worn`). */
  worn: (comp: string, prop: string) => boolean
  /** the schema statements the bound vocabulary implies */
  ddl: () => Stmt[]
  /**
   * the `add column` statements the live tables are missing — what `ddl()`
   * cannot emit, since `create table if not exists` does nothing to a table
   * that already exists (ddl.ts `grown`). Read after `ddl()` has run.
   */
  grown: () => Stmt[]
  /** run them — create the tables and indexes the vocabulary needs, and
   * classify what the archetype backfill finds unclassified; nothing, where
   * the file's schema is as this vocabulary last installed it */
  install: () => void
  /** a query → its entities, with `comps` only where named: which entities
   * match and what they carry read as one snapshot, in a unit that takes no
   * write lock, so another process's commit is seen whole or not at all */
  read: (query: Query, opts?: BindOpts, comps?: string[]) => Bundle[]
  /** a query → the compiled statement's raw rows (counts, tallies) */
  rows: (query: Query, opts?: BindOpts) => Row[]
  /** a query → a statement selecting the ids of the entities it admits, as
   * this store compiles its reads (./read.ts `screened`); null for a query
   * with nothing to narrow by */
  screen: (query: Query, opts?: BindOpts) => Raw | null
  /** these entities as they stand, carrying the components `comps` names or
   * every one, read in a unit that takes no write lock */
  get: (eids: Eid[], comps?: string[]) => Bundle[]
  /** run `body` in a transaction: commit on return, roll back on throw */
  tx: <R>(body: (tx: Tx) => R) => R
}

/**
 * What `storage()` is bound with: @yaks/sql's read options (a derived-property
 * registry, a fixed `now` for time phrases). They apply to every read, and the
 * registry's `text` expressions to the schema too: a property whose stored
 * value is not the text itself (a blob's address, @yaks/blob `blobRead`) reads
 * as text through `doc_value`.
 */
export type Opts = BindOpts & {
  /** A single-owner host's readiness check, called on the first operation.
   * True asserts that this vocabulary and its derived schema, metadata and
   * archetypes already stand; false asks this adapter to install them. The
   * host must bind a new store when its schema changes. File drivers ignore
   * this assertion: other connections can alter their schema. Explicit
   * `install()` always validates, regardless of this check. */
  schemaReady?: () => boolean
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
  /** Where a failure the store outlives is told: a table that stood and could
   * not be fitted to the vocabulary, left as it was (ddl.ts `fit`). One
   * line on the console, by default (ddl.ts `logged`). */
  report?: (error: Error) => void
}

// What `install()` runs, known once per vocabulary and read overrides: the
// fingerprint of its statements, the statements that create an object where
// it is missing, and the objects they create. Over a current file the
// rendering and the hashing were most of what an install cost, and none of it
// moves while a process holds the same vocabulary: a Vocab is a value nobody
// mutates once it is loaded, so the object itself is the key.
type Make = Extract<
  Stmt,
  { t: 'create table' | 'create index' | 'create view' | 'create trigger' }
>
type Plan = { print: string; raised: Make[]; made: string[] }
let makes = (s: Stmt): s is Make =>
  s.t == 'create table' || s.t == 'create index' || s.t == 'create view' ||
  s.t == 'create trigger'
let plans = new WeakMap<Vocab, WeakMap<Derived, Plan>>()
let NONE: Derived = {}
let plan = (vocab: Vocab, derived: Derived = NONE): Plan => {
  let by = plans.get(vocab) ?? new WeakMap<Derived, Plan>()
  plans.set(vocab, by)
  let known = by.get(derived)
  if (known) return known
  let stmts = [...tabled(vocab, derived), ...indexed(vocab)]
  let raised = stmts.filter(makes)
  let fresh = {
    // The fitting's revision rides beside them (ddl.ts `FIT`): what fitting
    // changes is read off the file, so a fitting that learns something new
    // installs again over a file whose statements are as they were.
    print: sha256([FIT, ...stmts.map((s) => render(s).sql)].join(';\n')),
    raised,
    made: raised.map((s) => s.name),
  }
  by.set(derived, fresh)
  return fresh
}

/**
 * Bind a store to a driver and a vocabulary — a {@link Storage} @yaks/graph
 * can apply bundles to. `base` options (a derived-property registry, a fixed
 * `now` for time phrases) ride every read; a per-call `opts` merges over them.
 */
export let storage = (
  driver: Driver,
  vocab: Vocab,
  base: Opts = {},
): Store => {
  // Every read's options: what the store was bound with, and each computed
  // component's backing tagged for this store (./read.ts `tagOf`) once the
  // first install has minted its epoch. Until then its entities have no names.
  let tagged: Opts | undefined
  let opts = (): Opts => {
    if (tagged || !base.backed) return tagged ?? base
    // Every caller has ensured schema readiness, including server_meta.
    let e = meta(driver).get(EPOCH)
    if (!e) return base
    let backed = Object.fromEntries(
      Object.entries(base.backed).map((
        [c, b],
      ) => [c, { ...b, tag: tagOf(e, c) }]),
    )
    return tagged = { ...base, backed }
  }
  let identity = (eids: string[], comps?: string[]) =>
    get(driver, vocab, eids, opts(), comps)
  let report = base.report ?? logged
  // Whether this store keeps archetypes, and whether their descriptors are
  // numbered like any other entity.
  let classified = !!vocab.comp('archetype')
  let numbered = typeof base.number == 'object'
    ? !base.number.except.includes('archetype')
    : !!base.number
  let memo = memoized(() => revision(driver, 'data'), vocab, base.derived)
  let tx: Tx = {
    read: (query, o) => read(driver, vocab, query, { ...opts(), ...o }),
    get: identity,
    doom: (eids) => doom(driver, vocab, eids),
    bindings: (matches, bundles, covers) =>
      bindings(driver, vocab, matches, bundles, covers, base),
    patch: (bundles) => patch(driver, vocab, bundles, base.number, base.adopt),
    remove: (entities) => {
      remove(driver, vocab, entities)
      if (classified) entomb(driver, entities.map((e) => e.eid), numbered)
    },
    revive: (eids) => revive(driver, eids),
  }
  // A unit over a store that keeps archetypes keeps every pointer in step,
  // whichever door wrote: @yaks/graph's tracker, a hook writing through a
  // detached transaction, a script patching through `tx`. Its ledger hears
  // each row that came or went and each pointer written (./archetype.ts
  // `ledger`); what it still owes when the body returns is classified from
  // what those entities hold (`reclassify`), in the same unit. Through the
  // graph that is nothing, since its tracker points every entity it moved, so
  // its writes gain no read. Removal points what it removes at the tombstone
  // set itself.
  let tracked = (): { tx: Tx; settle: () => void } => {
    let l = ledger()
    let settle = () => {
      let owed = l.owed()
      if (!owed.length) return
      reclassify(driver, owed, numbered)
      for (let eid of owed) l.pointed(eid)
    }
    return {
      tx: {
        ...tx,
        get: (eids, comps) => get(driver, vocab, eids, opts(), comps, l.owed()),
        // Pending component rows already stand in this transaction. Read them
        // directly rather than persisting an intermediate archetype just to
        // read before the graph's final stamp/tracker flush.
        read: (query, o) =>
          tx.read(query, {
            ...o,
            ...(l.owed().length ? { archetypes: () => undefined } : {}),
          }),
        patch: (bundles) => {
          let born = patch(
            driver,
            vocab,
            bundles,
            base.number,
            base.adopt,
            l.moved,
          )
          for (let e of born) l.born(e.eid)
          for (let b of bundles) {
            if (b.entity.archetype !== undefined) l.pointed(b.entity.eid)
          }
          return born
        },
        remove: (entities) => {
          tx.remove(entities)
          for (let e of entities) l.pointed(e.eid)
        },
        revive: (eids) => revive(driver, eids, l.moved),
      },
      settle,
    }
  }
  // The file's schema version as this store last looked, and how its own
  // objects stood then, all of them in place (physical.ts `shape`).
  let ready = false, version: unknown, own: string | undefined
  let changed = () =>
    driver.query({ t: 'pragma', name: 'schema_version' })[0]?.schema_version
  // Both, read in one snapshot.
  let look = (made: string[]) =>
    unit(driver, () => [changed(), shape(driver, made)] as const, 'read')
  let install = () => {
    let { print, made } = plan(vocab, base.derived)
    let mark = (strays: string[]) =>
      [print, shape(driver, [...made, ...strays]), ...strays].join(' ')
    let matches = () => {
      let was = installed(driver)
      return was == mark(was?.split(' ').slice(2) ?? [])
    }
    // The fast path only reads. A changed file is inspected again *after*
    // taking its write lock, and tables, growth and indexes commit together.
    if (!matches()) {
      let keys = (value: string): Stmt => ({
        t: 'pragma',
        name: 'foreign_keys',
        value,
      })
      let clean = false
      let seal = () => {
        epoch(driver)
        if (classified) backfill(driver, numbered)
        meta(driver).set(SCHEMA, mark(componentTables(driver, made)))
      }
      let make = () =>
        unit(driver, () => {
          if (matches()) return
          for (let stmt of retabled(driver, vocab, base.derived)) {
            driver.query(stmt)
          }
          let unfit = fit(driver, vocab)
          for (let stmt of retired(driver, vocab)) driver.query(stmt)
          for (let stmt of indexed(vocab)) driver.query(stmt)
          unfit.forEach(report)
          clean = !unfit.length
          // Memory templates keep schema, never a store's lineage identity.
          if (driver.file && clean) seal()
        })
      driver.query(keys('off'))
      try {
        // Templates are only for fresh in-memory files; file installs always
        // inspect their standing schema under BEGIN IMMEDIATE.
        let fresh = !installed(driver) &&
          !Object.keys(standing(driver, vocab)).length
        fresh && driver.template ? driver.template(print, make) : make()
        if (!driver.file) {
          unit(driver, () => {
            epoch(driver)
            if (classified) backfill(driver, numbered)
            if (fresh || clean) {
              meta(driver).set(SCHEMA, mark(componentTables(driver, made)))
            }
          })
        }
      } finally {
        driver.query(keys('on'))
      }
    }
    analyzed(driver)
    if (driver.file) [version, own] = look(made)
    ready = true
  }
  // Another connection changed the schema after this store installed: a peer
  // installing its own vocabulary (code that landed while this process ran,
  // or code it outlived), or now and then an installer that dropped something
  // this vocabulary made. Installing again would undo the peer's install, and
  // the peer's next read would undo this one: two vocabularies on one file
  // would take turns at the write lock on every read of every process, for as
  // long as both ran. So a store mends instead. Where one of its own objects
  // moved, it raises what is missing (tables, then columns, then the rest) and
  // drops, rebuilds and re-marks nothing; a change that moved none of them
  // costs one read. A mend never waits on another writer: the read that asked
  // goes on, and the next read mends.
  let mend = () => {
    let { raised, made } = plan(vocab, base.derived)
    let [seen, now] = look(made)
    if (now != own) {
      let mended = atOnce(driver, () =>
        unit(driver, () => {
          let table = (s: Make) => s.t == 'create table'
          for (let stmt of raised.filter(table)) driver.query(stmt)
          for (let stmt of grown(vocab, standing(driver, vocab))) {
            driver.query(stmt)
          }
          for (let stmt of raised) if (!table(stmt)) driver.query(stmt)
          return [changed(), shape(driver, made)] as const
        }))
      if (!mended) return
      ;[seen, now] = mended
    }
    ;[version, own] = [seen, now]
  }
  let ensure = () => {
    if (!ready) {
      // A single owner can establish readiness through its persisted schema
      // stamp. File stores must inspect: an assertion cannot exclude peers.
      if (!driver.file && base.schemaReady?.()) ready = true
      else install()
    } else if (driver.file && version != changed()) mend()
  }
  return {
    worn: worn(vocab, base.derived),
    // A caller replaying these statements over a standing file must add new
    // columns before creating their indexes. `schema()` alone describes a
    // fresh file; it cannot see what a standing table still lacks.
    ddl: () => [
      ...tabled(vocab, base.derived),
      ...grown(vocab, standing(driver, vocab)),
      ...indexed(vocab),
    ],
    grown: () => grown(vocab, standing(driver, vocab)),
    install,
    read: (query, o, comps) => {
      ensure()
      return unit(
        driver,
        () => read(driver, vocab, query, { ...opts(), ...o }, comps),
        'read',
      )
    },
    rows: (query, o) => {
      ensure()
      return rows(driver, vocab, query, { ...opts(), ...o })
    },
    screen: (query, o) => {
      ensure()
      return screened(driver, vocab, query, { ...opts(), ...o })
    },
    get: (eids, comps) => {
      if (!eids.length) return []
      ensure()
      return unit(driver, () => identity(eids, comps), 'read')
    },
    tx: <R>(body: (tx: Tx) => R, mode?: { admission?: boolean }): R => {
      ensure()
      return unit(driver, (): R => {
        let cached = (t: Tx): Tx =>
          mode?.admission
            ? { ...t, get: (eids, comps) => memo(t.get, eids, comps) }
            : t
        if (!classified) return body(cached(tx))
        let { tx: t, settle } = tracked()
        let tracing = context()
        // An async body settles what it owes before the unit closes, as the
        // unit waits for it (./unit.ts).
        return after(body(cached(t)), (out) => {
          if (tracing) scope(tracing, settle)
          else settle()
          return out
        }) as R
      })
    },
  }
}

export * from './migration.ts'
