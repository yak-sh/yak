// A graph in a Map. This is @yaks/graph's `Storage` with nothing underneath it
// — one record per entity, keyed by eid, held in a plain Map — so a graph can
// run in a page, in a worker, or in a test with no database to install, no
// driver to bind, and no promise to await.
//
// Reads go through @yaks/match: the same query string @yaks/sql compiles into a
// SQL statement is evaluated here as a predicate over the bundles the map
// holds. That is the whole read side; this file only has to pass the candidate
// set to the matcher.
//
// Writes follow the patch rules every adapter implements — omitted properties
// untouched, a null property cleared, a null component dropped, a tombstoned
// entity taking no patch — and identity belongs to storage: `patch` creates a
// record for every eid the write touches or points at, numbers each new one in
// the order it was first touched, and returns what it created.
//
// A record is never mutated in place: a patch builds the next record and puts
// it in the map. That is what makes rolling back cheap — an undo log of one
// reference per entity a transaction touched, replayed backwards, restores the
// map exactly as it was without copying anything the write did not touch.

import type { Bundle, Comp, Eid, Entity, ReadOpts, Row } from '@yaks/graph'
import { comps, isPromise, tombstoned } from '@yaks/graph'
import { matcher, type Query } from '@yaks/match'
import { and, parse } from '@yaks/query'
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
   * Tombstones remain permanent; eviction is never deletion. */
  evict: (eids: Eid[]) => void
  /** remove these entities: their components go, their identity is tombstoned */
  remove: (entities: Entity[]) => void
}

/**
 * A bound store: @yaks/graph's `Storage`, implemented synchronously. It has
 * the same five members a database adapter has, so it satisfies `Storage`
 * wherever one is wanted — and a caller using a `Store` directly never awaits
 * a row.
 */
export type Store = {
  /** no schema to state: a map needs none */
  ddl: () => string[]
  /** nothing to create either — installing a map is a no-op */
  install: () => void
  /** a query → the matching entities as whole bundles */
  read: (query: Query, opts?: ReadOpts) => Bundle[]
  /** a query → one raw `{ eid }` row per match (aggregates are not supported) */
  rows: (query: Query, opts?: ReadOpts) => Row[]
  /** run `body` in a transaction: commit on return, roll back on throw */
  tx: <R>(body: (tx: Tx) => R) => R
}

// One entity as the map holds it: its identity, the components it has, and
// whether it has been deleted. A deleted record keeps its identity forever (the
// id can never be reused) and nothing else.
type Rec = { entity: Entity; comps: Record<string, Comp>; dead?: boolean }

let bundleOf = (r: Rec): Bundle =>
  r.dead ? tombstoned(r.entity) : { entity: r.entity, ...r.comps }

/**
 * A store over a Map of bundles, bound to a vocabulary once. It is the storage
 * a client graph and a fast test run on:
 *
 * ```ts
 * import { graph } from '@yaks/graph'
 * import { ram } from '@yaks/ram'
 *
 * let g = graph({ storage: ram(vocab), vocab })
 * g.apply([{ entity: { eid: 'b1' }, doc: { title: 'Dune' } }])
 * g.read('.kind=doc')
 * ```
 */
