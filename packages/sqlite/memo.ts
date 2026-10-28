// Whole entities a store has read, kept in memory while nothing has written
// them: the hero a page relays ten times a second is read once, not once per
// relay. An entity is let go when a write through this package names it
// (`writes`); every entity is let go when a statement writes a component table
// any other way and when the schema moves. When another connection commits
// (@yaks/sql `revision`'s `outside`), a file's log of which entity each write
// named (./written.ts) says which to let go; where it can't say, every one.
//
// A transaction can roll back what it wrote, so its known writes stay in its
// pending image until commit. A getter for stored components can read that
// image while classification is still owed; a whole or dynamic read uses SQL.
// A write this package cannot attribute leaves the image unknown until the
// transaction ends. The transactions
// are the ones this connection says: `begin` and savepoints through `query`,
// and the driver's own `tx`.
//
// Spines (./write.ts `spines`: an eid's integer id, number and grave) are kept
// for the connection too, so the patches one transaction makes read each
// entity's spine once. A statement that may move one lets every spine go,
// except a plain mint, which this package tells (`spined().learn`), and a
// write that names its entities (`writes`), which lets just theirs go; those
// kept during a transaction go if it rolls back.
//
// So are the classes births finish in (`classed`): the archetype an entity
// first written holding some tables was pointed at by the end of its
// transaction, so the next birth of that shape is minted in it (./write.ts
// `Births`). A class learned while a transaction is open goes if it rolls
// back, since the descriptor it names may go with it.
//
// A query's rows are kept too, once it is asked again, while no table its
// answer stands on has been written (`answer`, `basis`): a page walking back
// over tiles it has watched asks them again for nothing while nobody has
// written a place. Every write
// statement moves its table's count, so nothing a write says has to be
// trusted; what memory can't follow (text, nearness, edges, computed and
// derived properties, time phrases) is read every time. An answer about each
// entity alone stands through a patch or a removal whose entities it selects
// neither before nor after (`local`, `stand`).
// Whole and named gets with SQL-state-only derivations use that same bounded
// answer pool through one global data revision; every mutation ends reuse.
//
// What a patch leaves an entity holding is worked out from what memory held
// and what the patch said, the way a read returns it (`patch`), and kept once
// the transaction commits: an entity written is not read back to be known. A
// value a read could return differently (a number into a text column, a
// derived property, a default the clock fills) leaves the entity to be read,
// though which components it holds is still known. What memory says an entity
// holds is the patch's to choose its statements by (./write.ts `patch`'s
// `had`).
//
// Every driver naming one connection (@yaks/sql `Driver.connection`) tells one
// memory what it ran, so a write through any of them is seen by all.
//
// A get naming components is cut from a whole entity held, or from one held
// in part: what earlier gets naming at least those read, together. Returned
// bundles are copies, made without a look at each value where what memory
// holds is JSON; dynamic components (computed, or derived from anything but this
// connection's rows) are read again on every hit, of the entities holding
// them. Bounded by bytes (`memoized`'s `memory`) and by an entity for every
// 2 KiB of them, the longest unread let go first; a scan is read through, not
// kept.
import type { Bundle, Comp, Entity } from '@yaks/graph'
import { comps, dead } from '@yaks/graph/bundle'
import type { Prop, Vocab } from '@yaks/vocab'
import {
  type And,
  and,
  bare,
  type Clause,
  drifts,
  type Pred,
} from '@yaks/query'
import {
  col,
  type Derived,
  type Driver,
  revision,
  type Row,
  type Stmt,
} from '@yaks/sql/core'
import { derivedOf, storedOnly, tablesOf } from '@yaks/sql/query'
import { type Filter, filter } from '@yaks/match'
import { tables } from './layout.ts'
import { BESIDE, DIAL } from './history.ts'
import { type Answer as Packed, copied, packed } from './answer.ts'
import type { Known, Spine } from './write.ts'
import { follows, newest, since } from './written.ts'
import { surveyed } from './survey.ts'

type Get = (eids: string[], comps?: string[]) => Bundle[]

/** A store's memory of whole entities. */
export type Memo = {
  /** The physical component tables an entity holds, where memory knows its
   * whole after-state and reads every component table the file carries. Value
   * coercion can leave a row's values unknown without losing its presence. */
  presence: (eid: string, tables: readonly string[]) => string[] | undefined
  /** These entities through `get`: whole ones from memory where held. A
   * reader replacing dynamic components itself can defer their refresh. */
  get: (
    get: Get,
    eids: string[],
    comps?: string[],
    refresh?: boolean,
  ) => Bundle[]
  /** A completed get with SQL-state-only policies. Its caller keys every
   * effective read input and keeps authorization/masks inside `run`. */
  view: (key: string, run: () => Bundle[], comps?: string[]) => Bundle[]
  /** Run a write that changes the entities `eids` names, given what it
   * returned: they are let go, and kept out until its transaction ends. A
   * write that may make entities it does not name (`mints`) lets go of every
   * one remembered as missing. */
  writes: <R>(
    body: () => R,
    eids: (out: R) => Iterable<string>,
    mints?: boolean,
  ) => R
  /** Run a patch of `bundles`, which returns the entities it minted or
   * numbered: they and every entity it names are let go as `writes` lets
   * them go, and what each now holds is kept once the transaction commits.
   * `body` is told what memory says each entity held before it. */
  patch: (bundles: Bundle[], body: (known: Known) => Entity[]) => Entity[]
  /** Run a removal of the entities `eids`, buried at `at`: they are let go as
   * `writes` lets them go, and an answer that selected none of them, alive
   * or buried, stands. */
  removes: (eids: string[], at: string, body: () => void) => void
  /** The rows `run` answers the query `key` names with, from memory while no
   * table `tables` names has been written since, or while what was written
   * moved nothing `query` selects; `tables` left out (a query memory can't
   * follow, `basis`), from `run` every time. */
  answer: (
    key: string,
    tables: (() => string[] | undefined) | undefined,
    run: () => Row[],
    proof?: () => {
      query?: And | Filter
      membership?: boolean
      strict?: string[]
      shape?: Filter
    },
  ) => Row[]
}

