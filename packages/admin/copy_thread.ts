// Only pages and progress cross back to the serving thread. The copy's SQLite
// connection, commits, index builds and close all belong to its worker.
import { type Port, portLink } from '@yaks/sync/port'
import type { copy } from './copy.ts'
import { CallError, Interrupted } from '@yaks/tools/errors'

// Refusals and deliberate interruptions remain expected invocation outcomes
// after travelling through the worker; ordinary failures keep their stack.
export let copyErrors = {
  encodeError: (error: unknown) =>
    error instanceof Error
      ? {
        ...error,
        name: error.name,
        message: error.message,
        stack: error.stack,
      }
      : { name: 'Error', message: String(error) },
  decodeError: (value: unknown): Error => {
    let e = value as { name: string; message: string; code?: string }
    return Object.assign(
      e.name == 'Interrupted'
        ? new Interrupted(e.message, e.code)
        : e.name == 'CallError'
        ? new CallError(e.code!, e.message)
        : new Error(e.message),
      value,
    )
  },
}

export type CopyPlan = {
  spaces: { eid: string; slug: string }[]
  to: string
}

export type CopyPage = {
  space: string
  asked: { table?: string; after?: number }
}

type Thread = Port & { terminate: () => void }

export let copyThread = async (
  o: Omit<Parameters<typeof copy>[0], 'open'> & { to: string },
  start: () => Thread = () =>
    new Worker(new URL('./copy_worker.ts', import.meta.url), {
      type: 'module',
    }),
): Promise<void> => {
  if (o.stopping.aborted) throw new Interrupted('the copy was interrupted')
  let worker = start()
  let link = portLink(worker, {
    ...copyErrors,
    receive: (method, value) => {
      if (method == 'out') return o.out(String(value))
      if (method != 'page') throw new Error(`unknown copy request: ${method}`)
      let { space, asked } = value as CopyPage
      return o.page(space, asked)
    },
  })
  let failed = (event: Event) => {
    event.preventDefault()
    link.close(new Error((event as ErrorEvent).message))
  }
  worker.addEventListener('error', failed)
  // Let an in-flight commit release its file before ending the worker.
  let stop = () => {
    void link.request('stop', undefined, { timeout: null }).catch(() => {})
  }
  o.stopping.addEventListener('abort', stop, { once: true })
  try {
    await link.request(
      'run',
      {
        spaces: o.spaces,
        to: o.to,
      } satisfies CopyPlan,
      { timeout: null },
    )
  } finally {
    o.stopping.removeEventListener('abort', stop)
    worker.removeEventListener('error', failed)
    link.close()
    worker.terminate()
  }
}
