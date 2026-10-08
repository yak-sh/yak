// Whole entities a store has read, kept in memory while nothing has written
// them: the hero a page relays ten times a second is read once, not once per
// relay. An entity is let go when a write through this package names it
// (`writes`); every entity is let go when a statement writes a component table
// any other way, when the schema moves, and when another connection commits
// (@yaks/sql `revision`'s `outside`).
//
// A transaction can roll back what it wrote, so nothing a transaction still
// open has written is kept: it is read from SQL while the transaction runs,
// and kept again once it has ended either way. A write this package cannot
// attribute keeps nothing at all until the transaction ends. The transactions
// are the ones this connection says: `begin` and savepoints through `query`,
// and the driver's own `tx`.
//
// Spines (./write.ts `spines`: an eid's integer id, number and grave) are kept
// for the connection too, so the patches one transaction makes read each
// entity's spine once. Any statement that may move one lets every spine go,
// except a plain mint, which this package tells (`spined().learn`); those kept
// during a transaction go if it rolls back.
//
// A query's rows are kept too, while no table its answer stands on has been
// written (`answer`, `basis`): a page walking back over tiles it has watched
// asks them again for nothing while nobody has written a place. Every write
// statement moves its table's count, so nothing a write says has to be
// trusted; what memory can't follow (text, nearness, edges, computed and
// derived properties, time phrases) is read every time. An answer about each
// entity alone stands through a patch whose entities it selects neither before
// nor after (`local`, `stand`).
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
// in part: what an earlier get naming at least those read. Returned bundles
// are copies; dynamic components (computed, or derived from anything but this
// connection's rows) are read again on every hit. Bounded by count and bytes,
// the longest unread let go first; a scan is read through, not kept.
import { type Bundle, type Comp, comps, dead, type Entity } from '@yaks/graph'
import type { Prop, Vocab } from '@yaks/vocab'
import { type And, bare, type Clause, drifts, type Pred } from '@yaks/query'
import {
  type Derived,
  type Driver,
  revision,
  type Row,
  type Stmt,
} from '@yaks/sql'
import { type Filter, filter } from '@yaks/match'
import { tables } from './ddl.ts'
import type { Known, Spine } from './write.ts'

type Get = (eids: string[], comps?: string[]) => Bundle[]

/** A store's memory of whole entities. */
export type Memo = {
  /** These entities through `get`: whole ones from memory where held. */
  get: (get: Get, eids: string[], comps?: string[]) => Bundle[]
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
  /** The rows `run` answers the query `key` names with, from memory while no
   * table `tables` names has been written since, or while what was written
   * moved nothing `query` selects; `tables` left out (a query memory can't
   * follow, `basis`), from `run` every time. */
  answer: (
    key: string,
    tables: string[] | undefined,
    run: () => Row[],
    query?: And,
  ) => Row[]
}

type Answer = {
  tables: [string, number][]
  rows: Row[]
  /** whether an entity is one the query selects, where memory can tell */
  test?: Filter
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

const COUNT = 2048, BYTES = 4 << 20, SPINES = 8192
// A read of more entities than this is a scan: what it reads is not kept, so
// it does not push out what is read again and again.
const SCAN = COUNT / 4
// Answers are bounded by count, and one too large to keep is read every time.
const ANSWERS = 256, ANSWER = 16 << 10

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
): string[] | undefined => {
  let out = new Set(['tombstone'])
  if (catalogued) out.add('archetype')
  let path = (segs: string[], facet = false): boolean => {
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
  if (!anchored(q)) out.add('entity')
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
  let own = (segs: string[], facet = false) =>
    vocab.aim(segs.join('.'), facet).length <= 1
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
  /** keep what the transaction that just committed left */
  commit: () => void
  sizes: Map<string, number>
  bytes: number
  answers: Map<string, Answer>
  tables: Set<string>
  clear: () => void
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
  /** the `outside` revision the spines were kept at */
  outside: number
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
  outside: -1,
  versions: new Map(),
  shifts: 0,
  answered: [],
})

