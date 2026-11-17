// A service hop can lose a request without answering or throwing. A read
// unanswered after five seconds is sent once more; the second call can take
// as long as it needs. Only the wait for headers is bounded, never a stream.
import { type Clock, system } from '@yaks/fp'

/** A service binding's fetch door. */
export type Bound = { fetch(req: Request): Promise<Response> }

/** Send an unanswered read once more, aborting the lost hop. Writes and
 * upgrades keep their one send, because replaying one can repeat its act. */
export let resending = async (
  door: Bound,
  req: Request,
  time: Clock = system,
  patience = 5000,
): Promise<Response> => {
  if (
    !['GET', 'HEAD'].includes(req.method) || req.headers.has('upgrade')
  ) return door.fetch(req)
  let late = false, stop = new AbortController()
  let expired = Promise.withResolvers<null>()
  let cancel = time.after(patience, () => {
    late = true
    expired.resolve(null)
    stop.abort()
  })
  let first = Promise.resolve().then(() =>
    door.fetch(
      new Request(req, {
        signal: AbortSignal.any([req.signal, stop.signal]),
      }),
    )
  ).then(async (answer) => {
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
