// Read requests can be cancelled; admitted writes finish before their graph
// closes. These lifetimes belong to the HTTP server, not its storage adapter.
import { Refused } from '@yaks/graph/errors'
import type { Handler } from './route.ts'

class Cancelled extends Refused {}

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

/** The work a listener admits: grace may cut reads, never an admitted write. */
export let requests = (handler: Handler) => {
  let reads = new AbortController()
  let writes = new Set<Promise<Response>>()
  return {
    handle: (request: Request) => {
      if (reading(request)) {
        let scoped = new Request(request, {
          signal: AbortSignal.any([request.signal, reads.signal]),
        })
        return receive(scoped, () => handler(scoped)).catch((error) => {
          if (error instanceof Cancelled) {
            return new Response(null, { status: 499 })
          }
          throw error
        })
      }
      let done = Promise.resolve().then(() => handler(request))
      writes.add(done)
      void done.then(() => writes.delete(done), () => writes.delete(done))
      return done
    },
    cancel: () => reads.abort(),
    drain: async () => {
      await Promise.allSettled(writes)
    },
  }
}
