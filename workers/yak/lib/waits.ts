// Pending I/O belongs to the request awaiting it, even across nested tallies.
// Completed waits leave immediately; detached work runs outside this scope.
import { AsyncLocalStorage } from 'node:async_hooks'
import { type Clock, system } from '@yaks/fp'
import { answerBy } from '@yaks/workerd/fetch'

export type Wait = { name: string; ms: number }
type Scope = { time: Clock; pending: Map<object, { name: string; at: number }> }
let here = new AsyncLocalStorage<Scope>()

export let unwatched = <T>(run: () => T): T =>
  here.run(undefined as unknown as Scope, run)

export let waiting = async <T>(
  name: string,
  run: () => Promise<T>,
): Promise<T> => {
  let scope = here.getStore(), key = {}
  scope?.pending.set(key, { name, at: scope.time.now() })
  try {
    return await run()
  } finally {
    scope?.pending.delete(key)
  }
}

/** Answer with the elapsed time and pending waits if the handler stalls. */
export let watching = (
  run: (signal: AbortSignal) => Promise<Response>,
  ms: number,
  expired: (elapsed: number, waits: Wait[]) => Response,
  time: Clock = system,
): Promise<Response> => {
  let pending: Scope['pending'] = new Map()
  return here.run(
    { time, pending },
    () =>
      answerBy(run, ms, (elapsed) =>
        expired(
          elapsed,
          [...pending.values()].map((w) => ({
            name: w.name,
            ms: time.now() - w.at,
          })),
        ), time),
  )
}
