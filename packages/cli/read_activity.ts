// A worker leaves its current operation in shared memory before entering it.
// Its owner can read it while the worker is blocked in a synchronous call,
// without waiting for that worker's event loop or a queued message.
import { channel, type Event } from '@yaks/trace'

/** A worker's current operation and when it entered it, by `clock` (ms since
 * the epoch, the one clock both threads share). */
export let readActivity = (
  buffer = new SharedArrayBuffer(16_400),
  clock = Date.now,
) => {
  let head = new Int32Array(buffer, 0, 2)
  let since = new Float64Array(buffer, 8, 1)
  let bytes = new Uint8Array(buffer, 16)
  let encoder = new TextEncoder(), decoder = new TextDecoder()
  return {
    buffer,
    say: (text: string) => {
      Atomics.add(head, 0, 1)
      let { written } = encoder.encodeInto(text, bytes)
      Atomics.store(head, 1, written)
      since[0] = clock()
      Atomics.add(head, 0, 1)
    },
    /** the operation, and how long the worker has been in it */
    read: (): { text: string; ms: number } | undefined => {
      // A concurrent update is retried a bounded number of times.
      for (let i = 0; i < 3; i++) {
        let version = Atomics.load(head, 0)
        if (version % 2) continue
        let value = bytes.slice(0, Atomics.load(head, 1)), at = since[0]
        if (version == Atomics.load(head, 0)) {
          return { text: decoder.decode(value), ms: clock() - at }
        }
      }
    },
  }
}

/** Keep only open operations, with every SQL value masked by its producer. */
export let readOperations = (
  graph: object,
  say: (text: string) => void,
): () => void => {
  let open = new Map<string, string>()
  return channel(graph).subscribe((event: Event) => {
    if (event.stage == 'instant') return
    if (event.stage == 'start') {
      open.set(
        event.id,
        `${event.kind} ${event.name}${event.sql ? `: ${event.sql}` : ''}`,
      )
    } else open.delete(event.id)
    let operation = [...open.values()].at(-1)
    say(operation ?? 'query returned; preparing its reply')
  }, { history: false })
}
