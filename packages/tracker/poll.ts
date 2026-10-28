// The platform tracker is a Worker behind signed doors, with no subscription a
// box process can hold. A follower polls its `bugs` read instead and gets the
// shape of a client watch: the whole answer, paged by global eid. Each poll
// sends the tag of the answer it holds: a tracker where nothing moved since
// says so with no row read, and one where something did names what moved, so
// the poll reads only those again. A whole read is left for the first poll,
// and for a tag the tracker no longer knows what moved since. Marks go
// through the same signed transport.
//
// A poll the tracker cannot answer for now is a log line, and the next poll
// tries again; what a failed poll is, and when it is reported, is
// ./outage.ts's, as it is for the tracker service's syncs.
import type { Bundle } from '@yaks/graph'
import { minted } from '@yaks/graph/identity'
import { mark, type Remote, unanswered, Unavailable } from './remote.ts'
import { type Read, read } from './routes.ts'
import type { Mark } from './letter.ts'
import { later, outage, type Timer } from './outage.ts'
import { pollThread } from './poll_thread.ts'

/** A polled answer of the platform tracker, with its mark door. */
export type Polled = {
  /** the query each poll asks the Worker */
  query: string
  /** the bugs it answered last */
  readonly value: Bundle[]
  /** a poll has answered and the latest one did not fail */
  readonly ready: boolean
  /** called after each poll, answered or failed */
  subscribe: (fn: (bundles: Bundle[]) => void) => () => void
  /** stop polling */
  close: () => void
  /** send each bundle's `resolved`, `archived` or `taken` mark to the
   * Worker. Its marks carry no precondition, so a bundle's `$was` is not
   * checked. */
  mutate: (bundles: Bundle[]) => Promise<Bundle[]>
  /** the bugs among `eids`, whatever the poll's query, asked once */
  get: (eids: string[]) => Promise<Bundle[]>
}

/** The Worker's doors a poll asks: a page of its bugs, and a mark. */
export type Doors = {
  /** a page of the bugs `params` asks for (`limit`, `query`), or that
   * nothing moved since `tag` */
  bugs: (
    params: URLSearchParams,
    signal?: AbortSignal,
    tag?: string,
  ) => Promise<Read>
  /** a mark on one bug and what it says: a resolution's explanation, the
   * fixer's `task` with `taken` */
  mark: (
    bug: string,
    name: Mark,
    said: Record<string, string>,
  ) => Promise<unknown>
}

/** The Worker's doors over the signed transport (./remote.ts), through `go`. */
export let signed = (remote: Remote, go: typeof fetch = fetch): Doors => ({
  bugs: (params, signal, tag) =>
    read({ remote }, 'bugs', params, signal, go, tag),
  mark: (bug, name, said) => mark(remote, bug, name, go, said),
})

export type PollOpts = {
  /** time between polls, in ms (default 30000) */
  every?: number
  /** how long one page of a poll may take before the poll counts as failed,
   * in ms (default: the request's own bound, a minute), so every poll
   * settles */
  timeout?: number
  /** a failure to fix: a poll that failed other than by the tracker being
   * out of reach, at once, and the tracker not answering for OUTAGE, once */
  report?: (error: unknown) => void
  /** a poll the tracker could not answer, which the next one retries, and
   * its answering again (default: `console.warn`) */
  log?: (line: string) => void
  /** where it asks (default: signed doors on a dedicated worker event loop) */
  doors?: Doors
  /** how a wait is set — between polls, the outage's, and a page's deadline
   * — returning what cancels it (default: `setTimeout`), so a test can hold
   * the clock */
  timer?: Timer
}

const PAGE = 100, PAGES = 100

/** A page of the bugs `params` asks for, or that nothing moved since `tag`;
 * a refusal throws. */
export type Page = (
  params: URLSearchParams,
  tag?: string,
) => Promise<Extract<Read, { ok: true }>>

/** The pages `doors` answers. A refusal throws, as `Unavailable` (./remote.ts)
 * where the tracker could not answer for now: a 503 or 504 (./routes.ts
 * `read`), or a page past its `timeout`. A stop ends a page as itself, never
 * as the read it cut short. */