type Answer = {
  prove?: () => Pick<Answer, 'test' | 'shape' | 'membership' | 'strict'>
  tables: [string, number][]
  rows: Packed
  /** Whole/named gets with SQL-state-only derivations, under all DML. */
  epoch?: number
  /** whether an entity is one the query selects, where memory can tell */
  test?: Filter
  /** Necessary component-presence tests, safe over unknown property values. */
  shape?: Filter
  /** An identity set depends on predicate truth, not selected values. */
  membership?: boolean
  /** Sources whose changes cannot be decided by this row's predicate. */
  strict?: string[]
}

/** The spines a connection keeps. */
export type Spines = {
  /** These eids' spines: held ones from memory, the rest through `read`. */
  get: (
    eids: string[],
    read: (eids: string[]) => Map<string, Spine>,
  ) => Map<string, Spine>
  /** A spine this connection's own statement just minted. */
  learn: (eid: string, spine: Spine) => void
}

/** What a store's memory of whole entities keeps, in bytes, unless its opener
 * says otherwise (./mod.ts `Opts.memory`): what a Durable Object can spare. */
export const MEMORY = 4 << 20
const SPINES = 8192, CLASSES = 256
// Answers are bounded by count, and one too large to keep is read every time.
const ANSWERS = 256, ANSWER = 16 << 10
// How many queries asked once are remembered, waiting to be asked again.
const ASKED = 4 * ANSWERS

/**
 * The tables a query's answer stands on, or `undefined` for one memory can't
 * follow: text, nearness, backlinks, edges, walks and rule clauses; a path
 * nothing declares; a computed or derived property; a time phrase, whose
 * answer moves with the clock. Every answer stands on the graves and, where
 * it is `catalogued`, on the archetype catalog. One that requires no component
 * row (`!product`, `.doc|!doc`) may take in any new entity, so it stands on
 * every entity. A number or an eid moving lets every answer go (`moves`).
 */
export let basis = (
  vocab: Vocab,
  q: And,
  derived: Derived = {},
  catalogued = false,
  within = false,
): string[] | undefined => {
  let out = new Set(['tombstone'])
  if (catalogued) out.add('archetype')
  let path = (segs: string[], facet = false): boolean => {
    // A backlink is no path aim() answers: say so without the refusal.
    if (!vocab.comp(segs[0]) && vocab.assoc(segs[0])) return false
    let hops
    try {
      hops = vocab.aim(segs.join('.'), facet)
    } catch {
      return false
    }
    for (let { comp, prop } of hops) {
      out.add(comp)
      if (comp == 'entity') continue
      if (!vocab.comp(comp) || vocab.comp(comp)!.computed) return false
      if (
        prop &&
        (vocab.prop(comp, prop)?.computed || derived[`${comp}.${prop}`])
      ) return false
    }
    return true
  }
  let visit = (c: Clause): boolean => {
    switch (c.kind) {
      case 'and':
      case 'or':
        return c.clauses.every(visit)
      case 'pred':
        return !c.where && path(c.path, bare(c))
      case 'fields':
        return c.fields.every((f) => path(f.path))
      case 'distinct':
      case 'tally':
        return path(c.path)
      case 'order':
        return path(c.value.replace(/^-/, '').split('.'))
      case 'count':
      case 'limit':
      case 'after':
      case 'every':
      case 'never':
        return true
      default:
        return false
    }
  }
  let scalar = (p: Pred) => {
    let leaf = vocab.aim(p.path.join('.'), bare(p)).at(-1)
    return leaf && vocab.prop(leaf.comp, leaf.prop)?.scalar
  }
  // Whether a clause holds only for an entity with a row of some component:
  // one it must hold (`.doc`, parsed as `!` with no value) or a value it must
  // have, under every arm of an `or`. An absence (`!doc`, `= ''`) is not one.
  let anchored = (c: Clause): boolean =>
    c.kind == 'and'
      ? c.clauses.some(anchored)
      : c.kind == 'or'
      ? c.clauses.length > 0 && c.clauses.every(anchored)
      : c.kind == 'pred' && !c.not && c.path[0] != 'entity' &&
        (c.op == '!'
          ? !c.value
          : ['=', '~=', '<', '<=', '>', '>='].includes(c.op) &&
            !(c.value?.kind == 'scalar' && c.value.raw == ''))
  if (!visit(q) || drifts(q, scalar)) return undefined
  if (!within && !anchored(q)) out.add('entity')
  return [...out]
}

/**
 * Whether what a query selects is told by each entity alone: every path ends
 * on the entity's own components, through no reference, and no `.after`
 * cursor, whose anchor ranks by values a write may move. A write that leaves
 * every entity it moved unselected before and after then moves nothing in its
 * answer. The query is one `basis` follows.
 */
export let local = (vocab: Vocab, q: And): boolean => {
  let own = (segs: string[], facet = false) => {
    try {
      return vocab.aim(segs.join('.'), facet).length <= 1
    } catch {
      // Extension-owned paths (including rankings) need the compiler, not a
      // local cache proof. Leave their validation to that extension.
      return false
    }
  }
  let visit = (c: Clause): boolean => {
    switch (c.kind) {
      case 'and':
      case 'or':
        return c.clauses.every(visit)
      case 'pred':
        return own(c.path, bare(c))
      case 'fields':
        return c.fields.every((f) => own(f.path))
      case 'order':
        return own(c.value.replace(/^-/, '').split('.'))
      case 'count':
      case 'limit':
        return true
      default:
        return false
    }
  }
  return visit(q)
}

// A necessary owner test can rule a write out even when the exact predicate
// follows references. Every referent table remains a strict dependency: a
// write there can change a selected owner's answer without touching it.
export let rooted = (
  vocab: Vocab,
  query: And,
): { test: Filter; shape: Filter; strict: string[] } | undefined => {
  let strict = new Set<string>()
  let path = (segs: string[], facet = false) => {
    let hops = vocab.aim(segs.join('.'), facet)
    for (let h of hops.slice(1)) strict.add(h.comp)
    return hops.length <= 1
  }
  // A predicate the proof cannot test stands as true, the empty conjunction,
  // wherever it sits. `every` is a projection, which @yaks/match drops at the
  // top and refuses inside a disjunction.
  let visit = (c: Clause, shapes = false): Clause => {
    if (c.kind == 'and' || c.kind == 'or') {
      return { ...c, clauses: c.clauses.map((c) => visit(c, shapes)) }
    }
    if (c.kind == 'pred') {
      return path(c.path, bare(c)) &&
          (!shapes || !vocab.aim(c.path.join('.'), bare(c))[0].prop)
        ? c
        : and()
    }
    if (c.kind == 'fields') {
      c.fields.forEach((f) => path(f.path))
      return { kind: 'every' }
    }
    if (c.kind == 'order') {
      path(c.value.replace(/^-/, '').split('.'))
      return { kind: 'every' }
    }
    if (['every', 'count', 'limit'].includes(c.kind)) return c
    throw new Error('not an owner-local proof')
  }
  try {
    return {
      test: filter(
        { ...query, clauses: query.clauses.map((c) => visit(c)) },
        vocab,
      ),
      shape: filter({
        ...query,
        clauses: query.clauses.map((c) => visit(c, true)),
      }, vocab),
      strict: [...strict],
    }
  } catch {
    return undefined
  }
}

