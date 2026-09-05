// The store, bound: @yaks/graph's `Storage` over a D1 binding. Reads and DDL
// are ordinary; the transaction is where D1's shape has to be faced squarely,
// so what it does and does not promise is written out here rather than implied.
//
// WHAT D1 GIVES. `batch()` runs a list of statements sequentially inside one
// implicit transaction and rolls the whole list back if any of them fails.
// That is a true atomic write. What D1 does NOT give is an INTERACTIVE
// transaction: there is no call that opens a transaction, lets your code read,
// decide, and write inside it, and commits at the end. Nothing holds a lock
// while you think.
//
// WHAT `tx()` DOES ABOUT IT. A transaction here is deferred-write:
//
//   reads run immediately, against the committed database;
//   writes are gathered as statements, not sent;
//   returning flushes the gathered statements as ONE `batch()` — atomic;
//   throwing discards them — nothing was ever sent.
//
// So the WRITE half is genuinely all-or-nothing, and a refused batch (a failing
// `$was` guard, a hook that says no at commit) leaves the database untouched
// because it was never written to.
//
// READ-YOUR-OWN-WRITES, which `apply()` needs — the death cascade reads who
// points at a dying entity AFTER the batch's own patches — is answered from an
// OVERLAY rather than from the database: every entity this transaction wrote is
// kept in memory as it will be once the batch lands, and a read inside the
// transaction is the committed answer with those entities replaced by their
// pending state (evaluated with @yaks/match, the same query grammar the
// database answers). Untouched entities are never routed through the overlay,
// so a transaction that has not written yet reads exactly as the database does.
//
// WHAT IS NOT PROMISED, precisely. The reads are not part of the write's
// transaction, because D1 has nowhere to put them. Between a read and the flush
// another writer may move what was read: this is read-committed with an atomic
// write batch, NOT serializable isolation. A guard that must not lose a race —
// `$was` — is therefore best-effort against a concurrent writer here, where it
// is exact over @yaks/sqlite. The failure it cannot prevent is a lost update
// detected nowhere, not a half-written batch; atomicity holds regardless. Two
// writers minting entities at the same instant collide on `entity.num`'s unique
// index and the whole batch is refused rather than half-applied — retry.
//
// A nested `tx()` is a separate batch, since D1 has no savepoints. Nothing in
// `apply()` nests one.

import type { Bundle, Comp, Eid, Entity, Tx } from '@yaks/graph'
import { comps, tombstoned } from '@yaks/graph'
import { matcher } from '@yaks/match'
import type { BindOpts } from '@yaks/sql'
import { schema } from '@yaks/sqlite'
import type { Vocab } from '@yaks/vocab'
import { type D1Like, type Row, type Sql, type Stmt, unbind } from './d1.ts'
import { bundles, gatherSql, type Query, sql } from './read.ts'
import { mint, patch as patchSql, remove as removeSql } from './write.ts'

export type { Query }

/**
 * A bound store: @yaks/graph's `Storage` over D1, every answer a promise.
 *
 * `tx` is declared as the seam declares it — the seam is async-or-sync and a
 * synchronous adapter returns a plain value — but over D1 it ALWAYS returns a
 * promise, and it resolves only once the write batch has committed.
 */
export type Store = {
  /** the schema statements the bound vocabulary implies */
  ddl: () => string[]
  /** run them — create the tables, indexes and triggers the vocabulary needs */
  install: () => Promise<void>
  /** a query → the matching entities as whole bundles */
  read: (query: Query, opts?: BindOpts) => Promise<Bundle[]>
  /** a query → the compiled statement's raw rows (counts, tallies) */
  rows: (query: Query, opts?: BindOpts) => Promise<Row[]>
  /** run `body` against a transaction: flush its writes as one atomic batch on
   * return, discard them on throw */
  tx: <R>(body: (tx: Tx) => R) => Promise<Awaited<R>>
}

