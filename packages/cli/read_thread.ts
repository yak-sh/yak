// A web host's graph reads run in one worker over the same file. The graph's
// read interface stays the query door; only the thread executing it changes.
import type { Bundle, Eid, Graph, Query, ReadOpts, Row } from '@yaks/graph'
import { type Context, context, type Event, forward } from '@yaks/trace'

export type Reader = Pick<Graph, 'read' | 'rows' | 'get'>

type Call =
  | { op: 'read' | 'rows'; query: Query; opts?: ReadOpts }
  | { op: 'get'; eids: Eid[]; comps?: string[] }

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

/** A web host's reader: the graph's reads, run in a worker started on the
 * first of them, or by `ready`, which settles once the worker can answer, so a
 * server that waits on it answers its first read as fast as its next. */
export let readThread = (
  config: string,
): Reader & { ready: () => Promise<void>; close: () => Promise<void> } => {
  let worker: Worker | undefined
  let next = 0
  let pending = new Map<number, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    trace?: Context
  }>()
  let closed = false
  let ending: Promise<void> | undefined
  let finish: (() => void) | undefined
  let fail = (error: Error) => {
    worker?.terminate()
    worker = undefined
    for (let p of pending.values()) p.reject(error)
    pending.clear()
    finish?.()
  }
  let start = () => {
    if (worker) return worker
    let w = new Worker(new URL('./read_worker.ts', import.meta.url), {
      type: 'module',
    })
    worker = w
    w.onmessage = ({ data }: MessageEvent<Heard>) => {
      if ('closed' in data) return
      let p = pending.get(data.id)
      if (!p) return
      pending.delete(data.id)
      if (p.trace && data.spans) forward(p.trace, data.spans, data.origin)
      if ('error' in data) {
        let error = Object.assign(
          new Error(data.error.message),
          data.error.details,
        )
        error.name = data.error.name
        p.reject(error)
      } else p.resolve(data.value)
    }
    w.onerror = (event) => {
      event.preventDefault()
      fail(
        event.error instanceof Error ? event.error : new Error(event.message),
      )
    }
    w.postMessage({ start: config } satisfies Said)
    return w
  }
  let ask = (call: Call): Promise<unknown> => {
    if (closed) return Promise.reject(new Error('the reader is closed'))
    return new Promise((resolve, reject) => {
      let id = ++next
      let trace = context()
      pending.set(id, { resolve, reject, trace })
      start().postMessage({ ...call, id, observed: !!trace })
    })
  }
  return {
    read: (query, opts) =>
      ask({ op: 'read', query, opts }).then((value) => value as Bundle[]),
    rows: (query, opts) =>
      ask({ op: 'rows', query, opts }).then((value) => value as Row[]),
    get: (eids, comps) =>
      ask({ op: 'get', eids, comps }).then((value) => value as Bundle[]),
    ready: () => ask({ op: 'get', eids: [] }).then(() => {}),
    close: () =>
      ending ??= (async () => {
        closed = true
        if (!worker) return
        let w = worker
        let done = Promise.withResolvers<void>()
        finish = done.resolve
        let receive = w.onmessage
        w.onmessage = (event: MessageEvent<Heard>) => {
          if ('closed' in event.data) done.resolve()
          else receive?.call(w, event)
        }
        w.postMessage({ close: true } satisfies Said)
        try {
          await done.promise
        } finally {
          fail(new Error('the reader closed'))
        }
      })(),
  }
}