// The blob table a content-addressed property's text is read from.
const BLOBS = 'blob_text'

// An entity a transaction wrote whose state memory can't work out.
const LOST: unique symbol = Symbol('lost')

// A component a patch gave an entity whose values memory can't work out: the
// entity holds one, which is what a patch's statements are chosen by, but
// nothing a read asks is answered from it.
const HOLE = '\0hole'
let holed = (b: Bundle): boolean =>
  comps(b).some(([, c]) => c != null && HOLE in c)

type Kept = {
  /** an entity as read, or `null` for one storage does not hold */
  held: Map<string, Bundle | null>
  /** the components a read naming them asked of an entity held in part; an
   * entity held whole has no entry */
  part: Map<string, Set<string>>
  /** what the open transaction's patches leave each entity holding */
  after: Map<string, Bundle | null | typeof LOST>
  /** components known in an after-state held only in part */
  afterPart: Map<string, Set<string>>
  /** keep what the transaction that just committed left */
  commit: () => void
  sizes: Map<string, number>
  bytes: number
  answers: Map<string, Answer>
  /** queries asked once and not kept, oldest first */
  asked: Set<string>
  tables: Set<string>
  /** whether the file's log follows every table it reads (./written.ts):
   * none beside the store's own but the blob table, whose text no write
   * changes under an address */
  logged: boolean
  /** whether the file has the log's triggers on every one of them, asked
   * once while the schema stands at `schema` */
  follows: (schema: number) => boolean
  clear: () => void
  /** let go of what another connection may have written: the entities
   * `eids` names, or every one, and every answer */
  drop: (eids?: Set<string>) => void
}

// What one connection says about its transactions and writes, shared by every
// store bound to it.
type Connection = {
  kept: Set<Kept>
  depth: number
  writing: number
  dirty: Set<string>
  blind: boolean
  spines: Map<string, Spine>
  /** eids whose spine was kept while a transaction is open */
  since: Set<string>
  /** how many statements have written each table */
  versions: Map<string, number>
  /** how many statements have moved a spine */
  shifts: number
  /** answers kept while a transaction is open, by where they are kept */
  answered: [Map<string, Answer>, string][]
  /** the class a birth's opening shape last finished in, by shape */
  classes: Map<string, number>
  /** shapes whose class was learned while a transaction is open */
  learned: Set<string>
  /** the `outside` revision the classes were learned at */
  classedAt: number
  /** the `outside` and `schema` revisions what memory holds was brought to
   * (`follow`) */
  seen: number
  schema: number
  /** the newest row of the file's log (./written.ts) whose entity memory let
   * go, or `undefined` where it read none */
  cursor?: number
  /** the cursor the open transaction began at: a row read inside it may be
   * its own, whose seq another takes if it rolls back */
  began?: number
}

// By connection (@yaks/sql `Driver.connection`): every driver speaking
// through one tells the same memory what it ran.
let connections = new WeakMap<object, Connection>()
let told = new WeakSet<Driver>()

let connect = (driver: Driver): Connection => {
  let at = driver.connection ?? driver
  let c = connections.get(at) ?? opened()
  connections.set(at, c)
  if (!told.has(driver)) {
    told.add(driver)
    tell(driver, c)
  }
  return c
}

let opened = (): Connection => ({
  kept: new Set(),
  depth: 0,
  writing: 0,
  dirty: new Set(),
  blind: false,
  spines: new Map(),
  since: new Set(),
  classes: new Map(),
  learned: new Set(),
  classedAt: -1,
  versions: new Map(),
  shifts: 0,
  answered: [],
  seen: -1,
  schema: -1,
})

