// This worker opens no graph, services or reporting loop. Credentials stay in
// its messages and never in a worker URL or an error.
import { signed } from './poll.ts'
import type { Doors } from './poll.ts'
import type { Heard, Said } from './poll_thread.ts'

let doors: Doors
let running = new Map<number, AbortController>()
let tell = (value: Heard) => self.postMessage(value)
self.onmessage = ({ data }: MessageEvent<Said>) => {
  if ('start' in data) {
    doors = signed(data.start)
    return
  }
  if ('abort' in data) {
    running.get(data.abort)?.abort()
    return
  }
  let stop = new AbortController()
  running.set(data.id, stop)
  void (async () => {
    try {
      let value = 'params' in data
        ? await doors.bugs(new URLSearchParams(data.params), stop.signal)
        : await doors.mark(data.bug, data.name, data.said)
      tell({ id: data.id, value })
    } catch (error) {
      // The signed doors already redact transport errors and remote addresses.
      tell({
        id: data.id,
        error: {
          name: error instanceof Error ? error.name : 'Error',
          message: error instanceof Error
            ? error.message
            : 'Remote tracker is unavailable',
        },
      })
    } finally {
      running.delete(data.id)
    }
  })()
}
