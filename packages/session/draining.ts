import { type Clock, system } from '@yaks/fp'

/** A worker kept its current step through the shutdown grace. The next
 * worker recovers the admitted request from the transcript. */
export class StepHandoff extends Error {
  constructor() {
    super('Worker is handing its session step back')
  }
}

/** Stop a step after a short grace for its reply to land. */
export let draining = (
  stop: AbortSignal | undefined,
  step: AbortController,
  clock: Clock = system,
) => {
  let cancel = () => {}
  let leave = () =>
    cancel = clock.after(10_000, () => step.abort(new StepHandoff()))
  stop?.addEventListener('abort', leave, { once: true })
  if (stop?.aborted) leave()
  return () => {
    stop?.removeEventListener('abort', leave)
    cancel()
  }
}