// The identity of an eid as the database holds it, or `null` for an eid no
// entity wears. Cached per transaction so one gather answers every question.
type Spine = { num?: number; dead: boolean } | null

// A patch merged onto the bundle it patches: a null component drops the row,
// anything else merges in, so an omitted column keeps what it held and a null
// one clears it. This is the overlay's copy of the same rule ./write.ts states
// in SQL — it is what a read inside the transaction has to see.
let merged = (v: Vocab, held: Bundle, b: Bundle): Bundle => {
  let out: Bundle = { ...held }
  for (let [name, comp] of comps(b)) {
    if (comp == null) {
      delete out[name]
      continue
    }
    let kept = Object.entries(comp)
      .filter(([p]) => v.column(name, p)?.persist)
    out[name] = {
      ...(out[name] as Comp | undefined ?? {}),
      ...Object.fromEntries(kept),
    }
  }
  return out
}

/**
 * Bind a store to a D1 binding and a vocabulary — the `Storage` a
 * {@link https://jsr.io/@yaks/graph | @yaks/graph} applies changes to.
 *
 * `base` options (a derived-column registry, an @yaks/sql extension, a fixed
 * `now` for time phrases) ride every read; a per-call `opts` merges over them.
 *
 * ```ts
 * // let store = storage(env.DB, vocab)
 * // await store.install()
 * // let g = graph({ storage: store, vocab })
 * // await g.apply([{ entity: { eid: 'b1' }, doc: { title: 'Dune' } }])
 * ```
 */