// Have `driver` tell the connection `c` each statement and transaction it runs.
let tell = (driver: Driver, c: Connection) => {
  // What a rolled-back transaction had kept of spines and answers may be gone
  // with it.
  let undone = () => {
    for (let eid of c.since) c.spines.delete(eid)
    c.since.clear()
    for (let shape of c.learned) c.classes.delete(shape)
    c.learned.clear()
    for (let [answers, key] of c.answered) answers.delete(key)
    c.answered = []
    for (let k of c.kept) {
      for (let eid of k.after.keys()) k.after.set(eid, LOST)
    }
    c.cursor = c.began
  }
  let begin = () => {
    if (!c.depth++) c.began = c.cursor
  }
  let ended = (committed: boolean) => {
    if (!committed) undone()
    for (let k of c.kept) {
      if (committed && !c.blind) k.commit()
      k.after.clear()
      k.afterPart.clear()
    }
    c.depth = 0
    c.dirty.clear()
    c.blind = false
    c.since.clear()
    c.learned.clear()
    c.answered = []
  }
  let bump = (table: string) =>
    c.versions.set(table, (c.versions.get(table) ?? 0) + 1)
  let unspine = () => {
    c.spines.clear()
    c.since.clear()
  }
  // The blob table holds text by its address (@yaks/blob): a row added there
  // is text no entity read before, since an address is written after its
  // text, so only a write changing or removing one moves what memory holds.
  let adds = (s: Stmt): boolean => s.t == 'insert' && s.into == BLOBS
  // Whether a write may move an id, a number or a grave: anything but a plain
  // mint into `entity` and a pointer to its archetype.
  let moves = (s: Stmt): boolean =>
    s.t == 'insert'
      ? s.into == 'tombstone' ||
        s.into == 'entity' && (!!s.or || !!s.upsert?.some((u) => u.set))
      : s.t == 'update'
      ? s.table == 'tombstone' ||
        s.table == 'entity' && Object.keys(s.set).some((k) => k != 'archetype')
      : s.t == 'delete' && (s.from == 'entity' || s.from == 'tombstone')
  let forget = (table?: string) => {
    let held = false
    for (let k of c.kept) {
      if (table && !k.tables.has(table)) continue
      k.clear()
      held = true
    }
    if (held && c.depth) c.blind = true
  }
  let held = <W extends Stmt>(w: W): W =>
    w.t == 'insert' && w.into.endsWith(BESIDE)
      ? { ...w, into: w.into.slice(0, -BESIDE.length) }
      : w.t == 'update' && w.table.endsWith(BESIDE)
      ? { ...w, table: w.table.slice(0, -BESIDE.length) }
      : w.t == 'delete' && w.from.endsWith(BESIDE)
      ? { ...w, from: w.from.slice(0, -BESIDE.length) }
      : w
  // Everything read may read otherwise now: the schema moved, or a mode's
  // dial turned (./mode.ts).
  let moved = () => {
    forget()
    unspine()
    c.classes.clear()
    c.learned.clear()
    for (let k of c.kept) k.answers.clear()
  }
  let observe = (s: Stmt): void => {
    if (s.t == 'raw') return s.origin && observe(s.origin)
    if (s.t == 'begin' || s.t == 'savepoint') begin()
    else if (s.t == 'commit') ended(true)
    else if (s.t == 'rollback') s.to ? undone() : ended(false)
    else if (s.t == 'release' && --c.depth <= 0) ended(true)
    else if (s.t == 'insert' || s.t == 'update' || s.t == 'delete') {
      // A write beside a component's table (./history.ts) is, to what memory
      // holds, a write of it: on a branch it is the component's whole state.
      s = held(s)
      let table = s.t == 'insert' ? s.into : s.t == 'update' ? s.table : s.from
      if (table == DIAL) return moved()
      bump(table)
      if (moves(s)) {
        c.shifts++
        // A write that says which entities it wrote (`writes`) lets go of
        // just their spines.
        if (!c.writing) unspine()
        // A number, an eid or an id itself moved: what any answer ordered,
        // paged or compared a reference by.
        if (table == 'entity') { for (let k of c.kept) k.answers.clear() }
      }
      if (!c.writing && !adds(s)) forget(table)
    } else if (
      s.t.startsWith('create ') || s.t == 'alter table' || s.t == 'drop'
    ) moved()
  }
  let query = driver.query.bind(driver)
  driver.query = (s) => {
    let rows = query(s)
    observe(s)
    return rows
  }
  if (driver.run) {
    let run = driver.run.bind(driver)
    driver.run = (s) => {
      let n = run(s)
      observe(s)
      return n
    }
  }
  // A driver's own transaction is synchronous: it has ended when `tx`
  // returns, whatever its body left running.
  if (driver.tx) {
    let tx = driver.tx.bind(driver)
    driver.tx = (body) => {
      begin()
      let committed = false
      try {
        let out = tx(body)
        committed = true
        return out
      } finally {
        // One nested in another rolls back to where it began.
        if (--c.depth <= 0) ended(committed)
        else if (!committed) undone()
      }
    }
  }
}

// Bring what memory holds of the connection `c` past what other connections
// committed since it last looked: let go of the entities the file's log says
// they wrote (./written.ts), or of every one where it can't say, as when the
// schema moved, which nothing logs.
let follow = (driver: Driver, c: Connection) => {
  let now = revision(driver, 'outside')
  if (now == c.seen) return
  let schema = revision(driver, 'schema')
  // A store in memory keeps no log: its one connection sees every statement.
  let logged = !!driver.file &&
    [...c.kept].every((k) => k.logged && k.follows(schema))
  let written = logged && schema == c.schema && c.cursor != null
    ? since(driver, c.cursor)
    : undefined
  for (let k of c.kept) k.drop(written?.eids)
  if (written) {
    for (let eid of written.eids) c.spines.delete(eid)
  } else {
    c.spines.clear()
    c.since.clear()
  }
  c.cursor = written ? written.at : logged ? newest(driver) : undefined
  c.seen = now
  c.schema = schema
}

/** The spines kept for the connection `driver` is. */
export let spined = (driver: Driver): Spines => {
  let c = connect(driver)
  let keep = (eid: string, spine: Spine) => {
    c.spines.delete(eid)
    c.spines.set(eid, spine)
    if (c.depth) c.since.add(eid)
    if (c.spines.size > SPINES) c.spines.delete(c.spines.keys().next().value!)
  }
  return {
    get: (eids, read) => {
      follow(driver, c)
      let out = new Map<string, Spine>()
      let missing = eids.filter((eid) => {
        let held = c.spines.get(eid)
        if (held) out.set(eid, { ...held })
        return !held
      })
      if (missing.length) {
        for (let [eid, spine] of read(missing)) {
          out.set(eid, spine)
          keep(eid, { ...spine })
        }
      }
      return out
    },
    learn: (eid, spine) => keep(eid, { ...spine }),
  }
}

/** The classes births finish in, kept for a connection (./write.ts `Births`). */
export type Classes = {
  /** The archetype's integer id a birth opening in `shape` last finished in. */
  get: (shape: string) => number | undefined
  /** A birth opening in `shape` finished in the archetype `id`. */
  learn: (shape: string, id: number) => void
}

/** The classes kept for the connection `driver` is. */
export let classed = (driver: Driver): Classes => {
  let c = connect(driver)
  // Another connection's commit or a schema change may have moved the file
  // under what was learned.
  let current = () => {
    let now = revision(driver, 'outside')
    if (now == c.classedAt) return
    c.classes.clear()
    c.learned.clear()
    c.classedAt = now
  }
  return {
    get: (shape) => {
      current()
      return c.classes.get(shape)
    },
    learn: (shape, id) => {
      current()
      c.classes.delete(shape)
      c.classes.set(shape, id)
      if (c.depth) c.learned.add(shape)
      if (c.classes.size > CLASSES) {
        c.classes.delete(c.classes.keys().next().value!)
      }
    },
  }
}

let sizeOf = (b: Bundle) =>
  JSON.stringify(
    b,
    (_key, value) => typeof value == 'bigint' ? String(value) : value,
  ).length * 2

// What `cloned` answers for a value it leaves to structuredClone.
const OTHER = Symbol('other')