export let pages = (
  doors: Doors,
  stop?: AbortSignal,
  { timeout, timer = later }: { timeout?: number; timer?: Timer } = {},
): Page =>
async (params, tag) => {
  stop?.throwIfAborted()
  // A page past its deadline aborts as `AbortSignal.timeout` would, so the
  // transport names it a timeout (./remote.ts `late`).
  let late = new AbortController()
  let cancel = timeout
    ? timer(
      () => late.abort(new DOMException('Signal timed out.', 'TimeoutError')),
      timeout,
    )
    : () => {}
  let signal = timeout
    ? AbortSignal.any([late.signal, ...stop ? [stop] : []])
    : stop
  try {
    let got = await doors.bugs(params, signal, tag).catch((error) => {
      throw unanswered(error)
    })
    stop?.throwIfAborted()
    if (got.ok) return got
    throw got.status == 503 || got.status == 504
      ? new Unavailable(got.error)
      : Error(got.error)
  } finally {
    cancel()
  }
}

/** What brings an answer read at a tag up to date: the rows read, at the tag
 * the tracker stands at now. With `moved`, they are the answer among those
 * entities, which moved since; without, the whole answer. */
export type Fresh = { rows: Bundle[]; tag?: string; moved?: string[] }

let asking = (query: string) =>
  new URLSearchParams({ limit: String(PAGE), query })

// A page in eid order past `after`, no longer than asked: anything else would
// loop, or skip a bug.
let checked = (value: unknown, after = ''): Bundle[] => {
  let rows = value as Bundle[]
  if (
    !Array.isArray(rows) || rows.length > PAGE ||
    rows.some((row, i) =>
      !row?.bug || typeof row.entity?.eid != 'string' ||
      row.entity.eid <= (i ? rows[i - 1].entity.eid : after)
    )
  ) throw Error('Remote tracker returned an invalid page of bugs')
  return rows
}

/** Every bug `query` answers, a page at a time in eid order, and the tag its
 * first page was read at. */
let whole = async (page: Page, query: string): Promise<Fresh> => {
  let rows: Bundle[] = [], after = '', tag: string | undefined
  for (let n = 0; n < PAGES; n++) {
    let got = await page(asking(
      `${query} .order=entity.eid${after ? ` .after=${after}` : ''}`,
    ))
    tag ??= got.tag
    let some = checked(got.value, after)
    rows.push(...some)
    if (some.length < PAGE) return { rows, tag }
    after = some.at(-1)!.entity.eid
  }
  throw Error(`Remote tracker answered more than ${PAGES} pages of bugs`)
}

/** The bugs among `eids` that `query` answers, a page of ids to a request,
 * which keeps each request's address short and its answer to one page. */
let among = async (
  page: Page,
  query: string,
  eids: string[],
): Promise<Bundle[]> => {
  let rows: Bundle[] = []
  for (let at = 0; at < eids.length; at += PAGE) {
    let some = eids.slice(at, at + PAGE).join(',')
    let got = await page(
      asking(`${query} .entity.eid=${some} .order=entity.eid`),
    )
    rows.push(...checked(got.value))
  }
  return rows
}

/** What brings the answer to `query` read at tag `held` up to date: nothing
 * when nothing moved, the bugs among those that moved when the tracker names
 * them, and otherwise, or with no tag held, the whole answer. */
export let since = async (
  page: Page,
  query: string,
  held?: string,
): Promise<Fresh | undefined> => {
  if (held) {
    let got = await page(new URLSearchParams({ since: held }), held)
    if (got.unchanged) return
    let moved = (got.value as { moved?: unknown } | null)?.moved
    if (
      Array.isArray(moved) &&
      moved.every((eid) => typeof eid == 'string' && minted(eid))
    ) return { rows: await among(page, query, moved), tag: got.tag, moved }
  }
  return await whole(page, query)
}

