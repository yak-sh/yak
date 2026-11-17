// Replayable tracker calls take a fresh stub after the runtime loses a call
// or moves its object. Only a failure that outlasts the backoff reaches callers.
import { evicted, opaque, retried } from '@yaks/durable-object'

export let calling = <Stub>(
  trackers: { getByName: (scope: string) => Stub },
  wait?: (ms: number) => Promise<void>,
) =>
<T>(scope: string, use: (stub: Stub) => Promise<T>): Promise<T> =>
  retried(
    () => use(trackers.getByName(scope)),
    true,
    (error) => evicted(error) || opaque(error),
    wait,
  )