export let storage = <S extends Stmt<S>>(
  db: D1Like<S>,
  vocab: Vocab,
  base: BindOpts = {},
): Store => {
  let prep = (s: Sql): S => db.prepare(s.sql).bind(...s.params)

  // One statement, one round trip.
  let one = async (s: Sql): Promise<Row[]> =>
    (await prep(s).all<Row>()).results.map(unbind)

  // Many statements, still one round trip — and, when they are writes, one
  // transaction. The answers come back per statement, in order.
  let send = async (stmts: Sql[]): Promise<Row[][]> =>
    stmts.length
      ? (await db.batch(stmts.map(prep))).map((r) => r.results.map(unbind))
      : []

  let rows = (query: Query, opts: BindOpts = {}): Promise<Row[]> =>
    one(sql(vocab, query, { ...base, ...opts }))

  // Every named entity, whole, in one batch: the gather asks each entity's
  // spine and each of its components as separate statements and reads the
  // answers back in the order it asked.
  let gather = async (
    eids: Eid[],
    opts: BindOpts = {},
  ): Promise<Bundle[]> =>
    eids.length
      ? bundles(
        vocab,
        eids,
        await send(eids.flatMap((e) => gatherSql(vocab, e, opts))),
      )
      : []

  let read = async (
    query: Query,
    opts: BindOpts = {},
  ): Promise<Bundle[]> => {
    let hits = await rows(query, opts)
    return gather(
      hits.filter((r) => r.eid != null).map((r) => String(r.eid)),
      { ...base, ...opts },
    )
  }

  // One transaction: the deferred write log, the read cache, and the overlay of
  // what this transaction has written. See the header for what that buys.
  let open = () => {
    let pending: Sql[] = []
    // Entities this transaction WROTE, as they will be once the batch lands.
    let dirty = new Map<Eid, Bundle>()
    // Entities it merely READ, faithful to the database. Kept apart from the
    // overlay so a read that changed nothing never routes a query through
    // @yaks/match.
    let held = new Map<Eid, Bundle>()
    let known = new Map<Eid, Spine>()
    let high: number | undefined

    // Learn about these eids, asking the database only about the ones no
    // question has covered yet.
    let learn = async (eids: Eid[]): Promise<void> => {
      let ask = [...new Set(eids)].filter((e) => !known.has(e))
      if (!ask.length) return
      let found = await gather(ask, base)
      for (let b of found) {
        held.set(b.entity.eid, b)
        known.set(b.entity.eid, {
          num: b.entity.num,
          dead: b.tombstone != null,
        })
      }
      for (let e of ask) if (!known.has(e)) known.set(e, null)
    }

    let at = (eid: Eid): Bundle | undefined => dirty.get(eid) ?? held.get(eid)

    let buried = (eid: Eid): boolean => known.get(eid)?.dead == true

    // The next number to hand out, read once per transaction. A batch that is
    // refused never flushes, so the numbers it reserved are handed out again.
    let next = async (): Promise<number> => {
      if (high == null) {
        let [row] = await one({
          sql: 'select coalesce(max(num), 0) as n from entity',
          params: [],
        })
        high = Number(row?.n ?? 0)
      }
      return ++high
    }

    // Mint an identity for an eid that has none, so a reference may name a
    // target created in the same batch, in any order.
    let birth = async (eid: Eid, born: Entity[]): Promise<void> => {
      if (known.get(eid)) return
      let entity: Entity = { eid, num: await next() }
      pending.push(mint(eid, entity.num!))
      known.set(eid, { num: entity.num, dead: false })
      dirty.set(eid, { entity })
      born.push(entity)
    }

    // Every eid a batch of bundles touches or points at.
    let named = (bs: Bundle[]): Eid[] =>
      bs.flatMap((b) => [
        b.entity.eid,
        ...comps(b).flatMap(([name, comp]) =>
          Object.entries(comp ?? {})
            .filter(([p, val]) =>
              val != null && vocab.column(name, p)?.category == 'ref'
            )
            .map(([, val]) => String(val))
        ),
      ])

    let tx: Tx = {
      read: async (query, opts) => {
        let all = await read(query as Query, { ...base, ...opts })
        if (!dirty.size) return all
        // The committed answer with this transaction's own entities taken out,
        // then those re-judged against the same query in their pending state.
        let mine = matcher(query as Query, vocab, {
          now: opts?.now ?? base.now,
        })([...dirty.values()].filter((b) => b.tombstone == null))
        return [...all.filter((b) => !dirty.has(b.entity.eid)), ...mine]
      },
      get: async (eids) => {
        await learn(eids)
        return eids.flatMap((e) => {
          let b = at(e)
          return b ? [b] : []
        })
      },
      patch: async (bs) => {
        await learn(named(bs))
        let born: Entity[] = []
        for (let b of bs) {
          if (buried(b.entity.eid)) continue
          await birth(b.entity.eid, born)
          for (let e of named([b])) await birth(e, born)
        }
        for (let b of bs) {
          let eid = b.entity.eid
          if (buried(eid) || !comps(b).length) continue
          pending.push(...patchSql(vocab, b))
          dirty.set(eid, merged(vocab, at(eid) ?? { entity: { eid } }, b))
        }
        return born
      },
      remove: async (entities) => {
        // The cascade names casualties this transaction never read — an entity
        // that existed only because something else did. Learn them, so the
        // overlay knows their identity and a later read sees them as dead.
        await learn(entities.map((e) => e.eid))
        let now = new Date().toISOString()
        for (let e of entities) {
          let spine = known.get(e.eid)
          if (!spine) continue
          pending.push(...removeSql(vocab, e, now))
          known.set(e.eid, { ...spine, dead: true })
          dirty.set(e.eid, tombstoned(at(e.eid)?.entity ?? e))
        }
      },
    }

    return { tx, flush: () => send(pending) }
  }

  let run = async <R>(body: (tx: Tx) => R): Promise<Awaited<R>> => {
    let { tx, flush } = open()
    let out = await body(tx)
    await flush()
    return out
  }

  return {
    ddl: () => schema(vocab),
    install: async () => {
      await send(schema(vocab).map((s) => ({ sql: s, params: [] })))
    },
    read,
    rows,
    tx: run,
  }
}
