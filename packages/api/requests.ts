// Read requests can be cancelled; admitted writes finish before their graph
// closes. These lifetimes belong to the HTTP server, not its storage adapter.
import { Refused } from '@yaks/graph/errors'
import type { Handler } from './route.ts'

class Cancelled extends Refused {}

let owners = new WeakMap<Request, (work: Promise<unknown>) => void>()

/** A response producer can outlive its headers and its connection. Keep its
 * admitted work owned by the listener until it finishes. */
export let admit = <T>(request: Request, work: Promise<T>): Promise<T> => {
  owners.get(request)?.(work)
  return work
}

export let reading = (request: Request) =>
  ['GET', 'HEAD', 'OPTIONS'].includes(request.method)

/** A cancelled read has no caller waiting for its answer. A write remains
 * admitted even if its connection goes away after the body was received. */
export let receive = async <T>(
  request: Request,
  read: () => T | Promise<T>,
) => {
  if (!reading(request)) return await read()
  let signal = request.signal
  let cancelled = new Cancelled('request was interrupted')
  if (signal.aborted) throw cancelled
  let abort!: () => void
  let stopped = new Promise<never>((_resolve, reject) => {
    abort = () => reject(cancelled)
    signal.addEventListener('abort', abort, { once: true })
  })
  try {
    return await Promise.race([read(), stopped])
  } finally {
    signal.removeEventListener('abort', abort)
  }
}

// The response belongs to its request until its body ends, not just until
// headers arrive. Keep our own reader so shutdown can cancel a locked body.
let streamed = (
  response: Response,
  signal: AbortSignal | undefined,
  ended: () => void,
  keep: (done: Promise<unknown>) => void,
) => {
  if (!response.body) {
    ended()
    return response
  }
  let reader = response.body.getReader()
  let closed = false
  let end = () => {
    closed = true
    signal?.removeEventListener('abort', abort)
    ended()
  }
  let abort = () => {
    if (closed) return
    end()
    output.close()
    keep(reader.cancel())
  }
  let output!: ReadableStreamDefaultController<Uint8Array>
  let body = new ReadableStream<Uint8Array>({
    start: (controller) => {
      output = controller
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
    },
    pull: async () => {
      try {
        let next = await reader.read()
        if (closed) return
        if (next.done) {
          end()
          output.close()
        } else output.enqueue(next.value)
      } catch (error) {
        if (closed) return
        end()
        output.error(error)
      }
    },
    cancel: (reason) => {
      end()
      return reader.cancel(reason)
    },
  })
  return new Response(body, response)
}

/** The work a listener admits: grace may cut reads, never an admitted write. */
export let requests = (handler: Handler) => {
  let reads = new AbortController()
  let pending = new Set<Promise<unknown>>()
  let open = new Map<Request, string>()
  let producers = new Map<Promise<unknown>, Request>()
  let failures: unknown[] = []
  let keep = (done: Promise<unknown>) => {
    pending.add(done)
    void done.then(() => pending.delete(done), (error) => {
      pending.delete(done)
      failures.push(error)
    })
  }
  return {
    open: () =>
      [
        ...open,
        ...[...producers.values()].map((request): [Request, string] => [
          request,
          'producer',
        ]),
      ].map(([request, phase]) => ({
        method: request.method,
        path: new URL(request.url).pathname,
        phase,
      })),
    handle: (request: Request) => {
      owners.set(request, (work) => {
        producers.set(work, request)
        keep(work)
        void work.then(
          () => producers.delete(work),
          () => producers.delete(work),
        )
      })
      open.set(request, 'handler')
      let ended = () => {
        open.delete(request)
      }
      let response = (answer: Response, signal?: AbortSignal) => {
        open.set(request, 'response body')
        return streamed(answer, signal, ended, keep)
      }
      if (reading(request)) {
        let scoped = new Request(request, {
          signal: AbortSignal.any([request.signal, reads.signal]),
        })
        return receive(scoped, () => handler(scoped)).then(
          (answer) => response(answer, scoped.signal),
          (error) => {
            ended()
            if (error instanceof Cancelled) {
              return new Response(null, { status: 499 })
            }
            throw error
          },
        )
      }
      let done = Promise.resolve().then(() => handler(request))
      keep(done)
      return done.then((answer) => response(answer), (error) => {
        ended()
        throw error
      })
    },
    cancel: () => reads.abort(),
    drain: async () => {
      while (pending.size) await Promise.allSettled(pending)
      if (failures.length) {
        throw new AggregateError(failures, 'request drain failed')
      }
    },
  }
}
