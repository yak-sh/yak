/** Ordered RPC and subscription frames over a Worker or MessagePort.
 * Ports are owned by the caller; closing the link removes its listeners.
 */
import type { Frame } from './socket.ts'
export type Port = Pick<
  MessagePort,
  'postMessage' | 'addEventListener' | 'removeEventListener'
>
type Packet = {
  channel: 'yaks'
  id?: number
  method?: string
  value?: unknown
  error?: string
  frame?: Frame
  closed?: boolean
}
/** One end of a link: what it has carried, and the three things it can do. */
export type PortLink = {
  stats: { sent: number; received: number; frames: number }
  request: (method: string, value?: unknown) => Promise<unknown>
  frame: (frame: Frame) => void
  close: (reason?: Error) => void
}
export let portLink = (port: Port, opts: {
  receive?: (method: string, value: unknown) => unknown | Promise<unknown>
  frame?: (frame: Frame) => void
  report?: (error: unknown) => void
  timeout?: number
  /** Maximum outstanding requests before callers must wait. */
  maxPending?: number
} = {}): PortLink => {
  let next = 0, closed = false
  let stats = { sent: 0, received: 0, frames: 0 }
  let held = new Map<
    number,
    {
      resolve: (v: unknown) => void
      reject: (e: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  let send = (packet: Omit<Packet, 'channel'>) => {
    if (closed) return
    stats.sent++
    port.postMessage({ channel: 'yaks', ...packet })
  }
  let onMessage = (event: Event) => {
    let packet = (event as MessageEvent<Packet>).data
    if (packet?.channel != 'yaks' || closed) return
    if (packet.closed) {
      close(new Error('Peer disconnected'), false)
      return
    }
    stats.received++
    if (packet.frame) {
      stats.frames++
      opts.frame?.(packet.frame)
      return
    }
    if (packet.method) {
      Promise.resolve().then(() => {
        if (!opts.receive) throw new Error('No request handler')
        return opts.receive(packet.method!, packet.value)
      }).then(
        (value) => send({ id: packet.id, value }),
        (error) => {
          opts.report?.(error)
          return send({
            id: packet.id,
            error: error instanceof Error
              ? error.stack ?? error.message
              : String(error),
          })
        },
      ).catch((error) => opts.report?.(error))
      return
    }
    let pending = held.get(packet.id!)
    if (!pending) return
    held.delete(packet.id!)
    clearTimeout(pending.timer)
    if (packet.error) pending.reject(new Error(packet.error))
    else pending.resolve(packet.value)
  }
  let close = (reason = new Error('Message link closed'), notify = true) => {
    if (closed) return
    if (notify) {
      try {
        send({ closed: true })
      } catch { /* disconnected */ }
    }
    closed = true
    port.removeEventListener('message', onMessage)
    port.removeEventListener('messageerror', disconnected)
    port.removeEventListener('error', disconnected)
    port.removeEventListener('close', disconnected)
    for (let pending of held.values()) {
      clearTimeout(pending.timer)
      pending.reject(reason)
    }
    held.clear()
  }
  let disconnected = () =>
    close(new Error('Message transport disconnected'), false)
  port.addEventListener('messageerror', disconnected)
  port.addEventListener('error', disconnected)
  port.addEventListener('close', disconnected)
  port.addEventListener('message', onMessage)
  if ('start' in port) (port as MessagePort).start()
  return {
    stats,
    request: (method: string, value?: unknown): Promise<unknown> => {
      if (closed) return Promise.reject(new Error('Message link closed'))
      if (held.size >= (opts.maxPending ?? 256)) {
        return Promise.reject(new Error('Too many pending message requests'))
      }
      let id = ++next
      return new Promise((resolve, reject) => {
        let timer = setTimeout(() => {
          held.delete(id)
          reject(new Error('Message request timed out: ' + method))
        }, opts.timeout ?? 30000)
        held.set(id, { resolve, reject, timer })
        try {
          send({ id, method, value })
        } catch (error) {
          clearTimeout(timer)
          held.delete(id)
          reject(error)
        }
      })
    },
    frame: (frame: Frame) => send({ frame }),
    close,
  }
}
