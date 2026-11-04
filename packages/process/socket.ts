// A byte connection. Callers own framing and deadlines; the boundary owns I/O.
import { createConnection } from 'node:net'
import { Readable } from 'node:stream'

export type Connection = {
  read: (buffer: Uint8Array) => Promise<number | null>
  write: (bytes: Uint8Array) => Promise<number>
  close: () => void
}

export let isConnectionRefused = (error: unknown): boolean => {
  let e = error as { code?: string; name?: string } | undefined
  return e?.code == 'ECONNREFUSED' || e?.name == 'ConnectionRefused'
}

/** Connect to an operating-system socket; protocols stay with the caller. */
export let connect = async (
  options: { transport: 'unix'; path: string },
): Promise<Connection> => {
  let socket = createConnection({ path: options.path })
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })
  let reader = (Readable.toWeb(socket) as ReadableStream<Uint8Array>)
    .getReader()
  let held: Uint8Array = new Uint8Array(0)
  return {
    read: async (buffer) => {
      if (!held.length) {
        let next = await reader.read()
        if (next.done) return null
        held = next.value
      }
      let count = Math.min(buffer.length, held.length)
      buffer.set(held.subarray(0, count))
      held = held.subarray(count)
      return count
    },
    write: (bytes) =>
      new Promise((resolve, reject) => {
        socket.write(bytes, (error) =>
          error ? reject(error) : resolve(bytes.length))
      }),
    close: () => {
      socket.destroy()
    },
  }
}
