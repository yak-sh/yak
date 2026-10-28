import { cardinality, population } from './population.ts'
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
import { type And, bare, type Clause } from '@yaks/query'
import { type Filter, filter } from '@yaks/match'
import {
  among,
  and,
  type BindOpts,
  col,
  type Driver,
  erect,
  idOf,
  literals,
  oneOf,
  type Raw,
  type Row,
  select,
  sourceScreen,
  type Stmt,
  table,
  worn,
} from '@yaks/sql'
import type {
  Binding,
  Bundle,
  Doom,
  Eid,
  Entity,
  Graves,
  Match,
  Measure,
  ReadOpts,
} from '@yaks/graph'
import { after, isPromise } from '@yaks/fp'
import { context, scope } from '@yaks/trace'
import type { Query } from './read.ts'
import {
  analyzed,
  analyzing,
  fit,
  grown,
  indexed,
  logged,
  retabled,
  retired,
  standing,
  tabled,
} from './ddl.ts'
import {
  analyzedAt,
  epoch,
  installation,
  installed,
  meta,
  SCHEMA,
} from './meta.ts'
import { ast, get, read, type ReadCache, rows, screened } from './read.ts'
import { doom } from './doom.ts'
import { unit } from './unit.ts'
import { options } from './reader.ts'
import {
  backfill,
  classify,
  entomb,
  heldBy,
  type Ledger,
  ledger,
} from './archetype.ts'
import { componentTables, objects, shape } from './physical.ts'
import { build, forgo, reshape, type Sizes } from './owe.ts'
import { plan } from './plan.ts'
import { births, patch, prune, remove, revive, spines } from './write.ts'
import { burying } from './buried.ts'
import { located, measure } from './measure.ts'
import { bindings } from './rules.ts'
import { basis, local, memoized, rooted, simple } from './memo.ts'
import { revision } from '@yaks/sql'
import { watch } from './watch.ts'
import { gotten, metered, named } from './budget.ts'
import { dead } from '@yaks/graph/bundle'
import { Refused } from '@yaks/graph/errors'
import {
  type History,
  historySchema,
  keep,
  type Mode,
  seeds,
  type Typed,
  within,
} from './history.ts'
import { add } from './follow.ts'
import { sha256 } from '@yaks/graph/sha256'
export {
  beside,
  BRANCH,
  BRANCHES,
  FROM,
  type History,
  historySchema,
  keeps,
  type Mode,
  ticked,
  TO,
} from './history.ts'