// A JSON value copied: primitives, plain objects and arrays, each object met
// once. Anything else (a Date, bytes, a Map, a hole, an object met twice) is
// OTHER, since structuredClone copies those as a read of them expects.
let cloned = (value: unknown, seen: Set<object>): unknown => {
  if (typeof value != 'object' || value === null) {
    return typeof value == 'function' || typeof value == 'symbol'
      ? OTHER
      : value
  }
  if (seen.has(value)) return OTHER
  seen.add(value)
  let proto = Object.getPrototypeOf(value)
  if (proto == Array.prototype) {
    let from = value as unknown[], out = new Array(from.length)
    for (let i = 0; i < from.length; i++) {
      let v = i in from ? cloned(from[i], seen) : OTHER
      if (v === OTHER) return OTHER
      out[i] = v
    }
    return out
  }
  if (proto != Object.prototype && proto != null) return OTHER
  let out: Record<string, unknown> = {}
  for (let key of Object.keys(value)) {
    let v = cloned((value as Record<string, unknown>)[key], seen)
    if (v === OTHER) return OTHER
    out[key] = v
  }
  return out
}

// The components `names` of a bundle copied as JSON, or undefined where one
// holds anything else.
let json = (b: Bundle, names: string[]): Bundle | undefined => {
  let out: Record<string, unknown> = {}, seen = new Set<object>()
  for (let name of names) {
    let comp = cloned(b[name], seen)
    if (comp === OTHER) return undefined
    out[name] = comp
  }
  return out as Bundle
}

// A copy of a value that is JSON and shares no object.
let dup = (value: unknown): unknown => {
  if (typeof value != 'object' || value === null) return value
  if (Array.isArray(value)) return value.map(dup)
  let out: Record<string, unknown> = {}
  for (let key in value) out[key] = dup((value as Record<string, unknown>)[key])
  return out
}

// The bundles memory holds that are JSON throughout and share no object
// (`json` made them), whose copies need not look at each value. No caller
// is handed one.
let trees = new WeakSet<Bundle>()

// What memory holds of a bundle it is given: a copy, marked when it is JSON.
let kept = (b: Bundle): Bundle => {
  let tree = json(b, Object.keys(b))
  if (!tree) return structuredClone(b)
  trees.add(tree)
  return tree
}

// Copy only the facets this read exposes, each value fresh. Values other than
// JSON keep structuredClone's semantics, shared references included, across
// the selected bundle.
let copy = (
  b: Bundle,
  wanted?: Set<string>,
  omitted: string[] = [],
): Bundle => {
  let names = Object.keys(b).filter((name) =>
    (!omitted.length || !omitted.includes(name)) &&
    (!wanted || name == 'entity' || name == 'tombstone' || wanted.has(name))
  )
  if (trees.has(b)) {
    let out: Record<string, unknown> = {}
    for (let name of names) out[name] = dup(b[name])
    return out as Bundle
  }
  return json(b, names) ??
    structuredClone(Object.fromEntries(names.map((n) => [n, b[n]]))) as Bundle
}

/** The memory of whole entities for a store bound to `driver` and `vocab`,
 * keeping up to `memory` bytes of them. */
