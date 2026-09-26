// The feed, followed: the transactions other hosts committed to this store,
// in order, each turned back into the patches it applied.
//
// A graph's `effect` phase shows it only its own commits. Anything else that
// opened the same store — a `yak` command beside `yak serve`, the thread
// working the effect pool, a peer that synced a batch in — commits where this
// graph cannot see, and the journal is the one place every commit is written
// down. A follower pages through it from a cursor and keeps the transactions
// some other host wrote; what this host wrote, its own graph already saw.
//
// Nothing here arms a timer. The follower is a value that answers "what is new
// since last time"; the loop that asks it lives where a process keeps its
// timers (./rules.ts `feed`).

import type { Bundle } from '@yaks/graph'
import type { Patch } from './batch.ts'
import type { Log } from './log.ts'

/**
 * The patches one transaction applied, as the bundles a graph's `effect`
 * phase is handed: one per recorded operation, in order, with a deletion as
 * `$delete`. What it wrote is here; the `created` and `updated` stamps the
 * journal leaves out are not.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 *
 * assertEquals(
 *   recast([
 *     { target: 'p1', comp: 'page', value: { title: 'Hi' } },
 *     { target: 'n1', comp: 'entity', value: null },
 *   ]),
 *   [
 *     { entity: { eid: 'p1' }, page: { title: 'Hi' } },
 *     { entity: { eid: 'n1' }, $delete: true },
 *   ],
 * )
 * ```
 */
export let recast = (patches: Patch[]): Bundle[] =>
  patches.map(({ target, comp, value }) =>
    comp == 'entity' && value == null
      ? { entity: { eid: target }, $delete: true }
      : { entity: { eid: target }, [comp]: value }
  )

/** How a follower reads. */
export type FollowOpts = {
  /** the seq to start after (default: the log's tip when the follower is
   * made, so it reports only what commits from then on) */
  from?: number
  /** the most transactions one page reads, so a burst of writes elsewhere is
   * worked through a page at a time (default 100) */
  page?: number
}

/** One transaction another host committed: its place in the log, and the
 * patches it applied ({@link recast}). */
export type Heard = { seq: number; applied: Bundle[] }

/**
 * A follower of a log's feed: each call answers the transactions committed
 * since the last call by any host but the log's own, oldest first, as the
 * patches each applied ({@link recast}). The cursor moves past this host's
 * own transactions without reading them, and past another's only once it is
 * read: a read that fails ends the call with what came before it, and the next
 * call starts again at the one that failed, throwing if it still fails.
 */
export let follow = (log: Log, opts: FollowOpts = {}): () => Heard[] => {
  let cursor = opts.from ?? log.tip()
  let page = opts.page ?? 100
  return (): Heard[] => {
    let out: Heard[] = []
    try {
      for (;;) {
        let seen = log.hosts(cursor, page)
        for (let { seq, host } of seen) {
          if (host != log.host) {
            out.push({ seq, applied: recast(log.patches(seq)) })
          }
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
