// A graph in a Map. This is @yaks/graph's `Storage` with nothing underneath it
// — one record per entity, keyed by eid, held in a plain Map — so a graph can
// run in a page, in a worker, or in a test with no database to install, no
// driver to bind, and no promise to await.
//
// Reads go through @yaks/match: the same query string @yaks/sql compiles into a
// SQL statement is evaluated here as a predicate over the bundles the map
// holds. This file hands the matcher its rows the way a database hands a plan
// its tables: by id, by the component an entity wears, and by the value a
// property holds, so a query that names a component or asks for a value reads
// those entities and no others.
//
// Writes follow the patch rules every adapter implements — omitted properties
// untouched, a null property cleared, a null component dropped, a tombstoned
// entity taking no patch until `revive` brings it back under the identity it
// kept — and identity belongs to storage: `patch` creates a
// record for every eid the write touches or points at, numbers each new one in
// the order it was first touched, and returns what it created.
//
// A record is the bundle a read answers with, and it is never mutated in place:
// a patch builds the next one and puts it in the map. So a read copies nothing,
// and rolling back is cheap — an undo log of one reference per entity a
// transaction touched, replayed backwards, restores the map and its indexes
// exactly as they were without copying anything the write did not touch.

import type { Bundle, Comp, Eid, Entity, ReadOpts, Row } from '@yaks/graph'
import { comps, isPromise, TOMBSTONE, tombstoned } from '@yaks/graph'
import {
  type Computed,
  type Index,
  keyOf,
  matcher,
  type Query,
  rows as answer,
} from '@yaks/match'
import type { Vocab } from '@yaks/vocab'

export type { Query }

/** Passed to every read of a store: the moment relative time phrases in a query
 * (`.released=today`) resolve against. A per-call `opts` overrides it. */
export type RamOpts = {
  /** the reference moment for time phrases (default: the read's own `now`) */
  now?: number
  /** keep the `num` a patch's identity already carries, and never assign one.
   * This is what a store mirroring another graph needs — a client applying the
   * changes a server returned is being told the identity, not choosing it. An
   * entity it has not been told a number for has none: a number it guessed
   * could be another entity's. Off by default: a store that mirrors nothing
   * owns its own numbering. */
  adopt?: boolean
  /** Give new entities a human-readable number. Opt-IN, with the same option
   * name @yaks/sqlite uses: left out, an entity has its eid and nothing else.
   * `{ except: [comp, …] }` turns numbering on while leaving the entities of
   * the named components unnumbered. */
  number?: boolean | { except: readonly string[] }
  /** `comp.prop` → the value for one bundle, for each property the vocabulary
   * declares computed and never stores: what `.task.status=open` is answered
   * with here, the way @yaks/sql answers it with a `derived` expression. A
   * package that declares one ships the rule (@yaks/task `compute`). Left out,
   * a query on a computed property is refused, naming it. */
  computed?: Computed
}

/**
 * A transaction over the map: @yaks/graph's `Tx`, implemented synchronously.
 * The store commits when the body returns and rolls back when it throws, so a
 * rejected write leaves the map exactly as it found it.
 */
export type Tx = {
  /** a query → the matching entities as whole bundles */
  read: (query: Query, opts?: ReadOpts) => Bundle[]
  /** lookup by id, not search: these entities as they stand, whole. A deleted
   * one carries `tombstone`; an unknown one is simply absent. */
  get: (eids: Eid[]) => Bundle[]
  /** apply these patches → the entities they created, each with its `num` */
  patch: (bundles: Bundle[]) => Entity[]
  /** Evict live payloads, not identities. A later patch keeps the same number.
   * A tombstone stays; eviction is never deletion. */
  evict: (eids: Eid[]) => void
  /** remove these entities: their components go, their identity is tombstoned */
  remove: (entities: Entity[]) => void
  /** bring these tombstoned entities back, with their identity and no
   * components */
  revive: (eids: Eid[]) => void
}

