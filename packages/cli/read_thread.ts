// A web host reads through a bounded pool of read-only workers, each started
// once and kept. A worker is never ended to cancel a read: Deno keeps part of
// every worker that ends (7 to 14 MB of the modules it loaded, measured on
// Deno 2.9), so a web that ended one per cancelled read grew by gigabytes a
// day as tabs navigated (T-130803). A cancelled read is answered at once, and
// its worker finishes the synchronous SQL unheard, then takes the next read.
import { mask, parse, stringify } from '@yaks/query'
import type { Bundle, Eid, Graph, Query, ReadOpts, Row } from '@yaks/graph'
import { type Context, context, type Event, forward } from '@yaks/trace'

export type Reader = Pick<Graph, 'read' | 'rows' | 'get'>

type Call =
  | { op: 'read' | 'rows'; query: Query; opts?: ReadOpts }
  | { op: 'get'; eids: Eid[]; comps?: string[]; opts?: ReadOpts }

export type Said =
  | { start: string }
  | (Call & { id: number; observed?: boolean })
  | { close: true }

type Traced = { spans?: Event[]; origin?: number }
export type Heard =
  | ({ id: number; value: unknown } & Traced)
  | (
    & { id: number; error: { name: string; message: string; details: object } }
    & Traced
  )
  | { closed: true }

let later = (fn: () => void, ms: number) => {
  let id = setTimeout(fn, ms)
  return () => clearTimeout(id)
}

/** What a read asked, as a trace keeps it: every value masked, bounded. */
let asked = (call: Call): string =>
  call.op == 'get'
    ? `get of ${call.eids.length} entities`
    : mask(typeof call.query == 'string' ? call.query : stringify(call.query))
      .slice(0, 512)

/** Independent reads share at most two workers, started only when needed and
 * kept for the reader's life. Each worker owns one read at a time. A read
 * cancelled while it runs is rejected at once and its answer dropped when it
 * comes; only one still running `grace` ms after its caller left (a runaway
 * query) ends its worker, so it cannot hold a lane for good. A read still
 * running `slow` ms after it started is told to whoever `overrun` was given,
 * once, with its masked query: one that runs on is a failure, and the query is
 * what names it. One the worker cuts off past its budget
 * (@yaks/sqlite/budget) is a refusal its caller hears, not a failure. */
