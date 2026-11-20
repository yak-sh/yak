import type { Clock } from '@yaks/fp'

export class BrowserTimeout extends Error {
  constructor(stage: string, ms: number) {
    super(
      ms > 0
        ? `${stage} timed out after ${ms / 1000} seconds`
        : `${stage} could not start before the browser visit deadline`,
    )
  }
}

/** Give the current operation the deadline and stop starting work when it expires. */
export let bounded = async <T>(
  time: Clock,
  ms: number,
  stage: () => string,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  if (ms <= 0) throw new BrowserTimeout(stage(), 0)
  let stop = new AbortController()
  let cancel = () => {}
  let timeout = new Promise<never>((_, reject) => {
    cancel = time.after(ms, () => {
      let error = new BrowserTimeout(stage(), ms)
      reject(error)
      stop.abort(error)
    })
  })
  try {
    return await Promise.race([timeout, run(stop.signal)])
  } finally {
    cancel()
  }
}
