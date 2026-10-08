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
// Returned bundles are copies; dynamic components (computed, or derived from
// anything but this connection's rows) are read again on every hit. Bounded by
// count and bytes, the longest unread let go first.
import type { Bundle } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { type Derived, type Driver, revision, type Stmt } from '@yaks/sql'
import { tables } from './ddl.ts'

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
}

const COUNT = 2048, BYTES = 4 << 20

type Kept = {
  /** an entity as read, or `null` for one storage does not hold */
  held: Map<string, Bundle | null>
  sizes: Map<string, number>
  bytes: number
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
  }
  connections.set(driver, c)
  let ended = () => {
    c.depth = 0
    c.dirty.clear()
    c.blind = false
  }
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
    else if (s.t == 'commit' || s.t == 'rollback' && !s.to) ended()
    else if (s.t == 'release' && --c.depth <= 0) ended()
    else if (s.t == 'insert' || s.t == 'update' || s.t == 'delete') {
      if (!c.writing) {
        forget(s.t == 'insert' ? s.into : s.t == 'update' ? s.table : s.from)
      }
    } else if (
      s.t.startsWith('create ') || s.t == 'alter table' || s.t == 'drop'
    ) forget()
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
      try {
        return tx(body)
      } finally {
        if (--c.depth <= 0) ended()
      }
    }
  }
  return c
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
  return {
    get: (get, eids, comps) => {
      let now = revision(driver, 'outside')
      if (now != seen) {
        k.clear()
        seen = now
      }
      // Projections have coverage of their own; only whole snapshots are kept.
      if (comps) return get(eids, comps)
      let missing = [...new Set(eids)].filter((eid) => !k.held.has(eid))
      let fresh = new Map(
        (missing.length ? get(missing) : []).map((b) => [b.entity.eid, b]),
      )
      if (!c.blind) {
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
            Object.keys(k.held.get(eid)!).filter((name) => dynamic.has(name))
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
        for (let name of names) delete b[name]
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
