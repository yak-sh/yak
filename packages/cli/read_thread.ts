// A web host reads through a bounded pool of read-only workers, each started
// once and kept. A worker is never ended to cancel a read: Deno keeps part of
// every worker that ends (7 to 14 MB of the modules it loaded, measured on
// Deno 2.9), so a web that ended one per cancelled read grew by gigabytes a
// day as tabs navigated (T-130803). A cancelled read is answered at once, and
// its worker finishes the synchronous SQL unheard, then takes the next read.
import { parse } from '@yaks/query'
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

/** Independent reads share at most two workers, started only when needed and
 * kept for the reader's life. Each worker owns one read at a time. A read
 * cancelled while it runs is rejected at once and its answer dropped when it
 * comes; only one still running `grace` ms after its caller left (a runaway
 * query) ends its worker, so it cannot hold a lane for good. */
export let readThread = (
  config: string,
  { grace = 10_000, timer = later }: {
    grace?: number
    /** schedule `fn` after `ms` and return its cancellation */
    timer?: (fn: () => void, ms: number) => () => void
  } = {},
): Reader & { ready: () => Promise<void>; close: () => Promise<void> } => {
  type Job = {
    id: number
    call: Call
    resolve: (value: unknown) => void
    reject: (error: unknown) => void
    trace?: Context
    off: () => void
    /** its caller left; the answer goes nowhere */
    dropped?: boolean
  }
  type Lane = { worker: Worker; job?: Job; overdue?: () => void }
  let lanes = new Set<Lane>()
  let waiting: Job[] = []
  let next = 0
  let closed = false
  let stop = (lane: Lane) => {
    lane.overdue?.()
    lane.worker.terminate()
    lanes.delete(lane)
  }
  let finish = (lane: Lane, answer: Heard) => {
    if ('closed' in answer || lane.job?.id != answer.id) return
    let job = lane.job
    lane.job = undefined
    lane.overdue?.()
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
  let drain = () => {
    while (waiting.length && !closed) {
      let lane = [...lanes].find((l) => !l.job)
      if (!lane && lanes.size < 2) lane = start()
      if (!lane) return
      let job = waiting.shift()!
      lane.job = job
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