/** The answer `rows` brought up to date by `fresh`, in eid order.
 *
 * ```ts
 * import { renewed } from '@yaks/tracker/poll'
 * import { equal } from '@yaks/testing'
 * let bug = (eid: string, fault = eid) => ({ entity: { eid }, bug: { fault } })
 * let rows = [bug('a'), bug('b'), bug('c')]
 * equal(
 *   renewed(rows, { rows: [bug('b', 'new'), bug('d')], moved: ['b', 'c', 'd'] }),
 *   [bug('a'), bug('b', 'new'), bug('d')],
 * )
 * equal(renewed(rows, { rows: [bug('e')] }), [bug('e')])
 * ```
 */
export let renewed = (rows: Bundle[], fresh: Fresh): Bundle[] => {
  if (!fresh.moved) return fresh.rows
  let moved = new Set(fresh.moved)
  return [...rows.filter((b) => !moved.has(b.entity.eid)), ...fresh.rows]
    .sort((a, b) => a.entity.eid < b.entity.eid ? -1 : 1)
}

// The mark a bundle carries, if it carries one.
let markOf = (b: Bundle): Mark | undefined =>
  b.resolved
    ? 'resolved'
    : b.archived
    ? 'archived'
    : b.taken
    ? 'taken'
    : undefined

/** What a mark says beside its stamps, which the Worker writes itself. */
let saying = (mark: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries(mark ?? {}).filter(([k, v]) =>
      typeof v == 'string' && !['at', 'by', 'via'].includes(k)
    ),
  )

/**
 * Poll the platform tracker's bugs until closed.
 *
 * ```ts
 * import { poll } from '@yaks/tracker/poll'
 *
 * // Supply doors for an in-memory example; omit them for the signed worker.
 * let open = poll({ url: 'https://tracker.example' }, '.bug', {
 *   doors: {
 *     bugs: async () => ({ ok: true, value: [] }),
 *     mark: async () => {},
 *   },
 * })
 * open.ready // false: no poll has answered
 * open.close()
 * ```
 */
export let poll = (
  remote: Remote,
  query = '.bug',
  opts: PollOpts = {},
): Polled => {
  let thread = opts.doors ? undefined : pollThread(remote)
  let doors = opts.doors ?? thread!
  let timer = opts.timer ?? later
  let value: Bundle[] = [], ready = false
  // The tag `value` was read at.
  let held: string | undefined
  let listeners = new Set<(bundles: Bundle[]) => void>()
  let stop = new AbortController()
  let page = pages(doors, stop.signal, { timeout: opts.timeout, timer })
  let every = opts.every ?? 30_000
  let watched = outage({
    name: 'Tracker poll',
    every,
    report: opts.report,
    log: opts.log,
    timer,
    signal: stop.signal,
  })
  let pass = async () => {
    try {
      await watched(async () => {
        let fresh = await since(page, query, held)
        if (fresh) {
          value = renewed(value, fresh)
          held = fresh.tag
        }
        ready = true
      })
    } catch {
      if (stop.signal.aborted) return
      ready = false
    }
    for (let fn of listeners) fn(value)
  }
  // A wait that the time or a close ends, whichever comes first, leaving no
  // listener behind it on a poll that runs for days.
  let wait = (ms: number) =>
    new Promise<void>((done) => {
      let end = () => {
        cancel()
        stop.signal.removeEventListener('abort', end)
        done()
      }
      let cancel = timer(end, ms)
      stop.signal.addEventListener('abort', end, { once: true })
    })
  ;(async () => {
    while (!stop.signal.aborted) {
      await pass()
      if (!stop.signal.aborted) await wait(every)
    }
  })()
  return {
    query,
    get value() {
      return value
    },
    get ready() {
      return ready
    },
    subscribe: (fn) => {
      listeners.add(fn)
      return () => void listeners.delete(fn)
    },
    close: () => {
      stop.abort()
      watched.close()
      thread?.close()
    },
    mutate: async (bundles) => {
      for (let b of bundles) {
        let name = markOf(b)
        if (name) await doors.mark(b.entity.eid, name, saying(b[name]))
      }
      return bundles
    },
    get: (eids) => among(page, '.bug', eids),
  }
}
