// Retry a model request only while its answer is still private. The provider
// classifies recoverable failures; the runner owns how long to keep trying.
// An audio request may have generated paid media even when its reply was lost.
// Once the attempts are spent the failure is still the provider's: it keeps
// its code and its `retry`, so the caller records what the provider said.

import { type Model, ModelError, type Reply, type Request } from '@yaks/model'

export type Pause = (ms: number) => Promise<void> | void

let wait = (ms: number, signal?: AbortSignal, pause?: Pause) =>
  new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted()
    let timer: ReturnType<typeof setTimeout> | undefined
    let close = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
    let abort = () => {
      close()
      reject(signal?.reason)
    }
    let done = () => {
      close()
      resolve()
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (pause) {
      Promise.resolve().then(() => pause(ms)).then(done, (error) => {
        close()
        reject(error)
      })
    } else timer = setTimeout(done, ms)
  })

export let ask = async (
  model: Model,
  request: Request,
  stopping?: AbortSignal,
  pause?: Pause,
): Promise<Reply> => {
  let exposed = false
  let req = {
    ...request,
    onText: request.onText &&
      ((delta: Parameters<NonNullable<Request['onText']>>[0]) => {
        exposed = true
        request.onText?.(delta)
      }),
  }
  let signal = request.signal && stopping
    ? AbortSignal.any([request.signal, stopping])
    : request.signal ?? stopping
  for (let attempt = 1;; attempt++) {
    signal?.throwIfAborted()
    try {
      return await model(req)
    } catch (error) {
      if (
        !(error instanceof ModelError) || !error.retry || exposed ||
        request.modalities?.includes('audio') ||
        signal?.aborted
      ) throw error
      if (attempt >= 3) {
        throw new ModelError(
          error.code,
          `Model request failed after ${attempt} attempts (${error.code}): ${error.message}`,
          error.retry,
        )
      }
      await wait(
        Math.max(
          Math.min(1000 * 4 ** (attempt - 1), 60_000),
          error.retry.after ?? 0,
        ),
        signal,
        pause,
      )
    }
  }
}
