// Only the poll's signed network doors run here. Graph reconciliation stays on
// its host; signing, fetch, body reads and attempt deadlines share no event
// loop with its SQL/effect work.
import type { Doors } from './poll.ts'
import type { Remote } from './remote.ts'
import type { Read } from './routes.ts'
import type { Mark } from './letter.ts'

export type Said =
  | { start: Remote }
  | { id: number; params: string }
  | { id: number; bug: string; name: Mark; said: Record<string, string> }
  | { abort: number }

export type Heard =
  | { id: number; value: unknown }
  | { id: number; error: { name: string; message: string } }

/** Signed poll doors with their own event loop. Close owns and terminates only
 * this worker, rejecting outstanding reads and marks. A failed worker is
 * replaced on the next poll, never by retrying an ambiguous mark here. */
export let pollThread = (remote: Remote): Doors & { close: () => void } => {
  let worker: Worker | undefined
  let closed = false, next = 0
  let pending = new Map<number, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    clean: () => void
  }>()
  let fail = (error: Error) => {
    worker?.terminate()
    worker = undefined
    for (let p of pending.values()) {
      p.clean()
      p.reject(error)
    }
    pending.clear()
  }
  let start = () => {
    if (worker) return worker
    let w = new Worker(new URL('./poll_worker.ts', import.meta.url), {
      type: 'module',
    })
    worker = w
    w.onmessage = ({ data }: MessageEvent<Heard>) => {
      let p = pending.get(data.id)
      if (!p) return
      pending.delete(data.id)
      p.clean()
      if ('error' in data) {
        let error = new Error(data.error.message)
        error.name = data.error.name
        p.reject(error)
      } else p.resolve(data.value)
    }
    w.onerror = (event) => {
      event.preventDefault()
      fail(new Error('Remote tracker poll worker failed'))
    }
    w.postMessage({ start: remote } satisfies Said)
    return w
  }
  let ask = (
    call: { params: string } | {
      bug: string
      name: Mark
      said: Record<string, string>
    },
    signal?: AbortSignal,
  ): Promise<unknown> => {
    if (closed) {
      return Promise.reject(new Error('Remote tracker poll is closed'))
    }
    if (signal?.aborted) return Promise.reject(signal.reason)
    return new Promise((resolve, reject) => {
      let id = ++next
      let abort = () => {
        worker?.postMessage({ abort: id } satisfies Said)
        pending.delete(id)
        clean()
        reject(signal!.reason)
      }
      let clean = () => signal?.removeEventListener('abort', abort)
      try {
        let w = start()
        pending.set(id, { resolve, reject, clean })
        signal?.addEventListener('abort', abort, { once: true })
        w.postMessage({ ...call, id } satisfies Said)
      } catch {
        fail(new Error('Remote tracker poll worker failed'))
        reject(new Error('Remote tracker poll worker failed'))
      }
    })
  }
  return {
    bugs: (params, signal) =>
      ask({ params: params.toString() }, signal) as Promise<Read>,
    mark: (bug, name, said) => ask({ bug, name, said }),
    close: () => {
      closed = true
      fail(new Error('Remote tracker poll is closed'))
    },
  }
}
