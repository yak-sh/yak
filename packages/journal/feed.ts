// The feed: every commit, for the other hosts that opened the same store.
//
// A graph's `effect` phase shows it only its own commits. Anything else that
// opened the same store — a `yak` command beside `yak serve`, a worker serving
// the effects role — commits where this graph cannot see. So each commit
// writes one row to `journal_feed`, inside its own transaction: the host that
// made it and the bundles it applied, one per entity. A follower pages through
// the rows from a cursor and keeps the ones another host wrote; what this host
// wrote, its own graph already saw.
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
 * A commit as the feed carries it: one bundle per entity, holding the
 * components it patched, or `$delete` where the entity went.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 *
 * assertEquals(
 *   carried([
 *     { entity: { eid: 'p1' }, page: { title: 'Hi' }, $was: {} },
 *     { entity: { eid: 'p1' }, updated: { by: 'ada' } },
 *     { entity: { eid: 'n1' }, $delete: true },
 *   ]),
 *   [
 *     { entity: { eid: 'p1' }, page: { title: 'Hi' }, updated: { by: 'ada' } },
 *     { entity: { eid: 'n1' }, $delete: true },
 *   ],
 * )
 * ```
 */
export let carried = (bundles: Bundle[]): Bundle[] =>
  composed(bundles).map((b): Bundle =>
    dead(b)
      ? { entity: b.entity, $delete: true }
      : { entity: b.entity, ...Object.fromEntries(comps(b)) }
  )

// Bytes cross as a tagged object, the one value JSON cannot hold.
let pack = (bundles: Bundle[]): string =>
  JSON.stringify(
    bundles,
    (_k, v) => v instanceof Uint8Array ? { $binary: v.toBase64() } : v,
  )
let unpack = (text: string): Bundle[] =>
  JSON.parse(
    text,
    (_k, v) =>
      v && typeof v == 'object' && typeof v.$binary == 'string' &&
        Object.keys(v).length == 1
        ? Uint8Array.fromBase64(v.$binary)
        : v,
  )

/** One commit another host made: its place in the feed, and the bundles it
 * applied ({@link carried}). */
export type Heard = { seq: number; applied: Bundle[] }

/** The feed bound to one store, as one host. */
export type Feed = {
  /** who this feed writes as: the one host (a graph opened by one process or
   * thread) whose commits it records, so a follower can skip its own */
  host: string
  /** write one commit down inside the caller's own transaction, and prune
   * what has been kept long enough */
  write: (applied: Bundle[]) => void
  /** the newest commit's seq, or 0 */
  tip: () => number
  /** the commits after a cursor, oldest first, at most `n`; one this host
   * made comes without its bundles */
  since: (cursor: number, n: number) => { seq: number; applied?: Bundle[] }[]
}

/** How a feed is bound to a store. */
export type FeedOpts = {
  /** the statement runner, over the graph's own transaction */
  rows: Rows
  /** the host it writes as (default: a fresh id) */
  host?: string
  /** how long a commit is kept, in ms (default {@link KEEP}) */
  keep?: number
  /** the clock, in ms (default `Date.now`) */
  now?: () => number
}

/** Bind the feed to a store: `feedOf({ rows: (s) => db.query(s) })`. */
export let feedOf = (o: FeedOpts): Feed => {
  let { rows } = o
  let host = o.host ?? crypto.randomUUID()
  let keep = o.keep ?? KEEP
  let now = o.now ?? Date.now
  let write = (applied: Bundle[]) => {
    let at = now()
    rows({
      t: 'insert',
      into: FEED,
      cols: ['at', 'host', 'applied'],
      rows: [[val(at), val(host), val(pack(applied))]],
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
    Number(
      rows(select({
        cols: [col('id')],
        from: table(FEED),
        order: [desc(col('id'))],
        limit: lit(1),
      }))[0]?.id ?? 0,
    )
  let since = (cursor: number, n: number) =>
    rows(select({
      cols: [
        col('id'),
        as(iff(eq(col('host'), val(host)), lit(null), col('applied')), 'out'),
      ],
      from: table(FEED),
      where: gt(col('id'), val(cursor)),
      order: [col('id')],
      limit: val(n),
    })).map((r) => ({
      seq: Number(r.id),
      ...r.out == null ? {} : { applied: unpack(String(r.out)) },
    }))
  return { host, write, tip, since }
}

/** The plugin that writes each commit into the feed, as the last thing inside
 * its transaction. It carries what the `commit` phase hands it, so it is
 * registered after any plugin that puts a value back there (@yaks/blob's text
 * for its address); a host composes it in config order, after them. */
export let feeder = (f: Feed): Plugin => ({
  name: '@yaks/journal/feed',
  hooks: {
    commit: (bundles: Bundle[]) => {
      let applied = carried(bundles)
      if (applied.length) f.write(applied)
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
export let follow = (f: Feed, opts: FollowOpts = {}): () => Heard[] => {
  let cursor = opts.from ?? f.tip()
  let page = opts.page ?? 100
  return (): Heard[] => {
    let out: Heard[] = []
    try {
      for (;;) {
        let seen = f.since(cursor, page)
        let first = seen[0]?.seq
        if (first > cursor + 1) opts.missed?.(first - cursor - 1)
        for (let { seq, applied } of seen) {
          if (applied) out.push({ seq, applied })
          cursor = seq
        }
        if (seen.length < page) return out
      }
    } catch (err) {
      if (out.length) return out
      throw err
    }
  }
}