export let ram = (vocab: Vocab, base: RamOpts = {}): Store => {
  let rows = new Map<Eid, Rec>()
  // Compact identity reservations survive payload eviction. They are not query rows.
  let cold = new Map<Eid, Entity>()
  let next = 1
  // The undo log: for each entity a transaction is about to change, the record
  // it held first. Replayed backwards, it is the rollback.
  let log: [Eid, Rec | undefined, Entity | undefined][] = []
  let depth = 0
  let save = (eid: Eid) => log.push([eid, rows.get(eid), cold.get(eid)])

  let isRef = (comp: string, prop: string) =>
    vocab.prop(comp, prop)?.category == 'ref'

  // The properties of a patch this vocabulary stores. A component whose patch
  // names none is still a component: its presence is the fact.
  let stored = (comp: string, patch: Comp): Comp =>
    Object.fromEntries(
      Object.entries(patch).filter(([p]) =>
        vocab.prop(comp, p)?.computed === false
      ),
    )

  let all = (): Bundle[] => [...rows.values()].map(bundleOf)

  let read = (query: Query, opts: ReadOpts = {}): Bundle[] =>
    matcher(query, vocab, { now: opts.now ?? base.now })(all())

  // The raw-rows path: one `{ eid }` per match, or for `.count!` the one
  // `{ value: '', n }` row @yaks/sql returns, so a caller counting a set reads
  // the same shape from either storage. Match declines aggregates, so the count
  // clause is lifted out and the rest of the query selects what to count.
  let raw = (query: Query, opts?: ReadOpts): Row[] => {
    let cs = (typeof query == 'string' ? parse(query) : query).clauses
    if (!cs.some((c) => c.kind == 'count')) {
      return read(query, opts).map((b) => ({ eid: b.entity.eid }))
    }
    let rest = and(...cs.filter((c) => c.kind != 'count'))
    return [{ value: '', n: read(rest, opts).length }]
  }

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
          if (rows.get(b.entity.eid)?.comps[name] != null) {
            excluded.add(b.entity.eid)
          }
        }
        for (let b of bundles) if (b[name] != null) excluded.add(b.entity.eid)
      }
      for (let eid of excluded) {
        let rec = rows.get(eid)
        if (rec && rec.entity.num != null) {
          save(eid)
          rows.set(eid, { ...rec, entity: { eid } })
        }
      }
    }
    // An eid a reference only names gets a record to hold the pointer and no
    // number, until a bundle of its own arrives (@yaks/sqlite `patch`): one
    // giving it a component, or, where the store mirrors another, one telling
    // it its number.
    let own = new Set(
      bundles.filter((b) =>
        !rows.get(b.entity.eid)?.dead &&
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
          rows.set(eid, { ...rec, entity: { eid, num } })
        } else if (
          // A record an earlier reference made is numbered when a bundle of
          // its own arrives, if it still carries nothing: an unnumbered entity
          // that carries something was left unnumbered on purpose.
          !base.adopt && own.has(eid) && counts(eid) && !rec.dead &&
          rec.entity.num == null && !Object.keys(rec.comps).length
        ) {
          save(eid)
          let entity = { ...rec.entity, ...numbered() }
          rows.set(eid, { ...rec, entity })
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
      rows.set(eid, { entity, comps: {} })
      if (!reserved) born.push(entity)
    }
    for (let b of bundles) {
      if (rows.get(b.entity.eid)?.dead) continue
      birth(b.entity.eid, b.entity.num)
      for (let [name, comp] of comps(b)) {
        for (let [prop, val] of Object.entries(comp ?? {})) {
          if (val != null && isRef(name, prop)) birth(String(val))
        }
      }
    }
    for (let b of bundles) {
      let rec = rows.get(b.entity.eid)
      let patches = comps(b)
      if (rec && b.entity.archetype !== undefined) {
        save(b.entity.eid)
        rec = {
          ...rec,
          entity: { ...rec.entity, archetype: b.entity.archetype },
        }
        rows.set(b.entity.eid, rec)
      }
      if (!rec || rec.dead || !patches.length) continue
      save(b.entity.eid)
      let held: Record<string, Comp> = { ...rec.comps }
      for (let [name, comp] of patches) {
        // A null component drops the row; anything else merges in, so an
        // omitted property keeps what it held and a null one clears it.
        if (comp == null) delete held[name]
        else held[name] = { ...(held[name] ?? {}), ...stored(name, comp) }
      }
      rows.set(b.entity.eid, { ...rec, comps: held })
    }
    return born
  }

  let tx: Tx = {
    read,
    get: (eids) =>
      eids.flatMap((eid) => {
        let rec = rows.get(eid)
        return rec ? [bundleOf(rec)] : []
      }),
    patch,
    evict: (eids) => {
      for (let eid of eids) {
        let rec = rows.get(eid)
        if (!rec || rec.dead) continue
        save(eid)
        cold.set(eid, { eid, num: rec.entity.num })
        rows.delete(eid)
      }
    },
    remove: (entities) => {
      for (let { eid } of entities) {
        let entity = rows.get(eid)?.entity ?? cold.get(eid)
        if (!entity) continue
        save(eid)
        cold.delete(eid)
        rows.set(eid, { entity, comps: {}, dead: true })
      }
    },
  }

  return {
    ddl: () => [],
    install: () => {},
    read,
    rows: raw,
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
          if (rec) rows.set(eid, rec)
          else rows.delete(eid)
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
