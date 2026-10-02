import type { Access, Eid } from '@yaks/graph'
import { type PortLink, portLink } from '@yaks/sync'
import { serve } from './graph.ts'
import type { Start } from './types.ts'

/** Duties handed to a thread, separate from the graph's owning thread. */
export type Thread = {
  me: Eid
  duties: (signal: AbortSignal) => Promise<void>
  nudge: () => void
  close: () => Promise<void>
}

/** The roles and cloneable data a thread's opening module receives. A graph
 * here is served over a port; otherwise the module opens its own connection. */
export type Plan<T> = { roles: string[]; data: T; graph?: Access }
/** A lazy thread that can be planned or terminated by its owner. */
export type Aside<T> = Thread & {
  plan: (plan: Plan<T>) => void
  end: () => void
}

/** Worker location for runtimes that bundle the package. */
export type ThreadOpts = {
  /** URL of the bundled ./worker entry point in a browser deployment. */
  worker?: string | URL
}

/** Plan now, start when duties are asked for. `module` exports `open(start)`;
 * the same lifecycle runs with a browser Worker or a Deno Worker. */
export let thread = <T = unknown>(
  module: string | URL,
  opts: ThreadOpts = {},
): Aside<T> => {
  let me = crypto.randomUUID() as Eid
  let worker: Worker | undefined
  let link: PortLink | undefined
  let graphLink: PortLink | undefined
  let graphPort: MessagePort | undefined
  let planned = Promise.withResolvers<Plan<T> | undefined>()
  planned.promise.catch(() => {})
  let over = false
  let born = false
  let busy = false
  let closing: Promise<void> | undefined
  let end = (
    error = new Error('the duty thread was ended before it closed'),
  ) => {
    over = true
    planned.reject(error)
    link?.close(error)
    graphLink?.close(error)
    graphPort?.close()
    worker?.terminate()
    worker = undefined
  }
  let spawn = (plan: Plan<T>) => {
    if (over || worker || !plan.roles.length) return
    born = true
    worker = new Worker(
      opts.worker ?? new URL('./worker.ts', import.meta.url),
      {
        type: 'module',
      },
    )
    worker.onerror = (event) => {
      event.preventDefault()
      end(event.error instanceof Error ? event.error : new Error(event.message))
    }
    link = portLink(worker)
    let start: Start<T> = {
      module: String(module),
      me,
      roles: plan.roles,
      data: plan.data,
    }
    let transfer: Transferable[] = []
    if (plan.graph) {
      let { port1, port2 } = new MessageChannel()
      graphPort = port1
      graphLink = serve(port1, plan.graph)
      start.port = port2
      transfer.push(port2)
    }
    worker.postMessage({ start }, transfer)
  }
  let ask = async (method: string, started?: () => void) => {
    let plan = await planned.promise
    if (!plan) return
    if (over) throw new Error('the duty thread has ended')
    try {
      spawn(plan)
      if (!worker) return
      let running = link!.request(method, undefined, { timeout: null })
      started?.()
      await running
    } catch (error) {
      end(error instanceof Error ? error : new Error(String(error)))
      throw error
    }
  }
  return {
    me,
    plan: (plan) => planned.resolve(plan),
    duties: async (signal) => {
      if (busy) throw new Error('the thread is already serving duties')
      busy = true
      let stop = () => {
        void link?.request('stop', undefined, { timeout: null }).catch((
          error,
        ) => end(error))
      }
      try {
        if (signal.aborted) return await ask('pass')
        signal.addEventListener('abort', stop, { once: true })
        await ask('live', () => {
          if (signal.aborted) stop()
        })
      } finally {
        signal.removeEventListener('abort', stop)
        busy = false
      }
    },
    nudge: () => {
      void link?.request('nudge', undefined, { timeout: null }).catch((error) =>
        end(error)
      )
    },
    end: () => end(),
    close: () =>
      closing ??= (async () => {
        planned.resolve(undefined)
        if (!born) {
          end()
          return
        }
        try {
          if (over) throw new Error('the duty thread ended before closing')
          await link!.request('close', undefined, { timeout: null })
        } finally {
          end()
        }
      })(),
  }
}
