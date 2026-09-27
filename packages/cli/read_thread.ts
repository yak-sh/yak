// A web host's graph reads run in one worker over the same file. The graph's
// read interface stays the query door; only the thread executing it changes.
import type { Bundle, Eid, Graph, Query, ReadOpts, Row } from '@yaks/graph'

export type Reader = Pick<Graph, 'read' | 'rows' | 'get'>

type Call =
  | { op: 'read' | 'rows'; query: Query; opts?: ReadOpts }
  | { op: 'get'; eids: Eid[]; comps?: string[] }

export type Said = { start: string } | (Call & { id: number }) | { close: true }

export type Heard =
  | { id: number; value: unknown }
  | { id: number; error: { name: string; message: string; details: object } }
  | { closed: true }

export let readThread = (
  config: string,
): Reader & { close: () => Promise<void> } => {
  let worker: Worker | undefined
  let next = 0
  let pending = new Map<number, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
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
      pending.set(id, { resolve, reject })
      start().postMessage({ ...call, id })
    })
  }
  return {
    read: (query, opts) =>
      ask({ op: 'read', query, opts }).then((value) => value as Bundle[]),
    rows: (query, opts) =>
      ask({ op: 'rows', query, opts }).then((value) => value as Row[]),
    get: (eids, comps) =>
      ask({ op: 'get', eids, comps }).then((value) => value as Bundle[]),
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