/**
 * A bound store: @yaks/graph's `Storage`, implemented synchronously. It has
 * the same five members a database adapter has, so it satisfies `Storage`
 * wherever one is wanted — and a caller using a `Store` directly never awaits
 * a row.
 */
export type Store = {
  /** nothing to create — installing a map is a no-op */
  install: () => void
  /** a query → the matching entities as whole bundles */
  read: (query: Query, opts?: ReadOpts) => Bundle[]
  /** a query → one raw `{ eid }` row per match, or an aggregate's rows */
  rows: (query: Query, opts?: ReadOpts) => Row[]
  /** these entities as they stand, whole */
  get: (eids: Eid[]) => Bundle[]
  /** run `body` in a transaction: commit on return, roll back on throw */
  tx: <R>(body: (tx: Tx) => R) => R
}

// A deleted entity keeps its identity and a tombstone, and nothing else, until
// `revive` brings it back.
let buried = (b: Bundle | undefined): boolean => b?.[TOMBSTONE] != null
// An entity that holds nothing yet: the record a reference made.
let empty = (b: Bundle): boolean => {
  for (let k in b) if (k != 'entity') return false
  return true
}
let NONE: ReadonlyMap<Eid, Bundle> = new Map()
let file = (
  byKey: Map<string, Map<Eid, Bundle>>,
  key: string,
  eid: Eid,
  b: Bundle,
) => {
  let at = byKey.get(key)
  if (!at) byKey.set(key, at = new Map())
  at.set(eid, b)
}

/**
 * A store over a Map of bundles, bound to a vocabulary once. It is the storage
 * a client graph and a fast test run on:
 *
 * ```ts
 * import { graph } from '@yaks/graph'
 * import { loadVocab } from '@yaks/vocab'
 * import { docDoc } from '@yaks/doc'
 * import { ram } from '@yaks/ram'
 *
 * let vocab = loadVocab([docDoc])
 * let g = graph({ storage: ram(vocab), vocab })
 * g.apply([{ entity: { eid: 'b1' }, doc: { title: 'Dune' } }])
 * g.read('.kind=doc')
 * ```
 */