export let readThread = (
  config: string,
  { grace = 10_000, slow = 10_000, timer = later }: {
    grace?: number
    slow?: number
    /** schedule `fn` after `ms` and return its cancellation */
    timer?: (fn: () => void, ms: number) => () => void
  } = {},
): Reader & {
  ready: () => Promise<void>
  close: () => Promise<void>
  /** where a read that runs past `slow` is told */
  overrun: (tell: (error: Error) => void) => void
} => {
  type Job = {
    id: number
    call: Call
    resolve: (value: unknown) => void
    reject: (error: unknown) => void
    trace?: Context
    off: () => void
    /** its caller left; the answer goes nowhere */
    dropped?: boolean
    /** when its worker was given it (performance.now) */
    sent?: number
  }
  type Lane = {
    worker: Worker
    job?: Job
    overdue?: () => void
    long?: () => void
    /** its worker has answered a read: it is started, not still loading */
    heard?: boolean
  }
  let told: (error: Error) => void = () => {}
  let lanes = new Set<Lane>()
  let waiting: Job[] = []
  let next = 0
  let closed = false
  let stop = (lane: Lane) => {
    lane.overdue?.()
    lane.long?.()
    lane.worker.terminate()
    lanes.delete(lane)
  }
  let finish = (lane: Lane, answer: Heard) => {
    if ('closed' in answer || lane.job?.id != answer.id) return
    let job = lane.job
    lane.job = undefined
    lane.heard = true
    lane.overdue?.()
    lane.long?.()
    job.off()
    if (job.dropped) return drain()
    if (job.trace && answer.spans) {
      forward(job.trace, answer.spans, answer.origin)
    }
    if ('error' in answer) {
      let error = Object.assign(
        new Error(answer.error.message),
        answer.error.details,
      )
      error.name = answer.error.name
      job.reject(error)
    } else job.resolve(answer.value)
    drain()
  }
  let start = () => {
    let worker = new Worker(new URL('./read_worker.ts', import.meta.url), {
      type: 'module',
    })
    let lane: Lane = { worker }
    lanes.add(lane)
    worker.onmessage = ({ data }: MessageEvent<Heard>) => finish(lane, data)
    worker.onerror = (event) => {
      event.preventDefault()
      let job = lane.job
      stop(lane)
      job?.off()
      job?.reject(
        event.error instanceof Error ? event.error : new Error(event.message),
      )
      drain()
    }
    worker.postMessage({ start: config } satisfies Said)
    return lane
  }
  // What a read past `slow` waited on, as far as this thread can see: a main
  // thread that ran the check late was blocked (the answer may have come and
  // gone unheard), a worker that never answered was still loading, and the
  // other lane's read and the queue are what it ran beside.
  let waited = (lane: Lane, job: Job): string => {
    let s = (ms: number) => `${(ms / 1000).toFixed(1)} s`
    let late = performance.now() - job.sent! - slow
    let others = [...lanes].flatMap((l) =>
      l != lane && l.job
        ? [
          `the other lane ran ${asked(l.job.call)} for ${
            s(performance.now() - l.job.sent!)
          }`,
        ]
        : []
    )
    return [
      late > 1000
        ? `this check ran ${s(late)} late: the main thread was blocked`
        : 'the main thread ran this check on time',
      lane.heard ? '' : 'its worker had not answered a read yet',
      ...others,
      waiting.length ? `${waiting.length} reads waited behind it` : '',
    ].filter(Boolean).join('; ')
  }
  let drain = () => {
    while (waiting.length && !closed) {
      let lane = [...lanes].find((l) => !l.job)
      if (!lane && lanes.size < 2) lane = start()
      if (!lane) return
      let job = waiting.shift()!
      lane.job = job
      job.sent = performance.now()
      lane.long = timer(() => {
        if (lane.job !== job) return
        told(Object.assign(
          new Error(
            `a read has run ${slow / 1000} s and is still running: ` +
              asked(job.call),
            { cause: new Error(waited(lane, job)) },
          ),
          { name: 'SlowRead' },
        ))
      }, slow)
      lane.worker.postMessage({
        ...job.call,
        id: job.id,
        observed: !!job.trace,
      })
    }
  }
  let ask = (call: Call): Promise<unknown> => {
    if (closed) return Promise.reject(new Error('the reader is closed'))
    let { signal, ...opts } = call.opts ?? {}
    if (signal?.aborted) return Promise.reject(signal.reason)
    return new Promise((resolve, reject) => {
      let cancel = () => {
        waiting = waiting.filter((j) => j !== job)
        job.off()
        reject(signal!.reason)
        let lane = [...lanes].find((l) => l.job === job)
        if (!lane) return
        job.dropped = true
        lane.overdue = timer(() => {
          if (lane.job !== job) return
          stop(lane)
          drain()
        }, grace)
      }
      let job: Job = {
        id: ++next,
        call: { ...call, opts },
        resolve,
        reject,
        trace: context(),
        off: () => signal?.removeEventListener('abort', cancel),
      }
      signal?.addEventListener('abort', cancel, { once: true })
      waiting.push(job)
      drain()
    })
  }
  return {
    read: (query, opts) =>
      ask({ op: 'read', query, opts }).then((value) => value as Bundle[]),
    rows: (query, opts) =>
      ask({ op: 'rows', query, opts }).then((value) => value as Row[]),
    get: (eids, comps, opts) =>
      ask({ op: 'get', eids, comps, opts }).then((value) => value as Bundle[]),
    ready: () => ask({ op: 'read', query: parse('.limit=1') }).then(() => {}),
    overrun: (tell) => void (told = tell),
    close: () => {
      closed = true
      let jobs = [
        ...waiting,
        ...[...lanes].flatMap((l) => l.job ? [l.job] : []),
      ]
      waiting = []
      for (let lane of lanes) stop(lane)
      for (let job of jobs) {
        job.off()
        job.reject(new Error('the reader closed'))
      }
      return Promise.resolve()
    },
  }
}