// Have `driver` tell the connection `c` each statement and transaction it runs.
let tell = (driver: Driver, c: Connection) => {
  // What a rolled-back transaction had kept of spines and answers may be gone
  // with it.
  let undone = () => {
    for (let eid of c.since) c.spines.delete(eid)
    c.since.clear()
    for (let [answers, key] of c.answered) answers.delete(key)
    c.answered = []
    for (let k of c.kept) for (let eid of k.after.keys()) k.after.set(eid, LOST)
  }
  let ended = (committed: boolean) => {
    if (!committed) undone()
    for (let k of c.kept) {
      if (committed && !c.blind) k.commit()
      k.after.clear()
    }
    c.depth = 0
    c.dirty.clear()
    c.blind = false
    c.since.clear()
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
  let observe = (s: Stmt): void => {
    if (s.t == 'raw') return s.origin && observe(s.origin)
    if (s.t == 'begin' || s.t == 'savepoint') c.depth++
    else if (s.t == 'commit') ended(true)
    else if (s.t == 'rollback') s.to ? undone() : ended(false)
    else if (s.t == 'release' && --c.depth <= 0) ended(true)
    else if (s.t == 'insert' || s.t == 'update' || s.t == 'delete') {
      let table = s.t == 'insert' ? s.into : s.t == 'update' ? s.table : s.from
      bump(table)
      if (moves(s)) {
        c.shifts++
        unspine()
        // A number, an eid or an id itself moved: what any answer ordered,
        // paged or compared a reference by.
        if (table == 'entity') { for (let k of c.kept) k.answers.clear() }
      }
      if (!c.writing && !adds(s)) forget(table)
    } else if (
      s.t.startsWith('create ') || s.t == 'alter table' || s.t == 'drop'
    ) {
      forget()
      unspine()
      for (let k of c.kept) k.answers.clear()
    }
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
      c.depth++
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
      let now = revision(driver, 'outside')
      if (now != c.outside) {
        c.spines.clear()
        c.since.clear()
        c.outside = now
      }
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

let sizeOf = (b: Bundle) =>
  JSON.stringify(
    b,
    (_key, value) => typeof value == 'bigint' ? String(value) : value,
  ).length * 2

/** The memory of whole entities for a store bound to `driver` and `vocab`. */
export let memoized = (
  driver: Driver,
  vocab: Vocab,
  derived: Derived = {},
): Memo => {
  let c = connect(driver)
  let k: Kept = {
    held: new Map(),
    part: new Map(),
    sizes: new Map(),
    bytes: 0,
    answers: new Map(),
    after: new Map(),
    tables: new Set(['entity', 'tombstone', BLOBS, ...tables(vocab)]),
    clear: () => {
      k.held.clear()
      k.part.clear()
      k.sizes.clear()
      k.bytes = 0
    },
    // What a transaction writing more than a scan reads is not kept either.
    commit: () => {
      if (k.after.size > SCAN) return
      for (let [eid, b] of k.after) {
        if (b !== LOST && !(b && holed(b))) hold(eid, b)
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
  // Held whole, or in part: only the components `asked` names.
  let hold = (eid: string, b: Bundle | null, asked?: Set<string>) => {
    evict(eid)
    let size = b ? sizeOf(b) : 64
    k.sizes.set(eid, size)
    k.bytes += size
    k.held.set(eid, b && structuredClone(b))
    if (asked) k.part.set(eid, asked)
  }
  // Whether memory holds what a read asks of an entity: all of it, or the
  // components `wanted` names.
  let holds = (eid: string, wanted?: Set<string>) => {
    let part = k.part.get(eid)
    return k.held.has(eid) &&
      (!part || !!wanted && [...wanted].every((name) => part.has(name)))
  }
  let trim = () => {
    while (k.held.size > COUNT || k.bytes > BYTES) {
      evict(k.held.keys().next().value!)
    }
  }
  let dynamic = new Set(
    Object.entries(derived).filter(([, value]) => !value.stable).map(([p]) =>
      p.split('.')[0]
    ),
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
    let out
    try {
      out = body()
    } catch (error) {
      // What it wrote before it failed is not known: keep nothing until
      // its transaction ends.
      k.clear()
      for (let other of c.kept) other.clear()
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
      if (c.depth) other.after.set(eid, LOST)
    }
    for (let eid of eids(out)) {
      for (let other of c.kept) gone(other, eid)
      if (c.depth) c.dirty.add(eid)
    }
    if (mints) {
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
    k.after.has(eid)
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
      next[p] = v
    }
    for (let [p, v] of Object.entries(comp)) {
      let prop = props.get(p)
      let value = prop ? cast(prop, v) : LOST
      if (value === LOST) return { [HOLE]: true }
      next[p] = value
    }
    return next
  }
  let seen = -1
  // Another connection's commit, or anything else this one cannot see.
  // What an answer is kept across writes by, for a query `local` allows.
  let tested = (q: And): Filter | undefined => {
    try {
      return local(vocab, q) ? filter(q, vocab) : undefined
    } catch {
      return undefined
    }
  }
  // An answer whose query the entities a patch moved were selected by neither
  // before nor after it stands where it stood: its tables moved, its rows did
  // not. `before` is the tables' counts the patch began at.
  let stand = (
    was: Map<string, Bundle | null | typeof LOST>,
    now: Map<string, Bundle | null | typeof LOST>,
    before: Map<string, number>,
  ) => {
    let selects = (test: Filter, b: Bundle | null | typeof LOST | undefined) =>
      b === LOST || b === undefined || (b != null && (holed(b) || test(b)))
    for (let a of k.answers.values()) {
      if (!a.test) continue
      if (a.tables.some(([t, n]) => (before.get(t) ?? 0) != n)) continue
      let moved = [...now.keys()].some((eid) =>
        selects(a.test!, was.get(eid)) || selects(a.test!, now.get(eid))
      )
      if (!moved) a.tables = a.tables.map(([t]) => [t, c.versions.get(t) ?? 0])
    }
  }
  let sync = () => {
    let now = revision(driver, 'outside')
    if (now == seen) return
    k.clear()
    k.answers.clear()
    for (let eid of k.after.keys()) k.after.set(eid, LOST)
    seen = now
  }
  return {
    answer: (key, tables, run, query) => {
      if (!tables) return run()
      sync()
      let current = (table: string) => c.versions.get(table) ?? 0
      let held = k.answers.get(key)
      if (held && held.tables.every(([t, n]) => current(t) == n)) {
        k.answers.delete(key)
        k.answers.set(key, held)
        return structuredClone(held.rows)
      }
      if (held) k.answers.delete(key)
      let at = tables.map((t): [string, number] => [t, current(t)])
      let rows = run()
      if (at.some(([t, n]) => current(t) != n)) return rows
      let size = JSON.stringify(
        rows,
        (_k, v) => typeof v == 'bigint' ? String(v) : v,
      ).length * 2
      if (size > ANSWER) return rows
      k.answers.set(key, {
        tables: at,
        rows: structuredClone(rows),
        test: query && tested(query),
      })
      if (c.depth) c.answered.push([k.answers, key])
      if (k.answers.size > ANSWERS) {
        k.answers.delete(k.answers.keys().next().value!)
      }
      return rows
    },
    get: (get, eids, comps) => {
      sync()
      // A get naming components is answered from an entity held whole, or
      // held in part with them, cut to them. What one reads is held in part,
      // unless it says all there is: an entity storage lacks, or a dead one.
      let wanted = comps && new Set(comps)
      let missing = [...new Set(eids)].filter((eid) => !holds(eid, wanted))
      let read = new Set(missing)
      let fresh = new Map(
        (missing.length ? get(missing, comps) : []).map((
          b,
        ) => [b.entity.eid, b]),
      )
      if (!c.blind && missing.length <= SCAN) {
        for (let eid of missing) {
          if (c.dirty.has(eid)) continue
          let b = fresh.get(eid) ?? null
          hold(eid, b, wanted && b && !dead(b) ? wanted : undefined)
        }
      }
      let hits = eids.filter((eid) => !read.has(eid) && k.held.get(eid))
      // A hit's dynamic components are read now, in one statement.
      let names = [
        ...new Set(
          hits.flatMap((eid) =>
            Object.keys(k.held.get(eid)!).filter((name) =>
              dynamic.has(name) && (!wanted || wanted.has(name))
            )
          ),
        ),
      ]
      let current = new Map(
        (names.length ? get([...new Set(hits)], names) : []).map((
          b,
        ) => [b.entity.eid, b]),
      )
      let out = eids.flatMap((eid) => {
        if (read.has(eid)) return fresh.has(eid) ? [fresh.get(eid)!] : []
        let held = k.held.get(eid)!
        k.held.delete(eid)
        k.held.set(eid, held)
        if (!held) return []
        let b = structuredClone(held)
        for (let name of Object.keys(b)) {
          if (
            names.includes(name) ||
            wanted && name != 'entity' && name != 'tombstone' &&
              !wanted.has(name)
          ) delete b[name]
        }
        return [Object.assign(b, current.get(eid) ?? {})]
      })
      trim()
      return out
    },
    writes,
    patch: (bundles, body) => {
      sync()
      let eids = [...new Set(bundles.map((b) => b.entity.eid))]
      // What each held before, taken before the write lets it go.
      let now = new Map<string, Bundle | null | typeof LOST>(
        eids.map((eid) => [eid, prior(eid)]),
      )
      let known: Known = (eid, name) => {
        let b = now.get(eid)
        return b === LOST || b === undefined || c.blind
          ? undefined
          : b?.[name] != null
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
        now.set(eid, base === LOST ? LOST : fold(base, b, minted.get(eid)))
      }
      for (let [eid, b] of now) k.after.set(eid, b)
      // A spine a reference minted holds what memory can't say.
      if (born.every((e) => now.has(e.eid))) stand(was, now, before)
      return born
    },
  }
}