export {
  type Backfill,
  backfill,
  componentTables,
  type Drift,
  drift,
  entomb,
  heldBy,
  type Ledger,
  ledger,
  mend,
  reclassify,
  reclassifyAll,
  type Wrote,
} from './archetype.ts'
export { statements } from './statements.ts'
import { statements } from './statements.ts'
import { checks as diagnostics } from './check.ts'
import type { Statements } from '@yaks/sql'
import { type MigrationControl, migrations } from './migration.ts'
export { catalog } from './catalog.ts'
export {
  type Deletions,
  deletions,
  type DeletionWindow,
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
export {
  EPOCH,
  epoch,
  epochAt,
  type Meta,
  meta,
  printed,
  REQUIRED,
  requirements,
  requires,
} from './meta.ts'
export { decoded, isJsonb, jsonIn, jsonOut, projected } from './jsonb.ts'
export {
  compSql,
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
  prune,
  pruneSql,
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
  /** the id of the transaction this unit's versions name, where the store
   * keeps history (./history.ts) */
  clock?: () => number
  /** a query → whole bundles, or only `comps` when named */
  read: (query: Query, opts?: ReadOpts, comps?: string[]) => Bundle[]
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
  /** Erase identities checked by an explicit orphan repair request. */
  prune: (eids: string[]) => void
  /** bring these tombstoned entities back: tombstone gone, identity kept */
  revive: (eids: string[]) => void
  /** the graves a retention sweep may prune (./buried.ts) */
  buried: (before: string, page: { after?: string; limit: number }) => Graves
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
  /** Call `heard` soon after another connection commits a new row of
   * `comp` (./watch.ts). Only a store over a file has one. Answers a stop. */
  watch?: (comp: string, heard: () => void) => () => void
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
  /** the print of the statements {@link install} runs, the store's part of a
   * composed schema's print (./follow.ts) */
  print: () => string
  /** run them — create the tables and indexes the vocabulary needs, and
   * classify what the archetype backfill finds unclassified; nothing, where
   * the file's schema is as this vocabulary last installed it. `beside` is
   * the rest of the composed schema (./follow.ts): a table too big to rebuild
   * at once is rebuilt later (./owe.ts), and its indexes and triggers there
   * are raised again on the rebuilt one. Answers what it left undone, each
   * also reported: a table whose rows do not fit its new shape, and a unique
   * index those rows break (./owe.ts `build`) */
  install: (beside?: Stmt[]) => Error[]
  /** analyze up to `tables` of the tables whose planner statistics
   * {@link install} owes (./ddl.ts `analyzed`), each in its own unit, and
   * answer how many stay owed: a full-analysis engine's install decides what
   * is owed and leaves the reading to whoever calls this, off the request
   * that installed. Nothing is ever owed on any other driver. */
  analyze: (tables?: number) => number
  /** a query → its entities, with `comps` only where named: which entities
   * match and what they carry read as one snapshot, in a unit that takes no
   * write lock, so another process's commit is seen whole or not at all */
  read: (query: Query, opts?: BindOpts & ReadOpts, comps?: string[]) => Bundle[]
  /** a query → the compiled statement's raw rows (counts, tallies) */
  rows: (query: Query, opts?: BindOpts & ReadOpts) => Row[]
  /** the graves a retention sweep may prune: tombstones laid before `before`
   * that nothing in the file names (./buried.ts), a page of them from `after`,
   * read as one snapshot */
  buried: (before: string, page: { after?: string; limit: number }) => Graves
  /** what the file keeps, a b-tree at a time (./measure.ts) */
  measure: (signal?: AbortSignal) => Promise<Measure | undefined>
  /** a query → a statement selecting the ids of the entities it admits, as
   * this store compiles its reads (./read.ts `screened`); null for a query
   * with nothing to narrow by */
  screen: (query: Query, opts?: BindOpts & ReadOpts) => Raw | null
  /** these entities as they stand, carrying the components `comps` names or
   * every one, read in a unit that takes no write lock */
  get: (eids: Eid[], comps?: string[], opts?: BindOpts & ReadOpts) => Bundle[]
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
  /** Maintain global populations after the first unscoped aggregate (default).
   * Stores that need counts immediately may seed them during installation;
   * other stores never pay for upkeep until a count actually asks for it. */
  counts?: 'lazy' | 'eager'

  /** How big a table is before a file owes its schema work, and the rows a
   * window does of it (./owe.ts `SIZES`): what a test shrinks. */
  sizes?: Sizes
  /** A single-owner host's readiness check, called on the first operation.
   * True asserts that this vocabulary and its derived schema, metadata and
   * archetypes already stand; false asks this adapter to install them. The
   * host must bind a new store when its schema changes. File drivers never
   * install on an operation: their host brings them to its composed schema
   * as it opens (./follow.ts). `install()` always validates, regardless of
   * this check. */
  schemaReady?: () => boolean
  /** Additive installation of a deliberately partial vocabulary. Existing
   * indexes owned by declarations this installer does not carry stay intact. */
  partial?: boolean
  /** Give new spines a human-readable number. Opt-IN: left out, an entity is
   * its eid and nothing else, which is what a store whose entities nobody ever
   * types the number of wants. Identity, and reporting which entities were
   * created, still belong to storage either way. */
  number?: boolean | { except: readonly string[] }
  /** Where a failure the store outlives is told: a table that stood and could
   * not be fitted to the vocabulary, left as it was (ddl.ts `fit`). One
   * line on the console, by default (ddl.ts `logged`). */
  report?: (error: Error) => void
  /** Keep every version a write replaces (./history.ts), naming the
   * transactions this statement takes, one per unit that writes a component
   * with history. From the history plugin (@yaks/journal). */
  history?: History
  /** Read main as of a transaction, or a branch, and write only to the branch:
   * what a connection opened for a mode is bound with (./mode.ts). */
  mode?: Mode
  /** How many bytes of the entities it read the store keeps in memory
   * (./memo.ts): 4 MiB unless its opener can spare more. */
  memory?: number
}

// The read options a statement is the same under (@yaks/graph `ReadOpts`).
const UNREAD = new Set([
  'person',
  'administrative',
  'native',
  'durable',
  'patch',
  'speaks',
  'now',
  'storageOrder',
  'unordered',
])

// A read's options without what its caller is doing around it: the activity
// it runs under (`parent`, new with every request) and when it stops waiting
// (`signal`). A read here is synchronous and traced by its unit, so neither is
// an input of the answer, and a read made under them shares every answer and
// statement kept for the same read made without.
let asking = <O extends { signal?: AbortSignal; parent?: string }>(o?: O) => {
  if (!o) return o
  let { signal: _signal, parent: _parent, ...rest } = o
  return rest
}

// The effective read options are data; order of object keys is immaterial,
// while arrays, query clauses, paths and literal token strings keep order.
let keyed = (value: unknown) =>
  JSON.stringify(
    value,
    (_key, v) =>
      v && typeof v == 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
        : v,
  )

// The ledgers of the units open on each driver, outermost first (`tracked`).
type Writing = { ledger: Ledger; complete: boolean }
let ledgers = new WeakMap<Driver, Writing[]>()

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

// The tables of versions a store with history keeps (./history.ts), made where
// missing and typed as the live tables stand now, and each one just made
// given the live rows as the versions they are so far.
let versioned = (driver: Driver, vocab: Vocab): Error[] => {
  let had = new Set(objects(driver, { type: 'table' }).map((o) => o.name))
  let stood = standing(driver, vocab)
  let typed: Typed = (comp, c) => {
    let found = stood[comp]?.cols.find((r) => r.name == c)
    return found ? String(found.type ?? '') : undefined
  }
  let left = add(driver, historySchema(vocab, typed))
  for (let s of seeds(vocab, (name) => !had.has(name))) driver.query(s)
  return left
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
  let opts = options(driver, vocab, base)
  if (base.history) keep(driver, vocab, base.history, base.mode)
  // What a store with history adds beside its own schema, run and printed
  // with it.
  let besides = base.history ? historySchema(vocab) : []
  let printed = () => {
    let own = plan(vocab, base.derived, !!driver.file).print
    return besides.length ? sha256(`${own};history`) : own
  }
  let owing = () => [
    ...new Set((ledgers.get(driver) ?? []).flatMap((u) => u.ledger.owed())),
  ]
  let identity = (eids: string[], comps?: string[]) =>
    get(driver, vocab, eids, opts(), comps, owing())
  let report = base.report ?? logged
  // Whether this store keeps archetypes, and whether their descriptors are
  // numbered like any other entity.
  // A mode's connection reads what an entity held then, which no pointer
  // says (./mode.ts).
  let classified = !!vocab.comp('archetype') && !base.mode
  let numbered = typeof base.number == 'object'
    ? !base.number.except.includes('archetype')
    : !!base.number
  let memo = memoized(driver, vocab, base.derived, base.memory)
  // A query's rows, from memory while the tables its answer stands on are
  // unwritten (./memo.ts `answer`), in the one snapshot that decides both. A
  // `direct` read takes presence from the component tables, not the archetype
  // pointers a transaction still owes; anywhere else an owed pointer means the
  // catalog can't be trusted yet.
  // Where a caller's options leave a read's entities as the store's own get
  // reads them, the get to read them through.
  let policies = (o: Opts, within = false): string[] | undefined => {
    let tables = new Set(within ? ['tombstone'] : ['entity', 'tombstone'])
    let scope = o.visibility
    for (
      let query of [scope?.entity, ...Object.values(scope?.components ?? {})]
    ) {
      if (!query) continue
      let names = basis(vocab, ast(query), base.derived, false, within)
      if (!names) return undefined
      for (let name of names) tables.add(name)
    }
    for (let name of Object.keys(scope?.components ?? {})) tables.add(name)
    return [...tables]
  }
  let reading = (o: Opts, fetch = cached): ReadCache => ({
    fetch: (eids, comps) => fetch(eids, comps, false),
    permit: (eids, components, run, graves) => {
      if (!eids.length) return []
      let selected = new Set(eids)
      let queries = [
        o.visibility?.entity,
        ...components.map((c) => o.visibility?.components?.[c]),
      ].filter((q) => !!q)
      let compiled = queries.map((q) => tested(ast(q!), true))
      let tests = compiled.every((t) => !!t) ? compiled as Filter[] : undefined
      let test: Filter | undefined = tests &&
        ((b) => selected.has(b.entity.eid) && tests.every((t) => t(b)))
      let names = queries.flatMap((q) =>
        basis(vocab, ast(q!), base.derived) ?? []
      )
      if (tests && policies(o)) {
        let found = fetch(eids, [...new Set(names)])
        // A deleted entity is judged by its history, which only the store's
        // statement reads (@yaks/sql `ghostly`).
        let history = Object.values(o.backed ?? base.backed ?? {}).some((b) =>
          b.held && b.about
        )
        if (!graves || !found.some(dead) || !history) {
          return found.filter((b) => !dead(b) && test!(b)).map((b) => ({
            eid: b.entity.eid,
          }))
        }
      }
      return memo.answer(
        JSON.stringify(['permit', eids, components, o.visibility, !!graves]),
        () => policies(o),
        run,
        () => ({ query: graves ? undefined : test, membership: true }),
      )
    },
  })
  let known = (o: Opts) =>
    Object.keys(o).every((k) => UNREAD.has(k) || k == 'visibility')
  let virtual = (eids: string[], o: Opts) =>
    Object.values(o.backed ?? {}).some((b) =>
      b.tag && eids.some((eid) => idOf(b.tag!, eid) != null)
    )
  let reused = (
    eids: string[],
    comps: string[] | undefined,
    o: Opts,
    run: () => Bundle[],
    pending: string[] = owing(),
  ) => {
    if (!policies(o) || virtual(eids, o)) return run()
    // Registries are fixed per store. A per-call replacement is unknown and
    // bypasses reuse; the remaining effective inputs belong in the key.
    let { derived: _d, backed: _b, extend: _e, archetypes: _a, ...inputs } = o
    return memo.view(keyed(['get', eids, comps, inputs, pending]), run, comps)
  }
  let kept = (
    fetch: (eids: string[], comps?: string[]) => Bundle[],
    eids: string[],
    comps?: string[],
    refresh = true,
    pending: string[] = owing(),
  ) => {
    let o = opts()
    let run = () =>
      o.visibility || virtual(eids, o)
        ? fetch(eids, comps)
        : memo.get(fetch, eids, comps, refresh)
    return refresh ? reused(eids, comps, o, run, pending) : run()
  }
  let cached = (eids: string[], comps?: string[], refresh = true) =>
    kept(identity, eids, comps, refresh)
  let viewed = (
    eids: string[],
    comps: string[] | undefined,
    o: Opts,
    fetch = cached,
    pending: string[] = owing(),
  ) => {
    let effective = { ...opts(), ...o }
    let eligible = known(o)
    // With no policy to apply, an option the statement is the same under
    // leaves an identity read as memory holds it.
    if (!effective.visibility && eligible) return fetch(eids, comps)
    let run = () =>
      get(
        driver,
        vocab,
        eids,
        effective,
        comps,
        pending,
        eligible && !base.visibility && !virtual(eids, effective)
          ? reading(effective, fetch)
          : undefined,
      )
    return eligible ? reused(eids, comps, effective, run, pending) : run()
  }
  let fetched = (
    o: Opts = {},
    fetch = cached,
    pending: () => string[] = owing,
  ) =>
    Object.keys(o).every((k) =>
        k != 'now' && (UNREAD.has(k) || k == 'visibility')
      )
      ? (eids: string[], comps?: string[]) =>
        viewed(eids, comps, o, fetch, pending())
      : undefined
  let tests = new WeakMap<And, Map<boolean, Filter | undefined>>()
  let tested = (query: And, exactIds = false): Filter | undefined => {
    let known = Object.isFrozen(query) ? tests.get(query) : undefined
    if (known?.has(exactIds)) return known.get(exactIds)
    let test: Filter | undefined
    if (basis(vocab, query, base.derived) && local(vocab, query)) {
      try {
        test = filter(query, vocab, { exactIds })
      } catch {
        // SQL decides predicates the local matcher cannot judge.
      }
    }
    if (Object.isFrozen(query)) {
      if (!known) tests.set(query, known = new Map())
      known.set(exactIds, test)
    }
    return test
  }
  let resolved = (query: And, o: Opts): BindOpts['references'] => {
    if (!o.visibility?.entity) return undefined
    let operands = new Set<string>()
    let visit = (c: Clause): void => {
      if (c.kind == 'and' || c.kind == 'or') return c.clauses.forEach(visit)
      if (
        c.kind != 'pred' || c.where || c.op != '=' ||
        !literals(c.value)?.length
      ) return
      let hops = vocab.aim(c.path.join('.'), bare(c)), h = hops[0]
      let prop = h && vocab.prop(h.comp, h.prop)
      if (
        hops.length != 1 || !prop?.ref || prop.computed ||
        base.derived?.[`${h.comp}.${h.prop}`] || vocab.comp(prop.ref)?.computed
      ) return
      for (let eid of literals(c.value)!) operands.add(eid)
    }
    visit(query)
    if (!operands.size) return undefined
    let eids = [...operands]
    // A deleted entity the scope sees is admitted too, so its history is
    // asked by its id (@yaks/sql `ghostly`).
    let allowed = reading(o).permit(eids, [], () => {
      let screen = sourceScreen(vocab, { ...opts(), ...o, graves: true })!
      return driver.query(select({
        cols: [col('eid', '__target')],
        from: table('entity', '__target'),
        where: and(
          oneOf(col('eid', '__target'), eids),
          among(col('id', '__target'), screen),
        ),
      }))
    }, true)
    let ids = spines(driver, allowed.map((r) => String(r.eid)))
    return Object.fromEntries(
      eids.map((eid) => [eid, ids.get(eid)?.id ?? null]),
    )
  }
  let asked = (query: And, o: Opts = {}, direct = false): Row[] => {
    let catalogued = classified && !direct
    let owing = catalogued &&
      (ledgers.get(driver) ?? []).some((u) => u.ledger.owed().length)
    // A read asking for graves is the statement's: it alone judges the
    // deleted (@yaks/sql `ghostly`).
    if (
      o.visibility && !owing && !o.graves && simple(vocab, query) &&
      !Object.keys(o.visibility.components ?? {}).length &&
      (!o.visibility.entity || local(vocab, ast(o.visibility.entity))) &&
      policies(o) && basis(vocab, query, base.derived, catalogued)
    ) {
      let { visibility: _visibility, ...plain } = o
      let raw = asked(query, plain, direct)
      let permitted = new Set(
        reading(o).permit(raw.map((r) => String(r.eid)), [], () => []).map((
          r,
        ) => String(r.eid)),
      )
      return raw.filter((r) => permitted.has(String(r.eid)))
    }
    // What a caller's options change of the statement: its order of pages; a
    // `now` matters only to time phrases, which are read every time.
    let unread = Object.keys(o).some((k) => !UNREAD.has(k) && k != 'visibility')
    let tables: string[] | undefined
    let dependencies = () => {
      tables = basis(vocab, query, base.derived, catalogued)
      if (o.visibility) {
        let scoped = policies(o, !!tables && !tables.includes('entity'))
        tables = tables && scoped
          ? [...new Set([...tables, ...scoped])]
          : undefined
      }
      return tables
    }
    let key = JSON.stringify([
      query,
      !!o.storageOrder,
      !!o.unordered,
      direct,
      o.visibility,
    ])
    let prove = () => {
      // A retained proof reads the same query and policy even if a caller
      // later edits the AST or visibility object it handed this read.
      let [query, , , , visibility] = JSON.parse(key) as [
        And,
        boolean,
        boolean,
        boolean,
        Opts['visibility'],
      ]
      let o = { visibility }
      let standing: And | Filter | undefined = query
      let strict: string[] | undefined
      let shape: Filter | undefined
      let identities = (c: Clause): boolean =>
        c.kind == 'and' || c.kind == 'or'
          ? c.clauses.every(identities)
          : c.kind == 'pred' && !c.where || c.kind == 'every'
      let fixed = (c: Clause): boolean => {
        if (c.kind == 'and' || c.kind == 'or') return c.clauses.every(fixed)
        if (c.kind != 'pred') return true
        let leaf = vocab.aim(c.path.join('.'), bare(c)).at(-1)
        return !leaf || vocab.prop(leaf.comp, leaf.prop)?.category != 'ref' ||
          !c.not && c.op == '=' && !!literals(c.value)?.length
      }
      if (o.visibility) {
        let policy = o.visibility.entity
        let proof = basis(vocab, query, base.derived) && rooted(vocab, query)
        // Aspect policies can change what a predicate reads. A whole-entity
        // policy instead composes with an ordinary local membership test.
        if (
          !Object.keys(o.visibility.components ?? {}).length &&
          (local(vocab, query) || !!proof) &&
          (!policy || local(vocab, ast(policy)))
        ) {
          let ordinary = tested(query) ?? (proof ? proof.test : undefined)
          if (ordinary && !fixed(query)) ordinary = undefined
          let allowed = policy && tested(ast(policy), true)
          standing = ordinary && (!policy || allowed)
            ? (b) => ordinary(b) && (!allowed || allowed(b))
            : undefined
          if (standing && proof) shape = proof.shape
          // A reference's target can become hidden without its source changing.
          // Local source predicates cannot prove that policy change irrelevant.
          if (!simple(vocab, query)) {
            let scope = policies(o, !!tables && !tables.includes('entity'))
            strict = scope && [
              ...new Set([
                ...scope,
                ...proof ? proof.strict : [],
              ]),
            ]
          }
        } else standing = undefined
      }
      return {
        query: standing,
        membership: identities(query) && local(vocab, query),
        strict,
        shape,
      }
    }
    return unit(driver, () =>
      memo.answer(
        key,
        owing || unread ? undefined : dependencies,
        () =>
          rows(driver, vocab, query, {
            ...opts(),
            ...o,
            references: resolved(query, o) ?? o.references,
            ...direct ? { archetypes: () => undefined } : {},
          }),
        prove,
      ), 'read')
  }
  let graves = burying(driver, vocab)
  let tx: Tx = {
    read: (query, signalled, comps) => {
      let o = asking(signalled)
      return metered(() =>
        read(
          driver,
          vocab,
          query,
          { ...opts(), ...o },
          comps,
          (q) => asked(q, o),
          fetched(o),
        ), { what: named(query) })
    },
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
    prune: (eids) => memo.writes(() => prune(driver, vocab, eids), () => eids),
    buried: (before, page) => graves(before, page),
  }
  // A unit over a store that keeps archetypes keeps every pointer in step,
  // whichever door wrote: @yaks/graph's tracker, a hook writing through a
  // detached transaction, a script patching through `tx`. Its ledger hears
  // each row that came or went and each pointer written (./archetype.ts
  // `ledger`); what it still owes when the body returns is classified from
  // what those entities hold (`classify`), in the same unit. A birth's complete
  // ledger supplies its shape without discovering or reading every table;
  // other entities are classified from their physical rows. Through the
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
    let remembered = births(driver)
    let born = {
      ...remembered,
      born: (eid: string, tables: string[], id?: number) => {
        remembered.born(eid, tables, id)
        l.born(eid)
      },
    }
    let open = ledgers.get(driver) ?? []
    ledgers.set(driver, open)
    // A nested unit can write rows its ancestors did not hear, even if it
    // later rolls back. Their ledgers no longer prove a complete birth shape.
    for (let u of open) u.complete = false
    let writing = { ledger: l, complete: true }
    open.push(writing)
    let owed = () => [...new Set(open.flatMap((u) => u.ledger.owed()))]
    // An entity whose rows moved in this transaction is read from what it
    // holds; every other one as its pointer says, or from memory.
    let getting = (
      eids: string[],
      comps?: string[],
      refresh = true,
    ): Bundle[] => {
      let pending = owed()
      let moving = new Set(pending)
      let moved = eids.filter((eid) => moving.has(eid))
      if (!moved.length) return cached(eids, comps, refresh)
      let rest = eids.filter((eid) => !moving.has(eid))
      let at = new Map(
        [
          ...kept(
            (ids, names) => get(driver, vocab, ids, opts(), names, pending),
            moved,
            comps,
            refresh,
            pending,
          ),
          ...rest.length ? cached(rest, comps, refresh) : [],
        ].map((b) => [b.entity.eid, b]),
      )
      return eids.flatMap((eid) => at.get(eid) ?? [])
    }
    let settle = () => {
      let dead = l.buried(), owed = l.owed()
      let known = new Map<string, string[]>()
      if (writing.complete) {
        for (let eid of owed) {
          let wrote = l.wrote(eid)
          if (wrote.born) known.set(eid, wrote.tables)
          else {
            let tables = memo.presence(eid, componentTables(driver))
            if (tables) known.set(eid, tables)
          }
        }
      }
      memo.writes(
        () => {
          if (dead.length) entomb(driver, dead, numbered)
          if (owed.length) classify(driver, owed, numbered, known)
        },
        () => [...dead, ...owed],
        // A class first worn mints its descriptor (./archetype.ts).
        owed.length > 0,
      )
      for (let eid of [...dead, ...owed]) l.pointed(eid)
    }
    return {
      close: () => void open.splice(open.lastIndexOf(writing), 1),
      tx: {
        ...tx,
        get: getting,
        // Pending component rows already stand in this transaction. Read them
        // directly rather than persisting an intermediate archetype just to
        // read before the graph's final stamp/tracker flush.
        read: (query, signalled, comps) => {
          let o = asking(signalled)
          let direct = owed().length > 0
          return metered(() =>
            read(
              driver,
              vocab,
              query,
              {
                ...opts(),
                ...o,
                ...direct ? { archetypes: () => undefined } : {},
              },
              comps,
              (q) => asked(q, o, direct),
              fetched(o, getting, owed),
            ), { what: named(query) })
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
                l.moved,
                known,
                born,
              ),
          )
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
              remove(
                driver,
                vocab,
                entities,
                heldBy(driver, eids, open.map((u) => u.ledger)),
                at,
              ),
          )
          for (let eid of eids) l.removed(eid)
        },
        revive: (eids) =>
          memo.writes(() => revive(driver, eids, l.moved), () => eids),
      },
      settle,
    }
  }
  // A file store is brought to its schema by its host as it opens
  // (./follow.ts), never by an operation.
  // In-memory stores are private scratch values and may prepare themselves.
  let ready = false
  let install = (beside: Stmt[] = []): Error[] => {
    let left: Error[] = []
    let { made } = plan(vocab, base.derived, !!driver.file)
    let print = printed()
    let mark = (strays: string[]) =>
      [print, shape(driver, [...made, ...strays]), ...strays].join(' ')
    let receipt: ReturnType<typeof installation>
    let matches = () => {
      receipt = installation(driver)
      let was = receipt?.schema
      return was == mark(was?.split(' ').slice(2) ?? [])
    }
    // The fast path only reads. A changed file is inspected again *after*
    // taking its write lock, and tables, growth and indexes commit together.
    let unchanged = matches()
    if (!unchanged) {
      let keys = (value: string): Stmt => ({
        t: 'pragma',
        name: 'foreign_keys',
        value,
      })
      let clean = false
      let seal = () => {
        epoch(driver)
        if (classified) backfill(driver, numbered)
        receipt = {
          schema: mark(componentTables(driver, made)),
          statistics: receipt?.statistics,
        }
        meta(driver).set(SCHEMA, receipt.schema)
      }
      let make = () =>
        unit(driver, () => {
          if (matches()) return
          // Retired first: a component may take a name an index held.
          for (let stmt of base.partial ? [] : retired(driver, vocab)) {
            driver.query(stmt)
          }
          let tables = retabled(driver, vocab, base.derived)
          erect(driver, tables)
          let after = (comp: string) =>
            [...tables, ...indexed(vocab), ...beside].filter((s) =>
              (s.t == 'create index' || s.t == 'create trigger') && s.on == comp
            )
          let kept = new Set<string>()
          let unfit = fit(driver, vocab, (comp, r) => {
            let owes = reshape(driver, comp, r, after(comp), base.sizes)
            if (owes) kept.add(comp)
            return owes
          })
          forgo(driver, kept)
          left = [
            ...unfit,
            ...build(driver, indexed(vocab), base.sizes),
            ...besides.length ? versioned(driver, vocab) : [],
          ]
          left.forEach(report)
          clean = !left.length
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
              receipt = {
                schema: mark(componentTables(driver, made)),
                statistics: receipt?.statistics,
              }
              meta(driver).set(SCHEMA, receipt.schema)
            }
          })
        }
      } finally {
        driver.query(keys('on'))
      }
    }
    if (classified && base.counts == 'eager') {
      unit(driver, () => population(driver))
    }
    let analyze = () => {
      let statistics = analyzed(driver, receipt?.statistics, unchanged)
      if (statistics && receipt) analyzedAt(driver, receipt.schema, statistics)
    }
    if (typeof driver.statistics == 'object') unit(driver, analyze)
    else analyze()
    ready = true
    return left
  }
  let ensure = () => {
    if (driver.file || ready) return
    if (base.schemaReady?.()) ready = true
    else install()
  }
  return {
    statements: classified
      ? { ...statements(driver), archetypes: true }
      : base.mode
      ? {
        ...statements(driver),
        archetypes: false,
        // A mode's connection turns its dial under the store (./mode.ts).
        get mode() {
          return base.mode
        },
      }
      : statements(driver),
    checks: diagnostics(driver),
    migrations: migrations(driver),
    revision: () => revision(driver, 'data'),
    ...driver.watch
      ? {
        watch: (comp: string, heard: () => void) =>
          watch(driver, vocab, comp, heard),
      }
      : {},
    worn: worn(vocab, base.derived),
    // A caller replaying these statements over a standing file must add new
    // columns before creating their indexes. `schema()` alone describes a
    // fresh file; it cannot see what a standing table still lacks.
    ddl: () => [
      ...tabled(vocab, base.derived, !!driver.file),
      ...grown(vocab, standing(driver, vocab)),
      ...indexed(vocab),
    ],
    grown: () => grown(vocab, standing(driver, vocab)),
    print: printed,
    install,
    analyze: (tables = Infinity) => {
      let left = installation(driver)?.statistics?.owed?.length ?? 0
      for (let n = 0; n < tables && left; n++) {
        left = unit(driver, () => {
          let receipt = installation(driver)
          let statistics = receipt?.statistics
          if (!receipt || !statistics?.owed?.length) return 0
          let next = analyzing(driver, statistics, 1)
          analyzedAt(driver, receipt.schema, next)
          return next.owed?.length ?? 0
        })
      }
      return left
    },
    read: (query, o, comps) => {
      ensure()
      return metered(
        () => unit(driver, () => tx.read(query, o, comps), 'read'),
        { what: named(query) },
      )
    },
    rows: (query, signalled) => {
      ensure()
      let o = asking(signalled)
      let parsed = ast(query)
      if (
        classified && base.counts != 'eager' &&
        cardinality(parsed, vocab, { ...opts(), ...o })
      ) {
        unit(driver, () => population(driver))
      }
      return metered(() => asked(parsed, o), { what: named(query) })
    },
    screen: (query, o) => {
      ensure()
      return screened(driver, vocab, query, { ...opts(), ...asking(o) })
    },
    buried: (before, page) => {
      ensure()
      return unit(driver, () => graves(before, page), 'read')
    },
    get file() {
      return located(driver)
    },
    measure: (signal) => measure(driver, signal),
    get: (eids, comps, o) => {
      if (!eids.length) return []
      ensure()
      return metered(
        () => unit(driver, () => viewed(eids, comps, asking(o) ?? {}), 'read'),
        { what: gotten(eids) },
      )
    },
    tx: <R>(body: (tx: Tx) => R, _mode?: { admission?: boolean }): R => {
      if (base.mode && 'at' in base.mode) {
        throw new Refused(
          `as of transaction ${base.mode.at} the graph is read only`,
        )
      }
      ensure()
      return unit(driver, (): R =>
        within(driver, (clock) => {
          let cached = (t: Tx): Tx => ({
            ...t,
            get: (eids, comps) => kept(t.get, eids, comps),
            ...base.history ? { clock } : {},
          })
          if (!classified) return body(cached(tx))
          let { tx: t, settle, close } = tracked()
          let tracing = context()
          // An async body settles what it owes before the unit closes, as the
          // unit waits for it (./unit.ts).
          return lastly(
            () =>
              after(body(base.history ? { ...t, clock } : t), (out) => {
                if (tracing) scope(tracing, settle)
                else settle()
                return out
              }) as R,
            close,
          )
        }))
    },
  }
}

export * from './migration.ts'
export {
  add,
  follow,
  forget,
  grow,
  lacking,
  printFor,
  printOf,
} from './follow.ts'

export { doom } from './doom.ts'
export { branch, branchOf, moded } from './mode.ts'
