// A graph in a Map. This is @yaks/graph's `Storage` with nothing underneath it
// — one record per entity, keyed by eid, held in a plain Map — so a graph can
// run in a page, in a worker, or in a test with no database to install, no
// driver to bind, and no promise to await.
//
// Reads go through @yaks/match: the same query line @yaks/sql compiles into a
// statement is evaluated here as a predicate over the bundles the map holds.
// That is the whole read half; this file only has to hand match the set.
//
// Writes are the patch rules every adapter honors — omitted columns untouched,
// a null column cleared, a null component dropped, a tombstoned entity taking
// no patch — and identity is storage's: `patch` mints a record for every eid
// the batch touches OR points at, numbers each new one in first-touch order,
// and reports what it minted.
//
// A record is never mutated in place: a patch builds the next record and puts
// it in the map. That is what makes rolling back cheap — an undo log of one
// reference per entity a transaction touched, replayed backwards, restores the
// map exactly as it was without copying anything the batch did not write.

import type { Bundle, Comp, Eid, Entity, ReadOpts, Row } from '@yaks/graph'
import { comps, isPromise, tombstoned } from '@yaks/graph'
import { matcher, type Query } from '@yaks/match'
import type { Vocab } from '@yaks/vocab'

export type { Query }

/** What rides every read of a store: the moment relative time phrases in a
 * query (`.released=today`) resolve against. A per-call `opts` wins over it. */
export type MemoryOpts = {
  /** the reference moment for time phrases (default: the read's own `now`) */
  now?: number
  /** adopt the `num` a patch's identity carries instead of minting one. What a
   * store MIRRORING another graph needs — a client applying the batch a server
   * answered with is being told the identity, not asking for one. Off by
   * default: a store nobody mirrors owns its own numbering. */
  adopt?: boolean
}

/**
 * A transaction over the map: @yaks/graph's `Tx`, answered immediately. The
 * store commits when the body returns and rolls back when it throws, so a
 * refused batch leaves the map exactly as it found it.
 */
export type Tx = {
  /** a query → the matching entities as whole bundles */
  read: (query: Query, opts?: ReadOpts) => Bundle[]
  /** identity, not search: these entities as they stand, whole. A dead one
   * wears `tombstone`; an unknown one is simply absent. */
  get: (eids: Eid[]) => Bundle[]
  /** patch the bundles in → the entities this patch MINTED, with their `num` */
  patch: (bundles: Bundle[]) => Entity[]
  /** remove these entities: their components go, their identity is tombstoned */
  remove: (entities: Entity[]) => void
}

/**
 * A bound store: @yaks/graph's `Storage`, answered synchronously. The
 * same five members a database adapter has, so it satisfies `Storage` wherever
 * one is wanted — and a caller holding a `Store` directly never awaits a row.
 */
export type Store = {
  /** no schema to state: a map needs none */
  ddl: () => string[]
  /** nothing to create either — installing a map is a no-op */
  install: () => void
  /** a query → the matching entities as whole bundles */
  read: (query: Query, opts?: ReadOpts) => Bundle[]
  /** a query → one raw `{ eid }` row per match (aggregates are declined) */
  rows: (query: Query, opts?: ReadOpts) => Row[]
  /** run `body` in a transaction: commit on return, roll back on throw */
  tx: <R>(body: (tx: Tx) => R) => R
}

// One entity as the map holds it: its identity, the components it wears, and
// whether it is in the grave. A dead record keeps its identity forever (the id
// can never be reused) and nothing else.
type Rec = { entity: Entity; comps: Record<string, Comp>; dead?: boolean }

let bundleOf = (r: Rec): Bundle =>
  r.dead ? tombstoned(r.entity) : { entity: r.entity, ...r.comps }

/**
 * A store over a Map of bundles, bound to a vocabulary once. It is the storage
 * a client graph and a fast test run on:
 *
 * ```ts
 * import { graph } from '@yaks/graph'
 * import { memory } from '@yaks/memory'
 *
 * let g = graph({ storage: memory(vocab), vocab })
 * g.apply([{ entity: { eid: 'b1' }, doc: { title: 'Dune' } }])
 * g.read('.kind=doc')
 * ```
 */
export let memory = (vocab: Vocab, base: MemoryOpts = {}): Store => {
  let rows = new Map<Eid, Rec>()
  let next = 1
  // The undo log: for each entity a transaction is about to change, the record
  // it held first. Replayed backwards, it is the rollback.
  let log: [Eid, Rec | undefined][] = []
  let depth = 0
  let save = (eid: Eid) => log.push([eid, rows.get(eid)])

  let isRef = (comp: string, prop: string) =>
    vocab.column(comp, prop)?.category == 'ref'

  // The columns of a patch this vocabulary stores. A component whose patch
  // names none is still a component: its presence is the fact.
  let stored = (comp: string, patch: Comp): Comp =>
    Object.fromEntries(
      Object.entries(patch).filter(([p]) => vocab.column(comp, p)?.persist),
    )

  let all = (): Bundle[] => [...rows.values()].map(bundleOf)

  let read = (query: Query, opts: ReadOpts = {}): Bundle[] =>
    matcher(query, vocab, { now: opts.now ?? base.now })(all())

  // The number an identity gets: the one it arrived with when this store
  // mirrors another graph, else the next one this store has to give.
  let numberFor = (num?: number) => {
    if (!base.adopt || num == null) return next++
    if (num >= next) next = num + 1 // a locally minted one must not collide
    return num
  }

  let patch = (bundles: Bundle[]): Entity[] => {
    let born: Entity[] = []
    // Mint a record for every eid this batch touches or points at, so a
    // reference may name a target created in the same batch, in any order.
    let birth = (eid: Eid, num?: number) => {
      let rec = rows.get(eid)
      if (rec) {
        // A mirror adopts a correction: this store guessed a number for an
        // entity it created optimistically, and is now being told the real one.
        if (base.adopt && num != null && rec.entity.num != num) {
          save(eid)
          rows.set(eid, { ...rec, entity: { eid, num: numberFor(num) } })
        }
        return
      }
      save(eid)
      let entity = { eid, num: numberFor(num) }
      rows.set(eid, { entity, comps: {} })
      born.push(entity)
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
      if (!rec || rec.dead || !patches.length) continue
      save(b.entity.eid)
      let held: Record<string, Comp> = { ...rec.comps }
      for (let [name, comp] of patches) {
        // A null component drops the row; anything else merges in, so an
        // omitted column keeps what it held and a null one clears it.
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
    remove: (entities) => {
      for (let { eid } of entities) {
        let rec = rows.get(eid)
        if (!rec) continue
        save(eid)
        rows.set(eid, { entity: rec.entity, comps: {}, dead: true })
      }
    },
  }

  return {
    ddl: () => [],
    install: () => {},
    read,
    rows: (query, opts) =>
      read(query, opts).map((b) => ({ eid: b.entity.eid })),
    tx: (body) => {
      // A nested transaction is a savepoint: it rolls back to where it opened,
      // and its entries stay in the log for the outer one to undo in its turn.
      let mark = log.length
      let minted = next
      depth++
      let undo = (e: unknown): never => {
        while (log.length > mark) {
          let [eid, rec] = log.pop()!
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
