// Spawning can sleep in kernel_clone even with asynchronous child streams.
// One shared thread owns detached launches; callers only send command data.
import { Worker } from 'node:worker_threads'
import type { CommandOptions } from './command.ts'
import { fileURLToPath } from 'node:url'

/** A launch with no streams or channel held by its caller. */
export type DetachedOptions = Pick<
  CommandOptions,
  | 'args'
  | 'cwd'
  | 'env'
  | 'clearEnv'
  | 'uid'
  | 'gid'
  | 'detached'
  | 'windowsRawArguments'
>
export type Launch = { id: number; program: string; options: DetachedOptions }
export type Launched = { id: number; error?: Error }

type Thread = Pick<Worker, 'postMessage' | 'ref' | 'unref' | 'terminate'> & {
  on(event: 'message', listener: (message: Launched) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
}

/** A reusable command door. Its thread holds the caller open only while a
 * launch is outstanding; a failed thread rejects every waiter and the next
 * request gets a fresh one. */
export let detaching = (
  start: () => Thread = () =>
    new Worker(new URL('./detached_worker.ts', import.meta.url)),
): (program: string, options?: DetachedOptions) => Promise<void> => {
  let worker: Thread | undefined
  let serial = 0
  let pending = new Map<number, {
    resolve: () => void
    reject: (error: Error) => void
  }>()
  let open = () => {
    if (worker) return worker
    let w = start()
    worker = w
    let fail = (error: Error) => {
      if (worker !== w) return
      worker = undefined
      if (!pending.size) reportError(error)
      for (let p of pending.values()) p.reject(error)
      pending.clear()
      void w.terminate()
    }
    w.on('error', fail)
    w.on('exit', (code) => fail(new Error(`command thread exited (${code})`)))
    w.on('message', ({ id, error }: Launched) => {
      let p = pending.get(id)
      if (!p) return
      pending.delete(id)
      if (!pending.size) w.unref()
      if (error) p.reject(error)
      else p.resolve()
    })
    return w
  }
  return (program, options = {}) =>
    new Promise<void>((resolve, reject) => {
      let id = ++serial
      try {
        let w = open()
        pending.set(id, { resolve, reject })
        w.ref()
        w.postMessage(
          {
            id,
            program,
            options: options.cwd instanceof URL
              ? { ...options, cwd: fileURLToPath(options.cwd) }
              : options,
          } satisfies Launch,
        )
      } catch (error) {
        pending.delete(id)
        if (!pending.size) worker?.unref()
        reject(error)
      }
    })
}

export let detached: (
  program: string,
  options?: DetachedOptions,
) => Promise<void> = detaching()
