// A pending handler is reported while it still has no answer. Reporting never
// cancels its work, and returning an answer ends the watch.
import { type Clock, system } from '@yaks/fp'

export let watch = <T>(
  run: () => T,
  report: (ms: number) => void,
  time: Clock = system,
): T => {
  let at = time.now()
  let cancel = time.after(60_000, () => report(time.now() - at))
  try {
    let result = run()
    if (result instanceof Promise) return result.finally(cancel) as T
    cancel()
    return result
  } catch (error) {
    cancel()
    throw error
  }
}

export let overdue = () => Error('Request has not answered for 60 seconds')
