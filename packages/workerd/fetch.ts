// A service hop can lose a request without answering or throwing. A read
// unanswered after five seconds is sent once more. Its caller owns the
// overall response deadline.
import { type Clock, system } from '@yaks/fp'

/** A service binding's fetch door. */
export type Bound = {
  fetch(req: Request, init?: Pick<RequestInit, 'signal'>): Promise<Response>
}

let readable = (req: Request) =>
  (req.method == 'GET' || req.method == 'HEAD') && !req.headers.has('upgrade')

/** Answer by a wall-clock deadline. An answer that arrives later has no
 * reader. A response that arrives in time keeps its own body lifetime. */
export let answerBy = async (
  run: (signal: AbortSignal) => Promise<Response>,
  ms: number,
  expired: (elapsed: number) => Response,
  time: Clock = system,
): Promise<Response> => {
  let at = time.now()
  let late = false
  let stop = new AbortController()
  let end = Promise.withResolvers<Response>()
  let cancel = time.after(ms, () => {
    late = true
    try {
      end.resolve(expired(time.now() - at))
    } catch (error) {
      end.reject(error)
    } finally {
      stop.abort()
    }
  })
  try {
    let answer = run(stop.signal).then((response) => {
      if (late) void response.body?.cancel().catch(() => {})
      return response
    })
    return await Promise.race([answer, end.promise])
  } finally {
    cancel()
  }
}

/** Stop waiting and abort the forwarded request when its caller leaves or the
 * deadline expires. The work decides whether headers or a body end the wait. */
export let before = async <T>(
  req: Request,
  ms: number,
  timeout: Error,
  run: (req: Request) => Promise<T>,
  time: Clock = system,
): Promise<T> => {
  req.signal.throwIfAborted()
  let stop = new AbortController()
  let ended = Promise.withResolvers<never>()
  let leave = () => ended.reject(req.signal.reason)
  let cancel = time.after(ms, () => {
    ended.reject(timeout)
    stop.abort(timeout)
  })
  req.signal.addEventListener('abort', leave, { once: true })
  try {
    let signal = AbortSignal.any([req.signal, stop.signal])
    return await Promise.race([
      ended.promise,
      run(new Request(req, { signal })),
    ])
  } finally {
    cancel()
    req.signal.removeEventListener('abort', leave)
  }
}

/** Send an unanswered read once more, aborting the lost hop. Writes and
 * upgrades keep their one send, because replaying one can repeat its act. */
export let resending = async (
  door: Bound,
  req: Request,
  time: Clock = system,
  patience = 5000,
): Promise<Response> => {
  if (!readable(req)) return door.fetch(req)
  let late = false, stop = new AbortController()
  let expired = Promise.withResolvers<null>()
  let cancel = time.after(patience, () => {
    late = true
    expired.resolve(null)
    stop.abort()
  })
  let first = Promise.resolve().then(() => {
    let signal = AbortSignal.any([req.signal, stop.signal])
    return door.fetch(new Request(req, { signal }), { signal })
  }).then(async (answer) => {
    if (!late) return answer
    await answer.body?.cancel()
    return null
  }, (error) => {
    if (!late) throw error
    return null
  })
  let answer = await Promise.race([first, expired.promise]).finally(cancel)
  if (answer) return answer
  req.signal.throwIfAborted()
  return door.fetch(req)
}

/** Give a read one more route to an answer after its grace period. The first
 * answer wins, even if it is the original read finishing during the retry.
 * Cancel the other hop and discard its response if the binding still sends it. */
export let hedged = async (
  door: Bound,
  req: Request,
  grace: number,
  time: Clock = system,
): Promise<Response> => {
  if (!readable(req)) return door.fetch(req)
  req.signal.throwIfAborted()
  let flights: { stop: AbortController; answer: Promise<Response> }[] = []
  let send = () => {
    let stop = new AbortController()
    let signal = AbortSignal.any([req.signal, stop.signal])
    let answer = Promise.resolve().then(() => {
      signal.throwIfAborted()
      return door.fetch(new Request(req, { signal }), { signal })
    })
    flights.push({ stop, answer })
    return answer.then((response) => ({ stop, response }))
  }
  let first = send()
  let elapsed = Promise.withResolvers<null>()
  let cancel = time.after(grace, () => elapsed.resolve(null))
  let left = Promise.withResolvers<never>()
  let leave = () => left.reject(req.signal.reason)
  req.signal.addEventListener('abort', leave, { once: true })
  let won: AbortController | undefined
  try {
    let early = await Promise.race([first, elapsed.promise, left.promise])
    let kept = early ?? await Promise.race([
      Promise.any([first, send()]),
      left.promise,
    ])
    won = kept.stop
    return kept.response
  } finally {
    cancel()
    req.signal.removeEventListener('abort', leave)
    for (let { stop, answer } of flights) {
      if (stop == won) continue
      stop.abort()
      void answer.then((r) => r.body?.cancel()).catch(() => {})
    }
  }
}
