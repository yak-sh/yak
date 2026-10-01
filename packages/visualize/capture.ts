/** A bounded finite observation for commands and tools. */
import { type Activity, observe } from './activity.ts'
import { bounded } from './snapshot.ts'

export let DEFAULT_LIMIT = 256
export let MAX_LIMIT = 256
export let MAX_WAIT = 2000
export type Capture = {
  epoch: string
  events: Activity[]
  /** Known records omitted by the limit or overwritten during this capture. */
  gap: number
  coverage: 'process-local'
}
export type CaptureOptions = {
  limit?: number
  wait?: number
  signal?: AbortSignal
}

export let capture = async (
  graph: object,
  opts: CaptureOptions = {},
): Promise<Capture> => {
  let limit = bounded(opts.limit, DEFAULT_LIMIT, MAX_LIMIT)
  let wait = Math.min(MAX_WAIT, Math.max(0,
    Number.isFinite(opts.wait) ? opts.wait! : 0))
  if (opts.signal?.aborted) throw opts.signal.reason
  let observation = observe(graph)
  let before = observation.history()
  let first = before[0]?.seq ?? 1
  try {
    if (opts.signal?.aborted) throw opts.signal.reason
    if (wait) {
      await new Promise<void>((resolve, reject) => {
        let done = () => {
          clearTimeout(timer)
          opts.signal?.removeEventListener('abort', abort)
          resolve()
        }
        let abort = () => {
          clearTimeout(timer)
          opts.signal?.removeEventListener('abort', abort)
          reject(opts.signal?.reason)
        }
        let timer = setTimeout(done, wait)
        opts.signal?.addEventListener('abort', abort, { once: true })
      })
    }
    let events = observation.history(limit)
    let last = events.at(-1)?.seq
    return {
      epoch: observation.epoch,
      events,
      gap: last == undefined ? 0 : Math.max(0, last - first + 1 - events.length),
      coverage: 'process-local',
    }
  } finally {
    observation.close()
  }
}
