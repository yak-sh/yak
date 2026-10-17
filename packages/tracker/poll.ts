// The platform tracker is a Worker behind signed doors, with no subscription a
// box process can hold. A follower polls its `bugs` read instead and gets the
// shape of a client watch: the whole answer, paged by global eid, on every
// poll. Marks go through the same signed transport.
import type { Bundle } from '@yaks/graph'
import { mark, type Remote } from './remote.ts'
import { type Read, read } from './routes.ts'
import type { Mark } from './letter.ts'
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
}

/** The Worker's doors a poll asks: a page of its bugs, and a mark. */
export type Doors = {
  /** a page of the bugs `params` asks for (`limit`, `query`) */
  bugs: (params: URLSearchParams, signal: AbortSignal) => Promise<Read>
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
  bugs: (params, signal) => read({ remote }, 'bugs', params, signal, go),
  mark: (bug, name, said) => mark(remote, bug, name, go, said),
})

export type PollOpts = {
  /** time between polls, in ms (default 30000) */
  every?: number
  /** how long one page of a poll may take before the poll counts as failed,
   * in ms (default: the request's own bound, a minute), so every poll
   * settles */
  timeout?: number
  /** a failed poll; the next one retries */
  report?: (error: unknown) => void
  /** where it asks (default: signed doors on a dedicated worker event loop) */
  doors?: Doors
  /** how a wait is set — between polls, and a page's deadline — returning
   * what cancels it (default: `setTimeout`), so a test can hold the clock */
  timer?: (fn: () => void, ms: number) => () => void
}

const PAGE = 100

let timeout = (fn: () => void, ms: number) => {
  let id = setTimeout(fn, ms)
  return () => clearTimeout(id)
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
 * let open = poll({ url: 'http://127.0.0.1:1' }, '.bug', { report: () => {} })
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
  let timer = opts.timer ?? timeout
  let value: Bundle[] = [], ready = false
  let listeners = new Set<(bundles: Bundle[]) => void>()
  let stop = new AbortController()
  // A page past its deadline aborts as `AbortSignal.timeout` would, so the
  // transport names it a timeout (./remote.ts `late`).
  let deadline = (ms: number) => {
    let late = new AbortController()
    let cancel = timer(
      () => late.abort(new DOMException('Signal timed out.', 'TimeoutError')),
      ms,
    )
    return { signal: AbortSignal.any([stop.signal, late.signal]), cancel }
  }
  let page = async (after: string): Promise<Bundle[]> => {
    let params = new URLSearchParams({
      limit: String(PAGE),
      query: `${query} .order=entity.eid${after ? ` .after=${after}` : ''}`,
    })
    let { signal, cancel } = opts.timeout
      ? deadline(opts.timeout)
      : { signal: stop.signal, cancel: () => {} }
    try {
      let result = await doors.bugs(params, signal)
      if (!result.ok) throw Error(result.error)
      return result.value as Bundle[]
    } finally {
      cancel()
    }
  }
  let all = async () => {
    let rows: Bundle[] = [], after = ''
    for (;;) {
      let got = await page(after)
      rows.push(...got)
      if (got.length < PAGE) return rows
      after = got.at(-1)!.entity.eid
    }
  }
  let pass = async () => {
    try {
      value = await all()
      ready = true
    } catch (error) {
      if (stop.signal.aborted) return
      ready = false
      opts.report?.(error)
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
      if (!stop.signal.aborted) await wait(opts.every ?? 30_000)
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
      thread?.close()
    },
    mutate: async (bundles) => {
      for (let b of bundles) {
        let name = markOf(b)
        if (name) await doors.mark(b.entity.eid, name, saying(b[name]))
      }
      return bundles
    },
  }
}
