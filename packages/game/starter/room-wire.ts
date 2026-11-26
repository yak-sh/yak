import { workerUpgrade } from '@yaks/workerd/upgrade'
import { motionId, roomLine, type Seat } from './room-model.ts'

type Store = { fetch(path: string, init?: RequestInit): Promise<Response> }
type Upstream = WebSocket & { accept(): void }

let word = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 128

// Allow one room subscription and rebuild each outgoing relay from the
// authenticated seat. Only the store can emit durable state.
export let roomFrames = (
  member: Seat,
): (data: unknown) => string | undefined => {
  let active: string | undefined
  let line = roomLine(member.room)
  return (data) => {
    if (typeof data !== 'string' || data.length > 4096) return
    let frame
    try {
      frame = JSON.parse(data)
    } catch {
      return
    }
    if (!frame || typeof frame !== 'object') return
    if (
      frame.subscribe === line && word(frame.id) &&
      (!active || active === frame.id)
    ) {
      active = frame.id
      return JSON.stringify({
        id: active,
        subscribe: line,
        acks: true,
        frames: true,
      })
    }
    if (active && frame.unsubscribe === active) {
      let unsubscribe = active
      active = undefined
      return JSON.stringify({ unsubscribe })
    }
    if (word(frame.ack)) return JSON.stringify({ ack: frame.ack })
    if (Number.isFinite(frame.clock)) {
      return JSON.stringify({ clock: frame.clock })
    }
    let motion = Array.isArray(frame.relay) && frame.relay[0]?.play_motion
    if (
      !motion || !Number.isFinite(motion.x) || !Number.isFinite(motion.z) ||
      Math.abs(motion.x) > 12 || Math.abs(motion.z) > 12
    ) return
    let { room, seat } = member
    return JSON.stringify({
      relay: [{
        entity: { eid: motionId(member) },
        play_motion: { room, seat, x: motion.x, z: motion.z },
      }],
    })
  }
}

export let roomSocket = async (
  request: Request,
  store: Store,
  member: Seat,
): Promise<Response> => {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return new Response(null, { status: 426 })
  }
  let response = await store.fetch('/ws', { headers: { upgrade: 'websocket' } })
  let upstream = (response as Response & { webSocket?: Upstream }).webSocket
  if (!upstream) throw new Error(`Game room socket: HTTP ${response.status}`)
  let { socket, response: accepted } = workerUpgrade(request)
  let forward = roomFrames(member)
  upstream.addEventListener('message', (event) => {
    if (socket.readyState === 1) socket.send(event.data)
  })
  socket.addEventListener('message', (event) => {
    let frame = forward(event.data)
    if (frame && upstream.readyState === 1) upstream.send(frame)
  })
  let close = () => {
    if (socket.readyState === 1) socket.close?.()
    if (upstream.readyState === 1) upstream.close()
  }
  upstream.addEventListener('close', close)
  socket.addEventListener('close', close)
  upstream.addEventListener('error', close)
  socket.addEventListener('error', close)
  upstream.accept()
  return accepted
}