export let ram = (vocab: Vocab, base: RamOpts = {}): Store => {
  // One bundle per entity: the answer a read hands back, built once per write.
  let rows = new Map<Eid, Bundle>()
  // Compact identity reservations survive payload eviction. They are not query rows.
  let cold = new Map<Eid, Entity>()
  // What a query reads instead of every row: the entities wearing each
  // component, and — for each property a query has asked for by value — the
  // entities by the key their value files under (@yaks/match `keyOf`).
  let worn = new Map<string, Map<Eid, Bundle>>()
  let filed = new Map<string, [string, string, Map<string, Map<Eid, Bundle>>]>()
  let next = 1
  // The undo log: for each entity a transaction is about to change, the record
  // it held first. Replayed backwards, it is the rollback.
  let log: [Eid, Bundle | undefined, Entity | undefined][] = []
  let depth = 0
  let save = (eid: Eid) => log.push([eid, rows.get(eid), cold.get(eid)])

  // One entity's record replaced, or dropped, and every index moved with it.
  // Every write goes through here, a rollback's included, so an index never
  // disagrees with the rows.
  let put = (eid: Eid, b: Bundle | undefined) => {
    let was = rows.get(eid)
    if (b) rows.set(eid, b)
    else rows.delete(eid)
    if (was) {
      for (let name in was) {
        if (name != 'entity' && !(b && name in b)) worn.get(name)?.delete(eid)
      }
    }
    if (b) {
      for (let name in b) {
        if (name == 'entity') continue
        let at = worn.get(name)
        if (!at) worn.set(name, at = new Map())
        at.set(eid, b)
      }
    }
    for (let [comp, prop, byKey] of filed.values()) {
      let from = keyOf((was?.[comp] as Comp | undefined)?.[prop])
      let to = keyOf((b?.[comp] as Comp | undefined)?.[prop])
      if (from !== undefined && from !== to) byKey.get(from)?.delete(eid)
      if (to !== undefined) file(byKey, to, eid, b!)
    }
  }

  // The keyed index over one property: filed from the component index the
  // first time a query asks for it, and kept by `put` from then on.
  let keys = (comp: string, prop: string): Map<string, Map<Eid, Bundle>> => {
    let at = `${comp}.${prop}`
    let held = filed.get(at)
    if (held) return held[2]
    let byKey = new Map<string, Map<Eid, Bundle>>()
    filed.set(at, [comp, prop, byKey])
    for (let [eid, b] of worn.get(comp) ?? NONE) {
      let key = keyOf((b[comp] as Comp)[prop])
      if (key !== undefined) file(byKey, key, eid, b)
    }
    return byKey
  }

  // What one read sees: every row, by id, by component and by value. A fresh
  // view per read, so what a run keeps against it (a walk's closure) never
  // outlives the rows it was worked out from.
  let view = (): Index => {
    let list: Bundle[] | undefined
    return {
      get list() {
        return list ??= [...rows.values()]
      },
      of: (eid) => rows.get(eid),
      wearing: (comp) => worn.get(comp) ?? NONE,
      keyed: (comp, prop, key) => keys(comp, prop).get(key) ?? NONE,
    }
  }

  let isRef = (comp: string, prop: string) =>
    vocab.prop(comp, prop)?.category == 'ref'

  // The properties of a patch this vocabulary stores. A component whose patch
  // names none is still a component: its presence is the fact.
  let stored = (comp: string, patch: Comp): Comp => {
    let out: Comp = {}
    for (let p in patch) {
      if (vocab.prop(comp, p)?.computed === false) out[p] = patch[p]
    }
    return out
  }

  let read = (query: Query, opts: ReadOpts = {}): Bundle[] =>
    matcher(query, vocab, {
      now: opts.now ?? base.now,
      computed: base.computed,
    })(view())

  // The raw-rows path: one `{ eid }` per match, or an aggregate's rows in the
  // shape @yaks/sql returns, so a caller reads the same shape from either
  // storage.
  let raw = (query: Query, opts: ReadOpts = {}): Row[] =>
    answer(query, vocab, {
      now: opts.now ?? base.now,
      computed: base.computed,
    })(view())

  // The number an identity gets: the one it arrived with when this store
  // mirrors another graph (none until it is told), else the next one this
  // store has to give.
  let numbered = (num?: number | null): { num?: number | null } =>
    !base.adopt ? { num: next++ } : num === undefined ? {} : { num }

  let patch = (bundles: Bundle[]): Entity[] => {
    let born: Entity[] = []
    let excluded = new Set<string>()
    if (typeof base.number == 'object') {
      for (let name of base.number.except) {
        for (let b of bundles) {
          if (rows.get(b.entity.eid)?.[name] != null) {
            excluded.add(b.entity.eid)
          }
        }
        for (let b of bundles) if (b[name] != null) excluded.add(b.entity.eid)
      }
      for (let eid of excluded) {
        let rec = rows.get(eid)
        if (rec && rec.entity.num != null) {
          save(eid)
          put(eid, { ...rec, entity: { eid } })
        }
      }
    }
    // An eid a reference only names gets a record to hold the pointer and no
    // number, until a bundle of its own arrives (@yaks/sqlite `patch`): one
    // giving it a component, or, where the store mirrors another, one telling
    // it its number.
    let own = new Set(
      bundles.filter((b) =>
        !buried(rows.get(b.entity.eid)) &&
        (comps(b).some(([, c]) => c != null) ||
          base.adopt && b.entity.num !== undefined)
      ).map((b) => b.entity.eid),
    )
    let counts = (eid: Eid) => !!base.number && !excluded.has(eid)
    // Create a record for every eid this write touches or points at, so that a
    // reference may name a target created by the same write, in any order.
    let birth = (eid: Eid, num?: number | null) => {
      let rec = rows.get(eid)
      if (rec) {
        // A mirror is told a number it did not have yet: the server's answer
        // to an entity this store created, or reached only by reference.
        if (
          base.adopt && !excluded.has(eid) && num !== undefined &&
          rec.entity.num !== num
        ) {
          save(eid)
          put(eid, { ...rec, entity: { eid, num } })
        } else if (
          // A record an earlier reference made is numbered when a bundle of
          // its own arrives, if it still carries nothing: an unnumbered entity
          // that carries something was left unnumbered on purpose.
          !base.adopt && own.has(eid) && counts(eid) && !buried(rec) &&
          rec.entity.num == null && empty(rec)
        ) {
          save(eid)
          let entity = { ...rec.entity, ...numbered() }
          put(eid, { ...rec, entity })
          born.push(entity)
        }
        return
      }
      save(eid)
      let reserved = cold.get(eid)
      cold.delete(eid)
      let entity = reserved
        ? { ...reserved, ...(base.adopt ? numbered(num) : {}) }
        : { eid, ...own.has(eid) && counts(eid) ? numbered(num) : {} }
      put(eid, { entity })
      if (!reserved) born.push(entity)
    }
    for (let b of bundles) {
      if (buried(rows.get(b.entity.eid))) continue
      birth(b.entity.eid, b.entity.num)
      for (let [name, comp] of comps(b)) {
        for (let prop in comp) {
          let val = comp[prop]
          if (val != null && isRef(name, prop)) birth(String(val))
        }
      }
    }
    for (let b of bundles) {
      let eid = b.entity.eid
      let rec = rows.get(eid)
      let patches = comps(b)
      if (rec && b.entity.archetype !== undefined) {
        save(eid)
        let entity = { ...rec.entity, archetype: b.entity.archetype }
        put(eid, rec = { ...rec, entity })
      }
      if (!rec || buried(rec) || !patches.length) continue
      save(eid)
      let held: Bundle = { ...rec }
      for (let [name, comp] of patches) {
        // A null component drops the row; anything else merges in, so an
        // omitted property keeps what it held and a null one clears it.
        if (comp == null) delete held[name]
        else {
          let was = held[name] as Comp | undefined
          held[name] = { ...was, ...stored(name, comp) }
        }
      }
      put(eid, held)
    }
    return born
  }

  // The records themselves. A record is never mutated once stored, so the one a
  // read hands back is safe to keep, and costs no copy.
  let get = (eids: Eid[]): Bundle[] => {
    let out: Bundle[] = []
    for (let eid of eids) {
      let rec = rows.get(eid)
      if (rec) out.push(rec)
    }
    return out
  }

  let tx: Tx = {
    read,
    get,
    patch,
    evict: (eids) => {
      for (let eid of eids) {
        let rec = rows.get(eid)
        if (!rec || buried(rec)) continue
        save(eid)
        cold.set(eid, { eid, num: rec.entity.num })
        put(eid, undefined)
      }
    },
    remove: (entities) => {
      for (let { eid } of entities) {
        let entity = rows.get(eid)?.entity ?? cold.get(eid)
        if (!entity) continue
        save(eid)
        cold.delete(eid)
        put(eid, tombstoned(entity))
      }
    },
    revive: (eids) => {
      for (let eid of eids) {
        let rec = rows.get(eid)
        if (!rec || !buried(rec)) continue
        save(eid)
        put(eid, { entity: rec.entity })
      }
    },
  }

  return {
    install: () => {},
    read,
    rows: raw,
    get,
    tx: (body) => {
      // A nested transaction is a savepoint: it rolls back to where it opened,
      // and its entries stay in the log for the outer one to undo in its turn.
      let mark = log.length
      let minted = next
      depth++
      let undo = (e: unknown): never => {
        while (log.length > mark) {
          let [eid, rec, identity] = log.pop()!
          if (identity) cold.set(eid, identity)
          else cold.delete(eid)
          put(eid, rec)
        }
        next = minted
        depth--
        throw e
      }
      let done = <R>(out: R): R => {
        if (--depth == 0) log.length = 0
        return out
      }
      try {
        let out = body(tx)
        return (isPromise(out) ? out.then(done, undo) : done(out)) as typeof out
      } catch (e) {
        return undo(e)
      }
    },
  }
}
