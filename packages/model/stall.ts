/**
 * How long a provider's stream may go quiet. A request whose connection, first
 * byte or any later gap in its stream goes that long without progress fails
 * as stalled, instead of waiting for ever on a server that stopped talking.
 *
 * ```ts
 * import { stallMs, watched } from '@yaks/model/stall'
 *
 * let ask = watched(fetch, stallMs({ stallTimeout: 60 }))
 * // a call through `ask` fails with `Stalled` after 60s without a byte
 * ```
 *
 * @module
 */

import { type Clock, system } from '@yaks/fp'

/** Seconds a stream may go without progress before its request fails as
 * stalled, where neither the request nor its provider's row names its own
 * (`Request.stallTimeout`, `provider{stall_timeout}`). Five minutes, the Codex
 * CLI's own stream idle timeout: a reasoning model can think in silence for
 * minutes, and none answers after hours. */
export const STALL_TIMEOUT = 300

/** The milliseconds a request's stream may stay quiet: its own
 * `stallTimeout`, else {@link STALL_TIMEOUT}. 0 waits for ever. */
export let stallMs = (req: { stallTimeout?: number }): number =>
  Math.max(0, req.stallTimeout ?? STALL_TIMEOUT) * 1000

/** What a stalled exchange's call or read fails with. */
export class Stalled extends Error {
  constructor(ms: number) {
    super(`no progress for ${ms / 1000}s`)
    this.name = 'Stalled'
  }
}

/** A resettable idle deadline for one exchange ({@link watchdog}). */
export type Watchdog = {
  /** aborted when the deadline passes, or when the relayed stop does */
  signal?: AbortSignal
  /** push the deadline `ms` out from now */
  kick: () => void
  /** hold the deadline while the waiting is not the source's */
  rest: () => void
  /** whether the deadline passed (a relayed stop leaves this false) */
  stalled: () => boolean
  close: () => void
}

/** A resettable idle deadline for one exchange. It aborts its own signal,
 * never the caller's `stop`, when `ms` passes with no progress, and each sign
 * of progress calls kick() to push the deadline out. The caller reads
 * stalled() to turn that self-abort into a named failure instead of a silent
 * hang. A relayed stop aborts too, with its own reason, but leaves stalled()
 * false so the caller keeps its own path. `ms` 0 sets no deadline. */
export let watchdog = (
  ms: number,
  clock: Clock = system,
  stop?: AbortSignal,
): Watchdog => {
  // With no deadline and nothing to relay, there is nothing to abort. A relayed
  // stop still goes through a signal of its own, so it arrives as an abort.
  if (!ms && !stop) {
    return {
      signal: undefined,
      kick: () => {},
      rest: () => {},
      stalled: () => false,
      close: () => {},
    }
  }
  let control = new AbortController()
  let stalled = false
  let cancel = () => {}
  let relay = () => control.abort(stop?.reason)
  let rest = () => {
    cancel()
    cancel = () => {}
  }
  let kick = () => {
    if (!ms || control.signal.aborted) return
    cancel()
    cancel = clock.after(ms, () => {
      stalled = true
      control.abort(new Stalled(ms))
    })
  }
  if (stop?.aborted) control.abort(stop.reason)
  else stop?.addEventListener('abort', relay, { once: true })
  kick()
  return {
    signal: control.signal,
    kick,
    rest,
    stalled: () => stalled,
    close: () => {
      rest()
      stop?.removeEventListener('abort', relay)
    },
  }
}

// `body` read under `dog`: only the wait on the source counts, so the deadline
// runs from each read asked for to the chunk that answers it, and a reader
// slow to ask again is not a stalled server. A trip fails the read in progress
// with Stalled, a relayed stop with its reason, and either cancels the source.
let guard = (
  body: ReadableStream<Uint8Array>,
  dog: Watchdog,
): ReadableStream<Uint8Array> => {
  let signal = dog.signal!
  let reader = body.getReader()
  let end = () => {}
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let fail = () => {
        controller.error(signal.reason)
        reader.cancel(signal.reason).catch(() => {})
      }
      if (signal.aborted) return fail()
      signal.addEventListener('abort', fail, { once: true })
      end = () => {
        signal.removeEventListener('abort', fail)
        dog.close()
      }
      dog.rest()
    },
    async pull(controller) {
      dog.kick()
      let part: ReadableStreamReadResult<Uint8Array>
      try {
        part = await reader.read()
      } catch (error) {
        if (signal.aborted) return
        end()
        return controller.error(error)
      }
      // A trip already ended the stream; what the source said after is
      // nobody's.
      if (signal.aborted) return
      if (part.done) {
        end()
        controller.close()
      } else {
        dog.rest()
        controller.enqueue(part.value)
      }
    },
    cancel(reason) {
      end()
      return reader.cancel(reason)
    },
  }, { highWaterMark: 0 })
}

/** `body`, failing with {@link Stalled} once a read waits `ms` on it, or with
 * `stop`'s reason when it aborts. `ms` 0 and no `stop` leave it as it is. */
export let watchedBody = (
  body: ReadableStream<Uint8Array>,
  ms: number,
  clock: Clock = system,
  stop?: AbortSignal,
): ReadableStream<Uint8Array> => {
  let dog = watchdog(ms, clock, stop)
  return dog.signal ? guard(body, dog) : body
}

/** `fetch` whose every exchange is watched: the connection and the head get
 * `ms` to arrive, then each read of the body gets `ms` for its next chunk.
 * Passing a deadline aborts the exchange and fails the waiting call or read
 * with {@link Stalled}; the caller's own signal still stops it with its own
 * reason. `ms` 0 leaves `fetch` as it is. */
export let watched = (
  fetch: typeof globalThis.fetch,
  ms: number,
  clock: Clock = system,
): typeof globalThis.fetch =>
  !ms ? fetch : async (input, init) => {
    let stop = init?.signal ??
      (input instanceof Request ? input.signal : undefined)
    let dog = watchdog(ms, clock, stop)
    let response: Response
    try {
      response = await fetch(input, { ...init, signal: dog.signal })
    } catch (error) {
      dog.close()
      throw dog.stalled() ? new Stalled(ms) : error
    }
    if (!response.body) {
      dog.close()
      return response
    }
    let answer = new Response(guard(response.body, dog), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
    Object.defineProperty(answer, 'url', { value: response.url })
    return answer
  }
