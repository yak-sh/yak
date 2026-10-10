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
import type { And } from '@yaks/query'
import {
  type BindOpts,
  type Derived,
  type Driver,
  erect,
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
import { after, isPromise } from '@yaks/fp'
import { context, scope } from '@yaks/trace'
import type { Query } from './read.ts'
import {
  analyzed,
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
import { ast, doom, get, read, rows, screened, tagOf } from './read.ts'
import { unit } from './unit.ts'
import {
  backfill,
  entomb,
  heldBy,
  type Ledger,
  ledger,
  reclassify,
} from './archetype.ts'
import { componentTables, shape } from './physical.ts'
import { births, patch, remove, revive } from './write.ts'
import { bindings } from './rules.ts'
import { basis, memoized } from './memo.ts'
import { revision } from '@yaks/sql'

export * from './archetype.ts'
export { statements } from './statements.ts'
import { statements } from './statements.ts'
import { checks as diagnostics } from './check.ts'
import type { Statements } from '@yaks/sql'
import { type MigrationControl, migrations } from './migration.ts'
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
  retabled,
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
  /** Current committed-data invalidation token, including external WAL writes. */
  revision?: () => unknown
  statements: Statements
  migrations: MigrationControl
  checks: ReturnType<typeof diagnostics>
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
  tx: <R>(body: (tx: Tx) => R, opts?: { admission?: boolean }) => R
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
   * host must bind a new store when its schema changes. File drivers never
   * install on an operation: their schema belongs to the explicit installer.
   * Explicit `install()` always validates, regardless of this check. */
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

// The read options a statement is the same under (@yaks/graph `ReadOpts`).
const UNREAD = new Set([
  'native',
  'durable',
  'parent',
  'patch',
  'speaks',
  'now',
  'storageOrder',
])

// The ledgers of the units open on each driver, outermost first (`tracked`).
let ledgers = new WeakMap<Driver, Ledger[]>()

// The value `body` gives, once `last` has run after it settled, either way.
let lastly = <R>(body: () => R, last: () => void): R => {
  let out: R
  try {
    out = body()
  } catch (error) {
    last()
    throw error
  }
  if (!isPromise(out)) {
    last()
    return out
  }
  return out.finally(last) as R
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
  let memo = memoized(driver, vocab, base.derived)
  // A query's rows, from memory while the tables its answer stands on are
  // unwritten (./memo.ts `answer`), in the one snapshot that decides both. A
  // `direct` read takes presence from the component tables, not the archetype
  // pointers a transaction still owes; anywhere else an owed pointer means the
  // catalog can't be trusted yet.
  // Where a caller's options leave a read's entities as the store's own get
  // reads them, the get to read them through.
  let fetched = (o: Opts = {}, get = cached) =>
    Object.keys(o).every((k) => k != 'now' && UNREAD.has(k)) ? get : undefined
  let cached = (eids: string[], comps?: string[]) =>
    memo.get(identity, eids, comps)
  let asked = (query: And, o: Opts = {}, direct = false): Row[] => {
    let catalogued = classified && !direct
    let owing = catalogued &&
      (ledgers.get(driver) ?? []).some((l) => l.owed().length)
    // What a caller's options change of the statement: its order of pages; a
    // `now` matters only to time phrases, which are read every time.
    let unread = Object.keys(o).some((k) => !UNREAD.has(k))
    return unit(driver, () =>
      memo.answer(
        JSON.stringify([query, !!o.storageOrder, direct]),
        owing || unread
          ? undefined
          : basis(vocab, query, base.derived, catalogued),
        () =>
          rows(driver, vocab, query, {
            ...opts(),
            ...o,
            ...direct ? { archetypes: () => undefined } : {},
          }),
        query,
      ), 'read')
  }
  let tx: Tx = {
    read: (query, o) =>
      read(
        driver,
        vocab,
        query,
        { ...opts(), ...o },
        undefined,
        (q) => asked(q, o),
        fetched(o),
      ),
    get: identity,
    doom: (eids) => doom(driver, vocab, eids),
    bindings: (matches, bundles, covers) =>
      bindings(driver, vocab, matches, bundles, covers, base),
    patch: (bundles) =>
      memo.patch(
        bundles,
        (known) =>
          patch(
            driver,
            vocab,
            bundles,
            base.number,
            base.adopt,
            undefined,
            known,
          ),
      ),
    remove: (entities) => {
      let at = new Date().toISOString()
      memo.removes(
        entities.map((e) => e.eid),
        at,
        () => remove(driver, vocab, entities, undefined, at),
      )
    },
    revive: (eids) => memo.writes(() => revive(driver, eids), () => eids),
  }
  // A unit over a store that keeps archetypes keeps every pointer in step,
  // whichever door wrote: @yaks/graph's tracker, a hook writing through a
  // detached transaction, a script patching through `tx`. Its ledger hears
  // each row that came or went and each pointer written (./archetype.ts
  // `ledger`); what it still owes when the body returns is classified from
  // what those entities hold (`reclassify`), in the same unit. Through the
  // graph that is nothing, since its tracker points every entity it moved, so
  // its writes gain no read. Removal clears the tables its entities hold
  // (`heldBy`); the dead no pointer has been written for since are pointed at
  // the tombstone set (`entomb`), which reads nothing.
  //
  // A unit opened inside another (a graph applied in a caller's transaction)
  // hears what the outer ones wrote and have not classified yet: their ledgers
  // stay open beside its own, outermost first, so it reads and removes what an
  // entity holds rather than what its pointer said before they began.
  let tracked = (): { tx: Tx; settle: () => void; close: () => void } => {
    let l = ledger()
    // A birth is minted in the class its shape last finished in, and its
    // pointer is written again only where it finishes elsewhere.
    let born = births(driver)
    let open = ledgers.get(driver) ?? []
    ledgers.set(driver, open)
    open.push(l)
    let owed = () => [...new Set(open.flatMap((o) => o.owed()))]
    // An entity whose rows moved in this transaction is read from what it
    // holds; every other one as its pointer says, or from memory.
    let getting = (eids: string[], comps?: string[]): Bundle[] => {
      let pending = owed()
      let moving = new Set(pending)
      let moved = eids.filter((eid) => moving.has(eid))
      if (!moved.length) return cached(eids, comps)
      let rest = eids.filter((eid) => !moving.has(eid))
      let at = new Map(
        [
          ...get(driver, vocab, moved, opts(), comps, pending),
          ...rest.length ? cached(rest, comps) : [],
        ].map((b) => [b.entity.eid, b]),
      )
      return eids.flatMap((eid) => at.get(eid) ?? [])
    }
    let settle = () => {
      let dead = l.buried(), owed = l.owed()
      memo.writes(
        () => {
          if (dead.length) entomb(driver, dead, numbered)
          if (owed.length) reclassify(driver, owed, numbered)
        },
        () => [...dead, ...owed],
        // A class first worn mints its descriptor (./archetype.ts).
        owed.length > 0,
      )
      for (let eid of [...dead, ...owed]) l.pointed(eid)
    }
    return {
      close: () => void open.splice(open.lastIndexOf(l), 1),
      tx: {
        ...tx,
        get: getting,
        // Pending component rows already stand in this transaction. Read them
        // directly rather than persisting an intermediate archetype just to
        // read before the graph's final stamp/tracker flush.
        read: (query, o) => {
          let direct = owed().length > 0
          return read(
            driver,
            vocab,
            query,
            {
              ...opts(),
              ...o,
              ...direct ? { archetypes: () => undefined } : {},
            },
            undefined,
            (q) => asked(q, o, direct),
            fetched(o, getting),
          )
        },
        patch: (bundles) => {
          let minted = memo.patch(
            bundles,
            (known) =>
              patch(
                driver,
                vocab,
                bundles,
                base.number,
                base.adopt,
                l.moved,
                known,
                born,
              ),
          )
          for (let e of minted) l.born(e.eid)
          for (let b of bundles) {
            if (b.entity.archetype !== undefined) l.pointed(b.entity.eid)
          }
          return minted
        },
        remove: (entities) => {
          let eids = entities.map((e) => e.eid)
          let at = new Date().toISOString()
          memo.removes(
            eids,
            at,
            () =>
              remove(driver, vocab, entities, heldBy(driver, eids, open), at),
          )
          for (let eid of eids) l.removed(eid)
        },
        revive: (eids) =>
          memo.writes(() => revive(driver, eids, l.moved), () => eids),
      },
      settle,
    }
  }
  // File schema belongs to an explicit installer, never to an operation.
  // In-memory stores are private scratch values and may prepare themselves.
  let ready = false
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
          erect(driver, retabled(driver, vocab, base.derived))
          let unfit = fit(driver, vocab)
          for (let stmt of retired(driver, vocab)) driver.query(stmt)
          erect(driver, indexed(vocab))
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
    ready = true
  }
  let ensure = () => {
    if (driver.file || ready) return
    if (base.schemaReady?.()) ready = true
    else install()
  }
  return {
    statements: statements(driver),
    checks: diagnostics(driver),
    migrations: migrations(driver),
    revision: () => revision(driver, 'data'),
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
        () =>
          read(
            driver,
            vocab,
            query,
            { ...opts(), ...o },
            comps,
            (q) => asked(q, o),
            fetched(o),
          ),
        'read',
      )
    },
    rows: (query, o) => {
      ensure()
      return asked(ast(query), o)
    },
    screen: (query, o) => {
      ensure()
      return screened(driver, vocab, query, { ...opts(), ...o })
    },
    get: (eids, comps) => {
      if (!eids.length) return []
      ensure()
      return unit(driver, () => memo.get(identity, eids, comps), 'read')
    },
    tx: <R>(body: (tx: Tx) => R, _mode?: { admission?: boolean }): R => {
      ensure()
      return unit(driver, (): R => {
        let cached = (t: Tx): Tx => ({
          ...t,
          get: (eids, comps) => memo.get(t.get, eids, comps),
        })
        if (!classified) return body(cached(tx))
        let { tx: t, settle, close } = tracked()
        let tracing = context()
        // An async body settles what it owes before the unit closes, as the
        // unit waits for it (./unit.ts).
        return lastly(
          () =>
            after(body(t), (out) => {
              if (tracing) scope(tracing, settle)
              else settle()
              return out
            }) as R,
          close,
        )
      })
    },
  }
}

export * from './migration.ts'
