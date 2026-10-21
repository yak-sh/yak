// `@yaks/journal/graph` — what a server composed from a config file imports to
// switch the journal on. Its schema is the journal's append-only tables and
// the feed's short-lived one, which a writing host adds to its store; its
// plugins write a row per component every transaction touched that the
// vocabulary keeps as history, and a row per commit to the feed.
//
// `logFor` and `feedFor` are here rather than inside `plugins` because
// `@yaks/journal/tools` reads the same tables this plugin writes, and the feed
// below follows its own: one host, one log and one feed, bound in one place.
// Both write as the same host, which is what lets the feed leave out what this
// host wrote itself.

import type { Bundle, Plugin } from '@yaks/graph'
import {
  as,
  col,
  type Derived,
  fn,
  type History,
  NOW,
  select,
  type Statements,
  statements,
  type Stmt,
  table,
} from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import {
  ddl,
  journal,
  type Log,
  log,
  type Recording,
  type Rows,
} from './mod.ts'
import {
  type Feed,
  feedDdl,
  feeder,
  feedOf,
  follow,
  type Heard,
} from './feed.ts'

let logs = new WeakMap<object, Log>()
let feeds = new WeakMap<object, Feed>()

/** What a log is bound to: the host's storage, and the read overrides
 * its store was opened with, so a value the store keeps in another form reads
 * back the way the graph reads it (./log.ts `LogOpts.derived`). */
export type Bound = { storage: { statements?: Statements }; derived?: Derived }

let rowsOf = (host: Bound): Rows => {
  let sql = statements(host.storage)
  return (s: Stmt) => sql.query(s)
}

/** The log bound to a host: the three tables, read and written over that
 * host's storage transaction, as that host. The same host gets the same log. */
export let logFor = (host: Bound): Log => {
  let found = logs.get(host)
  if (!found) {
    logs.set(host, found = log({ rows: rowsOf(host), derived: host.derived }))
  }
  return found
}

/** The feed bound to a host, written as the host its log writes as. The same
 * host gets the same feed. */
export let feedFor = (host: Bound): Feed => {
  let found = feeds.get(host)
  if (!found) {
    let rows = rowsOf(host)
    feeds.set(host, found = feedOf({ rows, host: logFor(host).host }))
  }
  return found
}

/** The journal's tables and the feed's, which a writing host adds with the
 * rest of its composed schema; a store an older journal made gains the columns
 * it predates there (@yaks/sqlite `grow`). */
export let schema = (): Stmt[] => [...ddl(), ...feedDdl()]

/**
 * Which aspects of history a config switches on (D-130964), each covering the
 * components not declared `journal: false`:
 *
 * - `attribution`: a `journal_change` row per component each transaction
 *   wrote or removed, under its `journal_tx` row (when, by whom, through what).
 * - `versions`: the store keeps every version a write replaces (@yaks/sqlite
 *   `History`), each naming its transaction.
 *
 * Naming either turns history to them, each on unless set false:
 * `{"use": "@yaks/journal", "with": {"versions": true}}`. Naming neither is
 * the journal before versions, attribution with every value as a
 * `journal_field` row, until the box's journal moves into versions.
 */
export type Aspects = {
  attribution: boolean
  versions: boolean
  values: boolean
}

export let aspects = (options: Record<string, unknown> = {}): Aspects =>
  'attribution' in options || 'versions' in options
    ? {
      attribution: options.attribution !== false,
      versions: options.versions !== false,
      values: false,
    }
    : { attribution: true, versions: false, values: true }

/** What a store keeps versions with, where `versions` is on: the statement
 * that takes a transaction's id, as a `journal_tx` row whose writer the
 * journal fills in as it records the transaction, and the newest one's. */
export let history = (options?: Record<string, unknown>): History | undefined =>
  aspects(options).versions
    ? {
      clock: {
        t: 'insert',
        into: 'journal_tx',
        cols: ['ts'],
        rows: [[NOW]],
        returning: [col('id')],
      },
      tip: select({
        cols: [as(fn('max', col('id')), 'id')],
        from: table('journal_tx'),
      }),
    }
    : undefined

/** A store keeping versions requires the journal from then on: a writer
 * without it would change live rows and keep nothing they replaced. */
export let required = (options?: Record<string, unknown>): boolean =>
  aspects(options).versions

/** Bind the hooks over the tables the installer prepared: the journal,
 * recording what the host's vocabulary keeps as history, as its aspects say,
 * and the feed, carrying every commit to the other hosts. */
export let plugins = (
  host: Bound & { vocab: Vocab },
  options?: Record<string, unknown>,
): Plugin[] => {
  let a = aspects(options)
  // A branch's commits are recorded as its own, and reach no other host: the
  // feed carries main's.
  let mode = host.storage.statements?.mode
  let record: Recording = {
    changes: a.attribution,
    values: a.values,
    ...mode && 'branch' in mode ? { branch: mode.branch } : {},
  }
  return [
    journal(logFor(host), host.vocab, { record }),
    ...mode ? [] : [feeder(feedFor(host))],
  ]
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
 * The commits other hosts made to this store, handed to `each` as the bundles
 * they applied, oldest first, from the moment `each` is given until the
 * returned function is called or the host stops. What a subscription registry
 * or a cache is fed so it also sees writes its own graph did not make: a `yak`
 * command's beside `yak serve`, or a worker's serving the effects role.
 * Whatever goes wrong on the way is the host's to report.
 */
export let feed = (
  host: Bound & {
    stopping: AbortSignal
    report?: (error: unknown) => void | Promise<void>
  },
  options: { every?: number } = {},
) =>
(each: Each): () => void => {
  let every = options.every ?? EVERY
  let told = (error: unknown) =>
    host.report
      ? void host.report(error)
      : console.error('@yaks/journal feed —', error)
  let next = follow(feedFor(host), {
    missed: (n) =>
      told(new Error(`the feed pruned ${n} commits before they were read`)),
  })
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
      told(err)
    }
    while (queue.length && !stopped) {
      let head = queue[0]
      try {
        await each(head.applied)
      } catch (err) {
        if (++head.tries < TRIES) break
        told(new Error(`the feed passed over ${head.seq}`, { cause: err }))
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
