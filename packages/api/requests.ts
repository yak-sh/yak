// Read requests can be cancelled; admitted writes finish before their graph
// closes. These lifetimes belong to the HTTP server, not its storage adapter.
import { resolvers } from '@yaks/fp'
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

let readers = new WeakMap<Request, () => void>()

/** A request whose method is a write's but whose work only reads, such as an
 * MCP call to a read-only tool: the cut at the end of a grace answers it 499,
 * as it does a GET, and the drain no longer waits for it. */
export let reads = (request: Request): void => readers.get(request)?.()

let cuts = new WeakMap<Request, AbortSignal>()

/** The cut at the end of a grace, for a write's request: what its admitted
 * work may still drop once its write is kept, such as the extras an MCP call
 * reads beside its answer (@yaks/tools `Invocation.call`). */
export let cutOf = (request: Request): AbortSignal | undefined =>
  cuts.get(request)

/** A cancelled read has no caller waiting for its answer. A write remains
 * admitted even if its connection goes away after the body was received. */
export let receive = async <T>(
  request: Request,
  read: () => T | Promise<T>,
) => {
  if (
    !reading(request) ||
    (request.headers.get('upgrade') ?? '').toLowerCase() == 'websocket'
  ) return await read()
  let signal = request.signal
  // Made only when the read is cut short: an error captures its stack, and
  // nearly every read finishes.
  let cancelled = () => new Cancelled('request was interrupted')
  if (signal.aborted) throw cancelled()
  let abort!: () => void
  let stopped = new Promise<never>((_resolve, reject) => {
    abort = () => reject(cancelled())
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
  // A 101 is the runtime's opaque upgrade response. Reconstructing it as a
  // streamed Response loses its socket ownership and corrupts the handshake.
  if (response.status == 101 || !response.body) {
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

/** The work a listener admits: the cut at the end of a grace stops reads and
 * every answer still streaming that no admitted work is producing, never an
 * admitted write. */
export let requests = (handler: Handler) => {
  let cut = new AbortController()
  let pending = new Set<Promise<unknown>>()
  let open = new Map<Request, string>()
  let producers = new Map<Promise<unknown>, Request>()
  let outputs = new Map<Request, AbortController>()
  let producing = (request: Request) =>
    [...producers.values()].includes(request)
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
        outputs.delete(request)
      }
      let response = (answer: Response, signal?: AbortSignal) => {
        open.set(request, 'response body')
        return streamed(answer, signal, ended, keep)
      }
      // Runtime upgrades are tied to the incoming Request's internal socket.
      // A standards-level clone does not carry that ownership in Deno.
      if ((request.headers.get('upgrade') ?? '').toLowerCase() == 'websocket') {
        return Promise.resolve(handler(request)).then((answer) => {
          ended()
          return answer
        }, (error) => {
          ended()
          throw error
        })
      }
      if (reading(request)) {
        let scoped = new Request(request, {
          signal: AbortSignal.any([request.signal, cut.signal]),
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
      // A write's request said to only read is let go at the cut, once
      // both have happened, whichever comes first; an answer it gives after
      // is nobody's.
      let read = false, left = false
      let gone = resolvers<Response>()
      let leave = () => {
        if (left || !read || !cut.signal.aborted) return
        left = true
        ended()
        gone.resolve(new Response(null, { status: 499 }))
      }
      cuts.set(request, cut.signal)
      readers.set(request, () => {
        read = true
        leave()
      })
      cut.signal.addEventListener('abort', leave, { once: true })
      let held = done.finally(() =>
        cut.signal.removeEventListener('abort', leave)
      )
      keep(Promise.race([held, gone.promise]))
      let answered = held.then((answer) => {
        if (left) {
          void answer.body?.cancel().catch(() => {})
          return gone.promise
        }
        // An answer its admitted work is still producing ends with that work.
        // Any other still streaming at the cut is only output, like an MCP
        // call's event stream, and would hold the listener open past any
        // grace. An answer given after the cut is a finished write's, whole.
        if (cut.signal.aborted) return response(answer)
        let quiet = new AbortController()
        outputs.set(request, quiet)
        return response(answer, quiet.signal)
      }, (error) => {
        if (left) return gone.promise
        ended()
        throw error
      })
      return Promise.race([answered, gone.promise])
    },
    cancel: () => {
      cut.abort()
      for (let [request, quiet] of outputs) {
        if (!producing(request)) quiet.abort()
      }
    },
    drain: async () => {
      while (pending.size) await Promise.allSettled(pending)
      if (failures.length) {
        throw new AggregateError(failures, 'request drain failed')
      }
    },
  }
}
