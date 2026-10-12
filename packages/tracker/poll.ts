// The platform tracker is a Worker behind signed doors, with no subscription a
// box process can hold. A follower polls its `bugs` read instead and gets the
// shape of a client watch: the whole answer, paged by global eid, on every
// poll. Marks go through the same signed transport.
import type { Bundle } from '@yaks/graph'
import { mark, type Remote } from './remote.ts'
import { read } from './routes.ts'

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
  /** send each bundle's `resolved` or `archived` mark to the Worker. Its
   * marks carry no precondition, so a bundle's `$was` is not checked. */
  mutate: (bundles: Bundle[]) => Promise<Bundle[]>
}

export type PollOpts = {
  /** time between polls, in ms (default 30000) */
  every?: number
  /** how long one poll may take before it counts as failed, in ms (default
   * 20000), so every poll settles */
  timeout?: number
  /** a failed poll; the next one retries */
  report?: (error: unknown) => void
  go?: typeof fetch
}

const PAGE = 100

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
  let go = opts.go ?? fetch
  let value: Bundle[] = [], ready = false
  let listeners = new Set<(bundles: Bundle[]) => void>()
  let stop = new AbortController()
  let page = async (after: string, signal: AbortSignal): Promise<Bundle[]> => {
    let params = new URLSearchParams({
      limit: String(PAGE),
      query: `${query} .order=entity.eid${after ? ` .after=${after}` : ''}`,
    })
    let result = await read({ remote }, 'bugs', params, signal, go)
    if (!result.ok) throw Error(result.error)
    return result.value as Bundle[]
  }
  let all = async () => {
    let signal = AbortSignal.any([
      stop.signal,
      AbortSignal.timeout(opts.timeout ?? 20_000),
    ])
    let rows: Bundle[] = [], after = ''
    for (;;) {
      let got = await page(after, signal)
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
  let wait = (ms: number) =>
    new Promise<void>((done) => {
      let id = setTimeout(done, ms)
      stop.signal.addEventListener('abort', () => {
        clearTimeout(id)
        done()
      }, { once: true })
    })
  ;(async () => {
    while (!stop.signal.aborted) {
      await pass()
      await wait(opts.every ?? 30_000)
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
    close: () => stop.abort(),
    mutate: async (bundles) => {
      for (let b of bundles) {
        let name: 'resolved' | 'archived' | undefined = b.resolved
          ? 'resolved'
          : b.archived
          ? 'archived'
          : undefined
        if (name) await mark(remote, b.entity.eid, name, go)
      }
      return bundles
    },
  }
}
