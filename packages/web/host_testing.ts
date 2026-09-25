// A host the test speaks for, on the socket live.ts dials: it keeps what the
// page asks on the wire ({subscribe, id}, {unsubscribe}) and lands the frames
// the test answers with. `answer` sees each subscribe and may return the frame
// that goes back for it; `say` sends any frame later. A new socket means a new
// replica, so installing one (and free()) starts the page's box afresh.
import type { Frame, Socket } from '@yaks/sync'
import { cache, useSocket } from './live.ts'

export type Ask = { subscribe: string; id: string }
type Heard = (e: Event & { data?: unknown }) => void

export let host = (answer?: (a: Ask) => Omit<Frame, 'id'> | undefined) => {
  let sent: Record<string, unknown>[] = []
  let heard: Heard[] = []
  let say = (f: Frame) => {
    for (let fn of heard) {
      fn({ data: JSON.stringify(f) } as Event & { data: string })
    }
  }
  let prior = useSocket((): Socket => {
    heard = []
    return {
      readyState: 1,
      send: (text) => {
        let m = JSON.parse(text)
        sent.push(m)
        let f = typeof m.subscribe == 'string' ? answer?.(m) : undefined
        if (f) queueMicrotask(() => say({ ...f, id: m.id }))
      },
      close: () => {},
      addEventListener: (type, fn) => {
        if (type == 'message') heard.push(fn)
      },
    }
  })
  cache.value = { ...cache.peek() }
  return {
    sent,
    asked: () => sent.filter((m): m is Ask => typeof m.subscribe == 'string'),
    say,
    free: () => {
      useSocket(prior)
      cache.value = { ...cache.peek() }
    },
  }
}
