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
// because it was never written to. It can wait like that because the writes
// themselves ask nothing: @yaks/sqlite builds every one as a self-sufficient
// statement (an owner id is a subquery, never a value looked up first), and this
// package gathers those same statements rather than keeping a write path of its
// own.
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
// detected nowhere, not a half-written batch; atomicity holds regardless.
//
// MINTING IS NOT A READ. An identity's `num` is SQLite's to pick, at the moment
// the insert runs and so inside the batch's own transaction — exact under a
// concurrent writer, and nothing has to ask for a high-water mark first. The
// price is that a number is not known until the batch lands: `patch` reports
// each minted entity without one and `flush` fills it in from that insert's own
// RETURNING. Nothing can observe it in between, because nothing outside sees
// the entity until `tx()` settles, which is after the flush.
//
// A nested `tx()` is a separate batch, since D1 has no savepoints. Nothing in
// `apply()` nests one.

import type {
  Bundle,
  Comp,
  Doom,
  Eid,
  Entity,
  Gone,
  Loose,
  Tx,
} from '@yaks/graph'
import { comps, tombstoned } from '@yaks/graph'
import { matcher } from '@yaks/match'
import { type BindOpts, DEEP, doomSql, looseSql, narrow } from '@yaks/sql'
import {
  minted,
  mintSql,
  patchSql,
  removeSql,
  schema,
  touched,
} from '@yaks/sqlite'
import type { Vocab } from '@yaks/vocab'
import {
  bind,
  type D1Like,
  type Row,
  type Sql,
  type Stmt,
  unbind,
} from './d1.ts'
import { bundles, gatherSql, type Query, sql, whole, wholeSql } from './read.ts'

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
// The components bearing a reference whose death word means something — a
// patch touching one of these is a patch the death cascade would have to read,
// and the database has not seen it yet.
let deadly = (v: Vocab): Set<string> =>
  new Set(
    (['cascade', 'detach', 'release'] as const)
      .flatMap((word) => v.deaths(word).map(([comp]) => comp)),
  )

