// The feed: every commit, for the other hosts that opened the same store.
//
// A graph's `effect` phase shows it only its own commits. Anything else that
// opened the same store — a `yak` command beside `yak serve`, a worker serving
// the effects role — commits where this graph cannot see. So each commit
// writes one row to `journal_feed`, inside its own transaction: the host that
// made it and what it wrote, the names of the components and properties of
// each entity and no values. A follower pages through the rows from a cursor,
// keeps the ones another host wrote, and reads their values where the graph
// keeps them (`filled`); what this host wrote, its own graph already saw.
//
// The feed is plumbing, not history. The journal keeps what the vocabulary
// says is history and leaves out what it declares `journal: false`; the feed
// carries every commit, so a lease another process renews reaches a
// subscription here the way a task's new title does. A row is kept for
// {@link KEEP} and then pruned by a later write, so the table holds minutes of
// commits and does not grow with them.
//
// Nothing here arms a timer. The follower is a value that answers "what is new
// since last time"; the loop that asks it lives where a process keeps its
// timers (./graph.ts `feed`).

import { after, isPromise } from '@yaks/fp'
import type { Bundle, Plugin } from '@yaks/graph'
import { composed, comps, dead } from '@yaks/graph/bundle'
import {
  as,
  col,
  desc,
  eq,
  ge,
  gt,
  iff,
  lit,
  lt,
  type Row,
  select,
  type Stmt,
  sub,
  table,
  val,
} from '@yaks/sql'
import type { Rows } from './log.ts'

let FEED = 'journal_feed'

/** How long a commit stays in the feed, in ms: far longer than a follower
 * that is still running ever falls behind. */
export let KEEP = 10 * 60_000

/** The feed's table, which a writing host adds with the rest of its composed
 * schema (./graph.ts `schema`). Its id is the cursor. */
export let feedDdl = (): Stmt[] => [{
  t: 'create table',
  name: FEED,
  ifNot: true,
  cols: [
    { name: 'id', type: 'integer', pk: true },
    { name: 'at', type: 'integer', notNull: true },
    { name: 'host', type: 'text', notNull: true },
    { name: 'applied', type: 'text', notNull: true },
  ],
}]

/**
 * What a commit wrote to one entity, as the feed keeps it: the properties it
 * wrote of each component, `null` for a component it removed, or `$delete`
 * where the entity went. The values stay where the graph keeps them, and a
 * follower reads them there ({@link filled}).
 */
export type Wrote = {
  entity: Bundle['entity']
  $delete?: true
  [comp: string]: string[] | null | true | Bundle['entity'] | undefined
}

/**
 * A commit as the feed keeps it: one {@link Wrote} per entity.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 *
 * assertEquals(
 *   wrote([
 *     { entity: { eid: 'p1' }, page: { title: 'Hi' }, $was: {} },
 *     { entity: { eid: 'p1' }, updated: { by: 'ada' }, pin: null },
 *     { entity: { eid: 'n1' }, $delete: true },
 *   ]),
 *   [
 *     { entity: { eid: 'p1' }, page: ['title'], updated: ['by'], pin: null },
 *     { entity: { eid: 'n1' }, $delete: true },
 *   ],
 * )
 * ```
 */
export let wrote = (bundles: Bundle[]): Wrote[] =>
  composed(bundles).map((b): Wrote =>
    dead(b) ? { entity: b.entity, $delete: true } : {
      entity: b.entity,
      ...Object.fromEntries(
        comps(b).map(([k, v]) => [k, v == null ? null : Object.keys(v)]),
      ),
    }
  )

/** Reads entities as they stand, carrying the components named (@yaks/graph
 * `Storage.get`). */
export type Read = (
  eids: string[],
  comps: string[],
) => Bundle[] | Promise<Bundle[]>

