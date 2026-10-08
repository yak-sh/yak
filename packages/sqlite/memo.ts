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
// derived properties, time phrases) is read every time.
//
// A get naming components is cut from a whole entity held. Returned bundles
// are copies; dynamic components (computed, or derived from anything but this
// connection's rows) are read again on every hit. Bounded by count and bytes,
// the longest unread let go first; a scan is read through, not kept.
import type { Bundle } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { type And, bare, type Clause, drifts, type Pred } from '@yaks/query'
import {
  type Derived,
  type Driver,
  revision,
  type Row,
  type Stmt,
} from '@yaks/sql'
import { tables } from './ddl.ts'
import type { Spine } from './write.ts'

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
  /** The rows `run` answers the query `key` names with, from memory while no
   * table `tables` names has been written since; `tables` left out (a query
   * memory can't follow, `basis`), from `run` every time. */
  answer: (key: string, tables: string[] | undefined, run: () => Row[]) => Row[]
}

type Answer = { tables: [string, number][]; rows: Row[] }

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

type Kept = {
  /** an entity as read, or `null` for one storage does not hold */
  held: Map<string, Bundle | null>
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
  /** answers kept while a transaction is open, by where they are kept */
  answered: [Map<string, Answer>, string][]
  /** the `outside` revision the spines were kept at */
  outside: number
}

let connections = new WeakMap<Driver, Connection>()

let connect = (driver: Driver): Connection => {
  let known = connections.get(driver)
  if (known) return known
  let c: Connection = {
    kept: new Set(),
    depth: 0,
    writing: 0,
    dirty: new Set(),
    blind: false,
    spines: new Map(),
    since: new Set(),
    outside: -1,
    versions: new Map(),
    answered: [],
  }
  connections.set(driver, c)
  // What a rolled-back transaction had kept of spines and answers may be gone
  // with it.
  let undone = () => {
    for (let eid of c.since) c.spines.delete(eid)
    c.since.clear()
    for (let [answers, key] of c.answered) answers.delete(key)
    c.answered = []
  }
  let ended = (committed: boolean) => {
    c.depth = 0
    c.dirty.clear()
    c.blind = false
    if (!committed) undone()
    c.since.clear()
    c.answered = []
  }
  let bump = (table: string) =>
    c.versions.set(table, (c.versions.get(table) ?? 0) + 1)
  let unspine = () => {
    c.spines.clear()
    c.since.clear()
  }
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
        unspine()
        // A number, an eid or an id itself moved: what any answer ordered,
        // paged or compared a reference by.
        if (table == 'entity') { for (let k of c.kept) k.answers.clear() }
      }
      if (!c.writing) forget(table)
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
        if (--c.depth <= 0) ended(committed)
      }
    }
  }
  return c
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
    sizes: new Map(),
    bytes: 0,
    answers: new Map(),
    tables: new Set(['entity', 'tombstone', 'blob_text', ...tables(vocab)]),
    clear: () => {
      k.held.clear()
      k.sizes.clear()
      k.bytes = 0
    },
  }
  c.kept.add(k)
  let evict = (eid: string) => {
    k.bytes -= k.sizes.get(eid) ?? 0
    k.sizes.delete(eid)
    k.held.delete(eid)
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
  let seen = -1
  // Another connection's commit, or anything else this one cannot see.
  let sync = () => {
    let now = revision(driver, 'outside')
    if (now == seen) return
    k.clear()
    k.answers.clear()
    seen = now
  }
  return {
    answer: (key, tables, run) => {
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
      k.answers.set(key, { tables: at, rows: structuredClone(rows) })
      if (c.depth) c.answered.push([k.answers, key])
      if (k.answers.size > ANSWERS) {
        k.answers.delete(k.answers.keys().next().value!)
      }
      return rows
    },
    get: (get, eids, comps) => {
      sync()
      // A get naming components is answered from a whole entity held, cut
      // to them; one read for it is not kept, since it is not whole.
      let wanted = comps && new Set(comps)
      let missing = [...new Set(eids)].filter((eid) => !k.held.has(eid))
      let fresh = new Map(
        (missing.length ? get(missing, comps) : []).map((
          b,
        ) => [b.entity.eid, b]),
      )
      if (!wanted && !c.blind && missing.length <= SCAN) {
        for (let eid of missing) {
          if (c.dirty.has(eid)) continue
          let b = fresh.get(eid) ?? null
          let size = b ? sizeOf(b) : 64
          k.sizes.set(eid, size)
          k.bytes += size
          k.held.set(eid, b && structuredClone(b))
        }
      }
      let hits = eids.filter((eid) => !fresh.has(eid) && k.held.get(eid))
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
        let row = fresh.get(eid)
        if (row) return [row]
        if (!k.held.has(eid)) return []
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
      while (k.held.size > COUNT || k.bytes > BYTES) {
        evict(k.held.keys().next().value!)
      }
      return out
    },
    writes: (body, eids, mints = false) => {
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
      }
      for (let eid of eids(out)) {
        for (let other of c.kept) gone(other, eid)
        if (c.depth) c.dirty.add(eid)
      }
      if (mints) {
        for (let other of c.kept) {
          for (let [eid, b] of other.held) if (!b) gone(other, eid)
        }
        if (c.depth) c.blind = true
      }
      return out
    },
  }
}