export let storage = <S extends Stmt<S>>(
  db: D1Like<S>,
  vocab: Vocab,
  base: BindOpts = {},
): Store => {
  let bears = deadly(vocab)
  // `bind` at the door, so a statement may be built in the plain SQLite values
  // @yaks/sqlite's shared write path speaks (a bigint, a byte array) and D1's
  // narrower type table is met in exactly one place.
  let prep = (s: Sql): S => db.prepare(s.sql).bind(...s.params.map(bind))

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

  // The same answer as `read` in ONE trip, for a query that names a set: the
  // query and the gather of what it hits go as one batch, each statement
  // naming the hit set as a subquery rather than binding eids a first trip
  // went and found. What @yaks/graph's backwards reads ask for — see
  // ./read.ts `wholeSql` for why it is not what `read` does.
  let seek = async (query: Query, opts: BindOpts = {}): Promise<Bundle[]> => {
    let o = { ...base, ...opts }
    return whole(vocab, await send(wholeSql(vocab, sql(vocab, query, o), o)))
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
    // The identities this transaction mints, each paired with the position of
    // its insert in `pending` — that statement's RETURNING is where its number
    // comes from once the batch lands.
    let births: { at: number; entity: Entity }[] = []
    // Whether this transaction has written something the database cannot see
    // that the death cascade would have to read: a patch touching a component
    // that bears a death column, or a removal. Until it has, the rows the
    // database holds ARE the rows the batch leaves behind, and the cascade's
    // question is one statement; once it has, that statement would be
    // answering about rows that have moved, so the question is declined and
    // @yaks/graph walks it through the overlay instead.
    let moved = false

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

    // Mint an identity for an eid that has none, so a reference may name a
    // target created in the same batch, in any order. NOTHING IS ASKED: the
    // number is SQLite's to pick when the insert runs, inside the batch's own
    // transaction, and the statement returns it. So the entity handed out here
    // wears no `num` yet — `flush` fills it into this very object, before the
    // transaction settles and before anything outside can read it.
    let birth = (eid: Eid, born: Entity[]): void => {
      if (known.get(eid)) return
      let entity: Entity = { eid }
      births.push({ at: pending.length, entity })
      pending.push(mintSql(eid))
      known.set(eid, { dead: false })
      dirty.set(eid, { entity })
      born.push(entity)
    }

    // Send the gathered writes, then read each mint's own RETURNING back out of
    // the batch and fill in the number it handed out.
    let flush = async (): Promise<void> => {
      let out = await send(pending)
      for (let b of births) {
        let e = minted(out[b.at] ?? [])
        if (e) b.entity.num = e.num
      }
    }

    // The committed answer with this transaction's own entities taken out,
    // then those re-judged against the same query in their pending state.
    let overlaid = (query: Query, now: number | undefined, all: Bundle[]) => {
      if (!dirty.size) return all
      let mine = matcher(query, vocab, { now: now ?? base.now })(
        [...dirty.values()].filter((b) => b.tombstone == null),
      )
      return [...all.filter((b) => !dirty.has(b.entity.eid)), ...mine]
    }

    // Who dies with these entities, and what has to let go of them: the
    // recursive closure over the cascade columns and the soft references into
    // it (@yaks/sql), sent as ONE batch where the walk they replace cost a read
    // per rung and another per frontier. The casualties' identities are kept as
    // they come back, so `remove`, which is the next thing that happens to
    // them, asks nothing more.
    //
    // A vocabulary too wide for one statement (workerd caps a compound SELECT
    // at five terms) is asked in ROUNDS, each still one batch: the arms are cut
    // into statements, so a round is complete only when it turns up nothing the
    // last one had not. The soft references ride every round bound to what was
    // known when it began — which is the whole of the dead exactly when the
    // round proves it, so the last round's answer is the one kept.
    let doom = async (eids: Eid[]): Promise<Doom | null> => {
      if (moved) return null
      let depth = new Map<Eid, number>()
      let gone: Gone[] = []
      let loose: Loose[] = []
      let seed = eids
      let dead = eids
      let base = 0
      for (;;) {
        let dying = doomSql(vocab, seed)
        let letting = looseSql(vocab, dead)
        let out = await send([...dying, ...letting])
        let fresh: Eid[] = []
        let least = DEEP
        for (let rows of out.slice(0, dying.length)) {
          for (let r of rows) {
            let eid = String(r.eid)
            if (depth.has(eid)) continue
            if (!known.has(eid)) {
              known.set(eid, {
                ...(r.num == null ? {} : { num: Number(r.num) }),
                dead: false,
              })
            }
            let rung = base + Number(r.depth)
            depth.set(eid, rung)
            gone.push({ eid, depth: rung })
            fresh.push(eid)
            least = Math.min(least, rung)
          }
        }
        loose = out.slice(dying.length).flatMap((rows) =>
          rows.map((r) => ({
            eid: String(r.eid),
            comp: String(r.comp),
            prop: String(r.prop),
          }))
        )
        if (narrow(vocab) || !fresh.length) break
        seed = fresh
        dead = [...depth.keys()]
        base = least
      }
      return { gone, loose }
    }

    let tx: Tx = {
      read: async (query, opts) =>
        overlaid(
          query as Query,
          opts?.now,
          await read(query as Query, { ...base, ...opts }),
        ),
      whole: async (query, opts) =>
        overlaid(
          query as Query,
          opts?.now,
          await seek(query as Query, { ...base, ...opts }),
        ),
      get: async (eids) => {
        await learn(eids)
        return eids.flatMap((e) => {
          let b = at(e)
          return b ? [b] : []
        })
      },
      doom,
      patch: async (bs) => {
        moved ||= bs.some((b) => comps(b).some(([name]) => bears.has(name)))
        await learn(touched(vocab, bs))
        let born: Entity[] = []
        // `touched` puts the bundle's own eid first, then what it points at, so
        // numbers land in the same first-touch order every adapter uses.
        for (let b of bs) {
          if (buried(b.entity.eid)) continue
          for (let e of touched(vocab, [b])) birth(e, born)
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
        // A tombstoned row is a row the database has not seen go, so nothing
        // after this may ask it who dies.
        moved = true
        // The cascade names casualties this transaction never read — an entity
        // that existed only because something else did. Learn the ones nothing
        // has identified yet, so the overlay knows their identity and a later
        // read sees them as dead; `doom` has usually named them already.
        await learn(entities.map((e) => e.eid))
        let now = new Date().toISOString()
        for (let e of entities) {
          let spine = known.get(e.eid)
          if (!spine) continue
          pending.push(...removeSql(vocab, e, now))
          known.set(e.eid, { ...spine, dead: true })
          // Its identity as this transaction knows it: the bundle when one was
          // read, else the spine `doom` or `learn` named — a tombstone still
          // carries the number the entity was given.
          let entity = at(e.eid)?.entity ??
            { eid: e.eid, ...(spine.num == null ? {} : { num: spine.num }) }
          dirty.set(e.eid, tombstoned(entity))
        }
      },
    }

    return { tx, flush }
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