/**
 * The commits a follower heard, each entity's bundle holding what the graph
 * holds now of what the commit wrote, in one read for all of them. A
 * component the entity no longer holds, or an entity since deleted, reads as
 * removed, and a property it no longer holds as `null`: the later commit that
 * removed it is heard too, so the patches still end where the graph is.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 *
 * let now = [{ entity: { eid: 'p1' }, page: { title: 'Hi', text: 'x' } }]
 * assertEquals(
 *   filled([[
 *     { entity: { eid: 'p1' }, page: ['title', 'lede'], pin: ['at'] },
 *     { entity: { eid: 'n1' }, $delete: true },
 *   ]], () => now),
 *   [[
 *     { entity: { eid: 'p1' }, page: { title: 'Hi', lede: null }, pin: null },
 *     { entity: { eid: 'n1' }, $delete: true },
 *   ]],
 * )
 * ```
 */
export let filled = (
  txs: Wrote[][],
  read: Read,
): Bundle[][] | Promise<Bundle[][]> => {
  let eids = new Set<string>()
  let names = new Set<string>()
  for (let w of txs.flat()) {
    if (w.$delete) continue
    eids.add(w.entity.eid)
    for (let [k, v] of Object.entries(w)) if (Array.isArray(v)) names.add(k)
  }
  let fill = (now: Bundle[]) => {
    let held = new Map(
      now.filter((b) => !dead(b)).map((b) => [b.entity.eid, b]),
    )
    return txs.map((tx) =>
      tx.map((w): Bundle => {
        if (w.$delete) return { entity: w.entity, $delete: true }
        let b = held.get(w.entity.eid)
        let out: Bundle = { entity: w.entity }
        for (let [k, props] of Object.entries(w)) {
          if (k == 'entity') continue
          let comp = b?.[k] as Record<string, unknown> | null | undefined
          out[k] = Array.isArray(props) && comp
            ? Object.fromEntries(props.map((p) => [p, comp[p] ?? null]))
            : null
        }
        return out
      })
    )
  }
  return eids.size ? after(read([...eids], [...names]), fill) : fill([])
}

/** One commit another host made: its place in the feed, and what it wrote
 * ({@link wrote}). */
export type Heard = { seq: number; wrote: Wrote[] }

// A row a feed before {@link wrote} kept holds the values themselves, which a
// host still running it writes while a restart reaches it: its names are what
// a follower reads.
let named = (w: Wrote): Wrote =>
  Object.fromEntries(
    Object.entries(w).map(([k, v]) => [
      k,
      k != 'entity' && v && typeof v == 'object' && !Array.isArray(v)
        ? Object.keys(v)
        : v,
    ]),
  ) as Wrote

/** The feed bound to one store, as one host. */
export type FeedRows = Row[] | Promise<Row[]>
type Answer<T, V> = T extends Promise<unknown> ? Promise<V> : V
type Page = { seq: number; wrote?: Wrote[] }[]

export type Feed<T extends FeedRows = FeedRows> = {
  /** who this feed writes as: the one host (a graph opened by one process or
   * thread) whose commits it records, so a follower can skip its own */
  host: string
  /** write one commit down inside the caller's own transaction, and prune
   * what has been kept long enough */
  write: (wrote: Wrote[]) => void
  /** the newest commit's seq, or 0 */
  tip: () => Answer<T, number>
  /** the commits after a cursor, oldest first, at most `n`; one this host
   * made comes without what it wrote */
  since: (cursor: number, n: number) => Answer<T, Page>
}

/** How a feed is bound to a store. */
export type FeedOpts<T extends FeedRows = Row[]> = {
  /** the statement runner, over the graph's own transaction */
  rows: Rows
  /** committed reads, where another connection answers them; writes stay on
   * `rows`, inside the committing transaction */
  read?: (statement: Stmt) => T
  /** the host it writes as (default: a fresh id) */
  host?: string
  /** how long a commit is kept, in ms (default {@link KEEP}) */
  keep?: number
  /** the clock, in ms (default `Date.now`) */
  now?: () => number
}

