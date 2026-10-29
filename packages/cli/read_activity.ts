// A worker leaves its current operation in shared memory before entering it.
// Its owner can read it while the worker is blocked in a synchronous call,
// without waiting for that worker's event loop or a queued message.
import { channel, type Event } from '@yaks/trace'

export let readActivity = (buffer = new SharedArrayBuffer(16_392)) => {
  let head = new Int32Array(buffer, 0, 2)
  let bytes = new Uint8Array(buffer, 8)
  let encoder = new TextEncoder(), decoder = new TextDecoder()
  return {
    buffer,
    say: (text: string) => {
      Atomics.add(head, 0, 1)
      let { written } = encoder.encodeInto(text, bytes)
      Atomics.store(head, 1, written)
      Atomics.add(head, 0, 1)
    },
    read: (): string | undefined => {
      // A concurrent update is retried a bounded number of times.
      for (let i = 0; i < 3; i++) {
        let version = Atomics.load(head, 0)
        if (version % 2) continue
        let value = bytes.slice(0, Atomics.load(head, 1))
        if (version == Atomics.load(head, 0)) return decoder.decode(value)
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
