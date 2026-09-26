// A host the test speaks for, on the socket live.ts dials: it keeps what the
// page asks on the wire ({subscribe, id}, {unsubscribe}) and lands the frames
// the test answers with. `answer` sees each subscribe and may return the frame
// that goes back for it; `say` sends any frame later and resolves once it has
// landed, a timer turn on (T-37445), and `drop` loses the connection. The
// socket opens a turn after it is dialed, as a browser's does.
// A new socket means a new replica, so installing one (and free()) starts the
// page's box afresh.
import type { Bundle } from '@yaks/graph'
import { matcher } from '@yaks/match'
import type { Frame, Socket } from '@yaks/sync'
import { compute } from '@yaks/task'
import { cache, useSocket } from './live.ts'
import { tick } from './testing.ts'
import { vocab } from './types.ts'

/** The rows a server answers a line with, in the order it takes a window in:
 * @yaks/match reads the line over `rows`, and its parity tests hold it to
 * @yaks/sql. */
export let reader = (rows: Bundle[]) => (line: string): Bundle[] =>
  matcher(line, vocab, { computed: compute() })(rows)

export type Ask = { subscribe: string; id: string }
type Heard = (e: Event & { data?: unknown }) => void

export let host = (answer?: (a: Ask) => Omit<Frame, 'id'> | undefined) => {
  let sent: Record<string, unknown>[] = []
  let heard = new Map<string, Heard[]>()
  let socket: Socket | undefined
  let dials = 0
  let fire = (type: string, data?: string) => {
    for (let fn of heard.get(type) ?? []) {
      fn({ data } as Event & { data?: string })
    }
  }
  let say = (f: Frame) => {
    fire('message', JSON.stringify(f))
    return tick()
  }
  let prior = useSocket((): Socket => {
    dials++
    heard = new Map()
    let s: Socket = {
      readyState: 0,
      send: (text) => {
        let m = JSON.parse(text)
        sent.push(m)
        let f = typeof m.subscribe == 'string' ? answer?.(m) : undefined
        if (f) queueMicrotask(() => say({ ...f, id: m.id }))
      },
      close: () => {},
      addEventListener: (type, fn) => {
        heard.set(type, [...heard.get(type) ?? [], fn])
      },
    }
    queueMicrotask(() => {
      if (socket != s) return
      s.readyState = 1
      fire('open')
    })
    return socket = s
  })
  cache.value = { ...cache.peek() }
  return {
    sent,
    asked: () => sent.filter((m): m is Ask => typeof m.subscribe == 'string'),
    say,
    dials: () => dials,
    drop: () => {
      socket!.readyState = 3
      fire('close')
    },
    free: () => {
      useSocket(prior)
      cache.value = { ...cache.peek() }
    },
  }
}