/** Bind the feed to a store: `feedOf({ rows: (s) => db.query(s) })`. */
export let feedOf = <T extends FeedRows = Row[]>(o: FeedOpts<T>): Feed<T> => {
  let { rows } = o
  let read = o.read ?? rows
  let host = o.host ?? crypto.randomUUID()
  let keep = o.keep ?? KEEP
  let now = o.now ?? Date.now
  let write = (wrote: Wrote[]) => {
    let at = now()
    rows({
      t: 'insert',
      into: FEED,
      cols: ['at', 'host', 'applied'],
      rows: [[val(at), val(host), val(JSON.stringify(wrote))]],
    })
    // Pruned after the insert, so the newest row always stands: the next id
    // is always past every cursor, and a follower never mistakes a fresh row
    // for one it read.
    rows({
      t: 'delete',
      from: FEED,
      where: lt(
        col('id'),
        sub(select({
          cols: [col('id')],
          from: table(FEED),
          where: ge(col('at'), val(at - keep)),
          order: [col('id')],
          limit: lit(1),
        })),
      ),
    })
  }
  let tip = () =>
    after(
      read(select({
        cols: [col('id')],
        from: table(FEED),
        order: [desc(col('id'))],
        limit: lit(1),
      })),
      (rows) => Number(rows[0]?.id ?? 0),
    )
  let since = (cursor: number, n: number) =>
    after(
      read(select({
        cols: [
          col('id'),
          as(iff(eq(col('host'), val(host)), lit(null), col('applied')), 'out'),
        ],
        from: table(FEED),
        where: gt(col('id'), val(cursor)),
        order: [col('id')],
        limit: val(n),
      })),
      (rows) =>
        rows.map((r) => ({
          seq: Number(r.id),
          ...r.out == null
            ? {}
            : { wrote: (JSON.parse(String(r.out)) as Wrote[]).map(named) },
        })),
    )
  return { host, write, tip, since } as Feed<T>
}

/** The plugin that writes each commit into the feed, as the last thing inside
 * its transaction. */
export let feeder = (f: Feed): Plugin => ({
  name: '@yaks/journal/feed',
  hooks: {
    commit: (bundles: Bundle[]) => {
      let said = wrote(bundles)
      if (said.length) f.write(said)
      return bundles
    },
  },
})

/** How a follower reads. */
export type FollowOpts = {
  /** the seq to start after (default: the feed's tip when the follower is
   * made, so it reports only what commits from then on) */
  from?: number
  /** the most commits one page reads, so a burst of writes elsewhere is
   * worked through a page at a time (default 100) */
  page?: number
  /** told how many commits were pruned before this follower read them: it
   * was away longer than they are kept */
  missed?: (n: number) => void
}

/**
 * A follower of a feed: each call answers the commits made since the last call
 * by any host but the feed's own, oldest first. The cursor moves past this
 * host's own commits without reading them, and past another's only once it is
 * read: a read that fails ends the call with what came before it, and the next
 * call starts again at the one that failed, throwing if it still fails.
 */
export let follow = <T extends FeedRows>(
  f: Feed<T>,
  opts: FollowOpts = {},
): () => Answer<T, Heard[]> => {
  let cursor = opts.from
  let initial = cursor === undefined ? f.tip() : undefined
  // Capture the tip when following starts, even if no poll asks for it yet.
  // A failed opening read belongs to that poll, rather than an unhandled task.
  if (isPromise(initial)) void initial.catch(() => {})
  let page = opts.page ?? 100
  return (() => {
    let out: Heard[] = []
    let accept = (seen: Page) => {
      let first = seen[0]?.seq
      if (first > cursor! + 1) opts.missed?.(first - cursor! - 1)
      for (let { seq, wrote } of seen) {
        if (wrote) out.push({ seq, wrote })
        cursor = seq
      }
      return seen.length < page
    }
    let pages = (): Heard[] | Promise<Heard[]> => {
      for (;;) {
        let seen = f.since(cursor!, page)
        if (isPromise(seen)) {
          return seen.then((rows) => accept(rows) ? out : pages())
        }
        if (accept(seen)) return out
      }
    }
    let failed = (err: unknown) => {
      if (out.length) return out
      throw err
    }
    try {
      let start = initial
      initial = undefined
      let result = cursor === undefined
        ? after(start ?? f.tip(), (tip) => {
          cursor = tip
          return pages()
        })
        : pages()
      return isPromise(result) ? result.catch(failed) : result
    } catch (err) {
      return failed(err)
    }
  }) as () => Answer<T, Heard[]>
}
