/**
 * What the inbox views ask of the host drawing them. A person's threads come
 * from the server-owned summary (`inbox_summary`, ./queries.ts `summaryQuery`):
 * one subscription for the list, one more for an opened thread's messages.
 * Beside it the views hold only the rows they draw (each thread's root and
 * newest message, and an opened thread's messages), never the history behind
 * them. Counts read the same summary, so a count and its list agree, and a
 * host that shares one query between its askers asks the server once. What
 * the views write and draw goes out through the same host (`mark`, `show`).
 *
 * @module
 */

import type { Bundle, Io } from '@yaks/inspect'
import type { Row } from './reader.ts'
import { attention, type Search, type Thread } from './threads.ts'
import { summaryQuery } from './queries.ts'

/** A thread's rows as the summary carries them. */
export type Threads = { threads: Thread<Row>[]; ready: boolean }

/** A summary row as the bundle a view draws: its components on its eid. */
export let bundleOf = (r: Row): Bundle => ({
  ...r.comps,
  entity: { ...r.comps.entity, eid: r.eid },
})

/** The threads read for `actor`, ready once the summary and every row they
 * draw have arrived: a completed summary whose titles are still on their way
 * is not a populated page. A `thread` names one whose messages are read
 * whole. */
export let useThreads = (
  io: Io,
  actor: string,
  search: Search = {},
  thread?: string,
): Threads => {
  let read = io.ask({ summary: summaryQuery(actor, search, thread) }).summary
  let summaries = read.rows.flatMap((b) => {
    let value = (b.inbox_summary as { threads?: unknown } | undefined)?.threads
    return Array.isArray(value) ? value as Thread<Row>[] : []
  })
  let draws = [
    ...new Set(summaries.flatMap((t) => [
      t.row.eid,
      t.latest.eid,
      ...(thread ? t.messages.map((m) => m.eid) : []),
    ])),
  ]
  let draw = io.ask(
    draws.length ? { draw: `.entity.eid=${draws.join(',')}&*` } : {},
  ).draw
  let ready = read.ready && !read.error &&
    (!draw || draw.ready && !draw.error)
  return { threads: ready ? summaries : [], ready }
}

/** One thread with its messages read whole, archived history included. */
export let useThread = (io: Io, actor: string, eid: string): Threads =>
  useThreads(io, actor, { all: true }, eid)

/** How many threads wait unread for the entity drawn, from the same summary
 * as its list; undefined until it is read. */
export let waiting = (e: Bundle, io: Io): number | undefined => {
  let found = useThreads(io, e.entity.eid)
  return found.ready ? found.threads.filter((t) => t.unread).length : undefined
}

/** An entity the host holds, drawn as `view` through its shared renderers. */
export let show = (
  io: Io,
  eid: string,
  view: string,
  ctx?: Record<string, unknown>,
) => io.show(io.get(eid) ?? { entity: { eid } }, view, ctx)

/** Mark a thread read or archived; the policy brings an archived one back on
 * its next activity. */
export let mark = (io: Io, eid: string, how: 'opened' | 'archived'): void =>
  void Promise.resolve().then(() => io.apply(attention(eid, how)))
    .catch(() => {})
