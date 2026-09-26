// `@yaks/journal/rules` — what a server composed from a config file imports to
// switch the journal on. It creates the three append-only tables over the
// server's own database connection and returns the plugin that writes a row per
// component every transaction touched.
//
// `logFor` is here rather than inside `rules` because `@yaks/journal/tools`
// reads the same tables this plugin writes, and the feed follows them: one
// host, one log, bound in one place. One log per host is also what names the
// host its transactions are written as, so the feed below can leave out what
// this host wrote itself.

import type { Bundle, Plugin } from '@yaks/graph'
import type { Driver } from '@yaks/sql'
import { ddl, grown, journal, type Log, log } from './mod.ts'
import { follow, type Heard } from './feed.ts'

let logs = new WeakMap<object, Log>()

/** The log bound to a host: the three tables, read and written over that
 * host's own connection, as that host. The same host gets the same log. */
export let logFor = (host: { sql: Driver }): Log => {
  let found = logs.get(host)
  if (!found) logs.set(host, found = log({ rows: (s) => host.sql.query(s) }))
  return found
}

/** Record who wrote what, inside the transaction that wrote it. A store an
 * older journal made gains the columns it predates first. */
export let rules = (host: { sql: Driver }): Plugin[] => {
  for (let s of ddl()) host.sql.query(s)
  let has = host.sql.query({
    t: 'pragma',
    name: 'table_info',
    arg: 'journal_tx',
  })
  for (let s of grown(has.map((c) => String(c.name)))) host.sql.query(s)
  return [journal(logFor(host))]
}

/** How often a host looks for what other hosts committed, in ms, unless the
 * config says (`{"use": "@yaks/journal", "with": {"every": 50}}`). */
export let EVERY = 200

/** What a feed hands each transaction to; it may take its time, and the next
 * transaction waits for it. */
export type Each = (applied: Bundle[]) => void | Promise<void>

/** How many looks a transaction a consumer failed on is offered again before
 * it is reported and passed over, so one that can never be taken does not
 * hold back every commit after it. */
export let TRIES = 5

/**
 * The commits other hosts made to this store, handed to `each` as the patches
 * they applied, oldest first, from the moment `each` is given until the
 * returned function is called or the host stops. What a subscription registry
 * or a cache is fed so it also sees writes its own graph did not make: a `yak`
 * command's beside `yak serve`, or the effect pool's in its own thread.
 */
export let feed = (
  host: { sql: Driver; stopping: AbortSignal },
  options: { every?: number } = {},
) =>
(each: Each): () => void => {
  let every = options.every ?? EVERY
  let next = follow(logFor(host))
  let queue: (Heard & { tries: number })[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  // One look at a time, the next one scheduled when this one is done, so the
  // consumer is never handed a transaction out of order. A read that fails is
  // tried again at the next look, since the cursor moves only past what was
  // read. A transaction the consumer fails on (a store busy for a moment) is
  // offered again at the next look, ahead of everything after it, until it
  // has failed TRIES times.
  let look = async () => {
    try {
      queue.push(...next().map((h) => ({ ...h, tries: 0 })))
    } catch (err) {
      console.error('@yaks/journal feed —', err)
    }
    while (queue.length && !stopped) {
      let head = queue[0]
      try {
        await each(head.applied)
      } catch (err) {
        if (++head.tries < TRIES) break
        console.error(`@yaks/journal feed — passed over ${head.seq}:`, err)
      }
      queue.shift()
    }
    if (!stopped) timer = setTimeout(look, every)
  }
  let stop = () => {
    stopped = true
    clearTimeout(timer)
  }
  if (host.stopping.aborted) return stop
  host.stopping.addEventListener('abort', stop, { once: true })
  timer = setTimeout(look, every)
  return stop
}