export let memoized = (
  driver: Driver,
  vocab: Vocab,
  given?: Derived,
  memory = MEMORY,
): Memo => {
  let derived = given ?? {}
  let c = connect(driver)
  let count = Math.floor(memory / 2048)
  // A read of more entities than this is a scan: what it reads is not kept,
  // so it does not push out what is read again and again.
  let scan = Math.floor(count / 4)
  let own = new Set(['entity', 'tombstone', BLOBS, ...tables(vocab)])
  let through = Object.values(derived).flatMap((d) =>
    storedOnly(d, vocab) ? tablesOf(d.expr(col('__owner'))) ?? [] : []
  )
  // Whether the log follows the tables kept here, while the schema stands:
  // as the file's survey says where it is current (./survey.ts), or else as
  // the file itself does.
  let logs: { schema: number; follows: boolean } | undefined
  let k: Kept = {
    held: new Map(),
    part: new Map(),
    sizes: new Map(),
    bytes: 0,
    answers: new Map(),
    asked: new Set(),
    after: new Map(),
    afterPart: new Map(),
    tables: new Set([...own, ...through]),
    logged: through.every((name) => own.has(name)),
    follows: (schema) => {
      if (logs?.schema !== schema) {
        let found = surveyed(driver, vocab, given)
        logs = {
          schema,
          follows: found
            ? !found.unlogged.length
            : follows(driver, [...k.tables].filter((name) => name != BLOBS)),
        }
      }
      return logs.follows
    },
    clear: () => {
      k.held.clear()
      k.part.clear()
      k.sizes.clear()
      k.bytes = 0
    },
    drop: (eids) => {
      k.answers.clear()
      if (!eids) k.clear()
      for (let eid of eids ?? k.after.keys()) {
        if (eids) evict(eid)
        if (k.after.has(eid)) k.after.set(eid, LOST)
      }
    },
    // What a transaction writing more than a scan reads is not kept either.
    commit: () => {
      if (k.after.size > scan) return
      for (let [eid, b] of k.after) {
        if (b !== LOST && !(b && holed(b))) hold(eid, b, k.afterPart.get(eid))
      }
      trim()
    },
  }
  c.kept.add(k)
  let evict = (eid: string) => {
    k.bytes -= k.sizes.get(eid) ?? 0
    k.sizes.delete(eid)
    k.held.delete(eid)
    k.part.delete(eid)
  }
  // Held whole, or in part: only the components `asked` names. What memory
  // already holds of it in part still stands, since nothing wrote it, and
  // is held beside them: two reads naming different components of one
  // entity are each answered from memory.
  let hold = (eid: string, b: Bundle | null, asked?: Set<string>) => {
    let had = k.part.get(eid), was = k.held.get(eid)
    if (b && asked && had && was) {
      b = { ...was, ...b }
      asked = new Set([...had, ...asked])
    }
    evict(eid)
    let size = b ? sizeOf(b) : 64
    k.sizes.set(eid, size)
    k.bytes += size
    k.held.set(eid, b && kept(b))
    if (asked) k.part.set(eid, asked)
  }
  // Whether memory holds what a read asks of an entity: all of it, or the
  // components `wanted` names.
  let holds = (eid: string, wanted?: Set<string>) => {
    let part = k.part.get(eid)
    if (!k.held.has(eid)) return false
    if (!part) return true
    if (!wanted) return false
    for (let name of wanted) if (!part.has(name)) return false
    return true
  }
  let trim = () => {
    while (k.held.size > count || k.bytes > memory) {
      evict(k.held.keys().next().value!)
    }
  }
  let providers = derivedOf(vocab, derived)
  let dynamic = new Set(
    Object.entries(providers).filter(([, d]) => !storedOnly(d, vocab)).map((
      [p],
    ) => p.split('.')[0]),
  )
  for (let name of vocab.comps) {
    if (
      vocab.comp(name)?.computed ||
      vocab.props(name).some((p) =>
        vocab.prop(name, p)?.computed && !derived[`${name}.${p}`]?.stable
      )
    ) dynamic.add(name)
  }
  let writes = <R>(
    body: () => R,
    eids: (out: R) => Iterable<string>,
    mints = false,
  ): R => {
    c.writing++
    let shifts = c.shifts
    let out
    try {
      out = body()
    } catch (error) {
      // What it wrote before it failed is not known: keep nothing until
      // its transaction ends.
      k.clear()
      for (let other of c.kept) other.clear()
      if (c.shifts != shifts) {
        c.spines.clear()
        c.since.clear()
      }
      if (c.depth) c.blind = true
      throw error
    } finally {
      c.writing--
    }
    let gone = (other: Kept, eid: string) => {
      other.bytes -= other.sizes.get(eid) ?? 0
      other.sizes.delete(eid)
      other.held.delete(eid)
      other.part.delete(eid)
      other.afterPart.delete(eid)
      if (c.depth) other.after.set(eid, LOST)
    }
    for (let eid of eids(out)) {
      for (let other of c.kept) gone(other, eid)
      if (c.depth) c.dirty.add(eid)
      // An id, a number or a grave it moved is one of these entities'.
      if (c.shifts != shifts) c.spines.delete(eid)
    }
    if (mints) {
      // What it minted is not named: neither is whose spine it moved.
      if (c.shifts != shifts) {
        c.spines.clear()
        c.since.clear()
      }
      for (let other of c.kept) {
        for (let [eid, b] of other.held) if (!b) gone(other, eid)
        for (let [eid, b] of other.after) if (b === null) gone(other, eid)
      }
      if (c.depth) c.blind = true
    }
    return out
  }
  // What an entity held before this transaction's next patch: what its
  // patches so far left it, or what memory held while nothing wrote it.
  let prior = (eid: string): Bundle | null | typeof LOST =>
    k.afterPart.has(eid)
      ? LOST
      : k.after.has(eid)
      ? k.after.get(eid)!
      : c.dirty.has(eid) || !holds(eid)
      ? LOST
      : k.held.get(eid)!
  let numbered = !!vocab.prop('entity', 'num')
  // A component's stored properties, where what a patch gives them is what a
  // read returns: not one with a derived property, which a read works out
  // itself, unless it is read again on every hit anyway.
  let shapes = new Map<string, Map<string, Prop> | null>()
  let shape = (name: string): Map<string, Prop> | null => {
    if (!shapes.has(name)) {
      let props = vocab.comp(name) && k.tables.has(name)
        ? vocab.props(name).map((p) => vocab.prop(name, p)!)
        : undefined
      let exact = props && (dynamic.has(name) ||
        !props.some((p) => p.computed || derived[`${name}.${p.prop}`]))
      shapes.set(
        name,
        props && exact
          ? new Map(props.filter((p) => !p.computed).map((p) => [p.prop, p]))
          : null,
      )
    }
    return shapes.get(name)!
  }
  // A value as a read returns it once a patch has stored it, where that is
  // certain: what SQLite would convert on the way in is not.
  let cast = (p: Prop, v: unknown): unknown => {
    if (v == null) return null
    if (p.category == 'ref') return typeof v == 'string' ? v : LOST
    if (p.scalar == 'jsonb') {
      let text = JSON.stringify(v)
      return text === undefined ? LOST : JSON.parse(text)
    }
    if (p.scalar == 'binary') return v instanceof Uint8Array ? v.slice() : LOST
    if (p.scalar == 'bool') return typeof v == 'boolean' ? v : LOST
    if (p.affinity == 'text') return typeof v == 'string' ? v : LOST
    if (p.affinity == 'integer' || p.affinity == 'real') {
      return typeof v == 'number' && Number.isFinite(v) && !Object.is(v, -0) &&
          (!Number.isInteger(v) || Number.isSafeInteger(v))
        ? v
        : LOST
    }
    return LOST
  }
  // What one bundle of a patch leaves an entity holding, from what it held
  // (`null`: nothing) and the spine the patch minted or numbered for it.
  let fold = (
    base: Bundle | null,
    b: Bundle,
    mint?: Entity,
  ): Bundle | null | typeof LOST => {
    let out = base
      ? structuredClone(base)
      : mint
      ? { entity: { eid: b.entity.eid } }
      : null
    if (!out) return comps(b).length || b.entity.archetype ? LOST : null
    if (mint && numbered && mint.num != null) {
      out.entity = { ...out.entity, num: mint.num }
    }
    if (b.entity.archetype !== undefined) {
      let { archetype: _, ...entity } = out.entity
      out.entity = b.entity.archetype == null
        ? entity
        : { ...entity, archetype: String(b.entity.archetype) }
    }
    // A patch writes no rows to the dead (./write.ts `patch`).
    if ('tombstone' in out) return out
    for (let [name, comp] of comps(b)) {
      if (comp == null) {
        delete out[name]
        continue
      }
      out[name] = put(out[name] as Comp | undefined, name, comp)
    }
    return out
  }
  // What a component holds once a patch gives it `comp`, from what it held.
  let put = (had: Comp | undefined, name: string, comp: Comp): Comp => {
    let props = shape(name)
    if (!props) return { [HOLE]: true }
    let next: Comp = had ? { ...had } : {}
    // A row this patch brings takes each default it does not give.
    for (let [p, prop] of had ? [] : props) {
      if (p in comp) continue
      let d = prop.default
      let v = !d ? null : 'now' in d ? LOST : cast(prop, d.value)
      if (v === LOST) return { [HOLE]: true }
      if (v != null) next[p] = v
    }
    for (let [p, v] of Object.entries(comp)) {
      let prop = props.get(p)
      let value = prop ? cast(prop, v) : LOST
      if (value === LOST) return { [HOLE]: true }
      if (value == null) delete next[p]
      else next[p] = value
    }
    return next
  }
  // An answer whose query the entities a patch moved were selected by neither
  // before nor after it stands where it stood: its tables moved, its rows did
  // not. `before` is the tables' counts the patch began at.
  let stand = (
    was: Map<string, Bundle | null | typeof LOST>,
    now: Map<string, Bundle | null | typeof LOST>,
    before: Map<string, number>,
  ) => {
    let selects = (a: Answer, b: Bundle | null | typeof LOST | undefined) =>
      b === LOST || b === undefined ||
      (b != null && (holed(b) ? a.shape?.(b) ?? true : a.test!(b)))
    for (let a of k.answers.values()) {
      if (a.tables.some(([t, n]) => (before.get(t) ?? 0) != n)) continue
      if (a.tables.every(([t, n]) => (c.versions.get(t) ?? 0) == n)) continue
      if (a.prove) {
        Object.assign(a, a.prove())
        delete a.prove
      }
      if (!a.test) continue
      if (
        a.strict?.some((t) => (before.get(t) ?? 0) != (c.versions.get(t) ?? 0))
      ) {
        continue
      }
      let moved = [...now.keys()].some((eid) => {
        let before = was.get(eid), after = now.get(eid)
        if (a.membership) {
          if (
            [before, after].some((b) =>
              typeof b == 'symbol' || b === undefined ||
              b && holed(b) && (a.shape?.(b) ?? true)
            )
          ) return true
          return selects(a, before) != selects(a, after)
        }
        return selects(a, before) || selects(a, after)
      })
      if (!moved) a.tables = a.tables.map(([t]) => [t, c.versions.get(t) ?? 0])
    }
  }
  // Another connection's commit, or anything else this one cannot see.
  let sync = () => follow(driver, c)
  // A stable relation can change when another entity is patched. Such
  // components refresh on every miss; only this global revision can reuse the
  // completed answer. Unproven providers remain uncached.
  let related = Object.entries(providers).filter(([, d]) =>
    !storedOnly(d, vocab)
  )
  let reusable = new Set(
    related.filter(([, d]) => d.stable).map(([p]) => p.split('.')[0]),
  )
  let safe = (rows: Bundle[], comps?: string[]) => {
    let names = new Set(rows.flatMap((b) => Object.keys(b)))
    if (
      [...names].some((n) =>
        vocab.comp(n)?.computed || vocab.props(n).some((p) => {
          let ref = vocab.prop(n, p)?.ref
          return ref && vocab.comp(ref)?.computed
        })
      )
    ) return false
    let reads = related.filter(([p, d]) =>
      names.has(p.split('.')[0]) && (!!comps || d.whole !== false)
    )
    return reads.length > 0 && reads.every(([, d]) => d.stable)
  }
  let remember = (key: string, a: Answer) => {
    k.answers.set(key, a)
    if (c.depth) c.answered.push([k.answers, key])
    if (k.answers.size > ANSWERS) {
      k.answers.delete(k.answers.keys().next().value!)
    }
  }
  let getting = (
    get: Get,
    eids: string[],
    comps?: string[],
    refresh = true,
  ) => {
    // A get naming components is answered from an entity held whole, or
    // held in part with them, cut to them. What one reads is held in part,
    // unless it says all there is: an entity storage lacks, or a dead one.
    let wanted = comps && new Set(comps)
    // This transaction already knows the stored aspects its own patches
    // produced. Their rows stand now; classification can still be owed.
    let written = new Map<string, Bundle | null>()
    if (c.depth && !c.blind && comps && !comps.some((n) => dynamic.has(n))) {
      for (let eid of eids) {
        let b = k.after.get(eid), part = k.afterPart.get(eid)
        if (
          b === undefined || b === LOST ||
          part && !comps.every((n) => part.has(n))
        ) continue
        if (b && comps.some((n) => b[n] != null && HOLE in (b[n] as Comp))) {
          continue
        }
        written.set(eid, b)
      }
    }
    let missing = [...new Set(eids)].filter((eid) =>
      !written.has(eid) && !holds(eid, wanted)
    )
    let read = new Set(missing)
    let fresh = new Map(
      (missing.length ? get(missing, comps) : []).map((
        b,
      ) => [b.entity.eid, b]),
    )
    if (!c.blind && missing.length <= scan) {
      for (let eid of missing) {
        if (c.dirty.has(eid)) continue
        let b = fresh.get(eid) ?? null
        hold(eid, b, wanted && b && !dead(b) ? wanted : undefined)
      }
    }
    let hits = eids.filter((eid) =>
      !written.has(eid) && !read.has(eid) && k.held.get(eid)
    )
    // A hit's dynamic components are read now, in one statement, of the hits
    // holding any.
    let changing = refresh &&
      (!wanted || [...wanted].some((name) => dynamic.has(name)))
    let stale = new Map(
      (changing ? hits : []).flatMap((eid) => {
        let names = Object.keys(k.held.get(eid)!).filter((name) =>
          dynamic.has(name) && (!wanted || wanted.has(name))
        )
        return names.length ? [[eid, names] as const] : []
      }),
    )
    let names = [...new Set([...stale.values()].flat())]
    let current = new Map(
      (names.length ? get([...stale.keys()], names) : []).map((
        b,
      ) => [b.entity.eid, b]),
    )
    let out = eids.flatMap((eid) => {
      if (written.has(eid)) {
        let b = written.get(eid)
        return b ? [copy(b, wanted)] : []
      }
      if (read.has(eid)) return fresh.has(eid) ? [fresh.get(eid)!] : []
      let held = k.held.get(eid)!
      k.held.delete(eid)
      k.held.set(eid, held)
      if (!held) return []
      let b = copy(held, wanted, names), now = current.get(eid)
      return [now ? Object.assign(b, now) : b]
    })
    trim()
    return out
  }
  let viewed = (key: string, run: () => Bundle[], comps?: string[]) => {
    sync()
    if (
      !reusable.size ||
      comps && !comps.some((n) => reusable.has(n))
    ) return run()
    let limit = ANSWER - key.length * 2
    if (limit <= 0) return run()
    let epoch = revision(driver, 'data')
    let held = k.answers.get(key)
    if (held?.epoch == epoch) {
      k.answers.delete(key)
      k.answers.set(key, held)
      return copied(held.rows) as Bundle[]
    }
    if (held) k.answers.delete(key)
    let rows = run()
    if (!safe(rows, comps) || epoch != revision(driver, 'data')) return rows
    if (!held && !k.asked.delete(key)) {
      k.asked.add(key)
      if (k.asked.size > ASKED) k.asked.delete(k.asked.values().next().value!)
      return rows
    }
    let kept = packed(rows, limit)
    if (kept) remember(key, { tables: [], epoch, rows: kept })
    return rows
  }
  let stored = new Set(['tombstone', ...tables(vocab)])
  return {
    presence: (eid, tables) => {
      sync()
      if (c.blind || !tables.every((name) => stored.has(name))) {
        return undefined
      }
      let b = prior(eid)
      return b === LOST || b == null
        ? undefined
        : tables.filter((name) => b[name] != null)
    },
    answer: (key, dependencies, run, prove) => {
      if (!dependencies) return run()
      sync()
      let current = (table: string) => c.versions.get(table) ?? 0
      let held = k.answers.get(key)
      if (held && held.tables.every(([t, n]) => current(t) == n)) {
        k.answers.delete(key)
        k.answers.set(key, held)
        return copied(held.rows)
      }
      if (held) k.answers.delete(key)
      // Most of what a write asks is asked once: the dependents of the entity
      // it wrote, what points at one it deletes, the page after a cursor.
      // Keeping an answer costs a copy of it and a test for it, so an answer
      // is kept once its query is asked again.
      else if (!k.asked.delete(key)) {
        k.asked.add(key)
        if (k.asked.size > ASKED) {
          k.asked.delete(k.asked.values().next().value!)
        }
        return run()
      }
      let tables = dependencies()
      if (!tables) return run()
      let at = tables.map((t): [string, number] => [t, current(t)])
      let rows = run()
      if (at.some(([t, n]) => current(t) != n)) return rows
      let kept = packed(rows, ANSWER)
      if (!kept) return rows
      remember(key, {
        tables: at,
        rows: kept,
        prove: () => {
          let { query, membership, strict, shape } = prove?.() ?? {}
          let proof = typeof query == 'function' || !query
            ? undefined
            : rooted(vocab, query)
          return {
            test: typeof query == 'function' ? query : proof?.test,
            shape: shape ?? proof?.shape,
            membership: membership &&
              (typeof query == 'function' || !!query && local(vocab, query)),
            strict: [
              ...new Set([
                ...strict ?? [],
                ...proof?.strict ?? [],
              ]),
            ],
          }
        },
      })
      return rows
    },
    get: (get, eids, comps, refresh = true) => {
      sync()
      return getting(get, eids, comps, refresh)
    },
    view: viewed,
    writes,
    removes: (eids, at, body) => {
      sync()
      let was = new Map<string, Bundle | null | typeof LOST>(
        eids.map((eid) => [eid, prior(eid)]),
      )
      let before = new Map(c.versions)
      writes(body, () => eids)
      if (!c.depth || c.blind) return
      // What each holds once buried: its grave, and nothing else.
      let buried = (eid: string, b: Bundle | null): Bundle => ({
        entity: b ? { ...b.entity } : { eid },
        tombstone: { deleted_at: at },
      })
      let now = new Map<string, Bundle | null | typeof LOST>()
      for (let [eid, b] of was) {
        now.set(eid, b === LOST || b == null ? b : buried(eid, b))
      }
      for (let [eid, b] of now) {
        k.after.set(
          eid,
          b && b !== LOST ? { entity: b.entity, tombstone: {} } : b,
        )
      }
      stand(was, now, before)
    },
    patch: (bundles, body) => {
      sync()
      let eids = [...new Set(bundles.map((b) => b.entity.eid))]
      let partial = new Map(eids.flatMap((eid) => {
        let names = k.afterPart.get(eid) ??
          (!c.dirty.has(eid) ? k.part.get(eid) : undefined)
        let b = k.afterPart.has(eid) ? k.after.get(eid) : k.held.get(eid)
        return names && b && b !== LOST
          ? [[eid, { names: new Set(names), b: structuredClone(b) }] as const]
          : []
      }))
      // What each held before, taken before the write lets it go.
      let now = new Map<string, Bundle | null | typeof LOST>(
        eids.map((eid) => [eid, prior(eid)]),
      )
      let known: Known = (eid, name) => {
        let b = now.get(eid)
        if (b === LOST || b === undefined || c.blind) return undefined
        let held = b?.[name] as Comp | undefined
        // A row whose values memory can't work out vouches for none of them.
        return held == null ? null : HOLE in held ? {} : held
      }
      let shifts = c.shifts, before = new Map(c.versions)
      let born = writes(
        () => body(known),
        (born) => [...eids, ...born.map((e) => e.eid)],
      )
      if (!c.depth || c.blind) return born
      // A number the patch took away, or one it gave an entity a reference
      // minted, is not in what it said.
      if (c.shifts != shifts) return born
      let minted = new Map(born.map((e) => [e.eid, e]))
      // An entity the patch minted or first numbered held nothing before it.
      for (let eid of minted.keys()) if (now.has(eid)) now.set(eid, null)
      let was = new Map(now)
      for (let b of bundles) {
        let eid = b.entity.eid, base = now.get(eid)!
        let part = partial.get(eid)
        if (part) {
          // Unknown aspects stay unknown. Only values whose entire aspect
          // was read can be folded through a patch without another lookup.
          let patch = Object.fromEntries(
            Object.entries(b).filter(([name]) =>
              name == 'entity' || part.names.has(name)
            ),
          ) as Bundle
          let next = fold(part.b, patch)
          now.set(eid, next)
          if (next && next !== LOST) {
            partial.set(eid, { names: part.names, b: next })
          }
          k.afterPart.set(eid, part.names)
        } else {
          now.set(eid, base === LOST ? LOST : fold(base, b, minted.get(eid)))
        }
      }
      for (let [eid, b] of now) k.after.set(eid, b)
      // A spine a reference minted holds what memory can't say.
      if (born.every((e) => now.has(e.eid))) stand(was, now, before)
      return born
    },
  }
}
