import { apply, type Change, db } from './db.ts'

// The sync channel: clients send flat change batches ([{eid, name, comp}]),
// the server applies them and rebroadcasts to every other client. This is the
// write surface — a full HTTP API only appears if the CLI ever needs one.
//
// It listens on its own port because Vite's dev middleware can't upgrade
// websockets in Fresh ≤2.3 (Fresh 2.4's app.ws()/ctx.upgrade() fixes this —
// swap to it when it ships on JSR); vite.config.ts proxies same-origin /ws
// here, so clients never know. Vite loads main.ts lazily, so the listener
// starts on the first page request. Hot reload re-imports this module — the
// AddrInUse guard keeps the first listener (restart dev for sync.ts changes).
let clients = new Set<WebSocket>()

let serve = () =>
  Deno.serve({ port: 5174, onListen: () => {} }, (req) => {
    if (req.headers.get('upgrade')?.toLowerCase() != 'websocket') {
      return new Response('websocket only', { status: 400 })
    }
    let { socket, response } = Deno.upgradeWebSocket(req)
    socket.onopen = () => clients.add(socket)
    socket.onclose = () => clients.delete(socket)
    socket.onmessage = (m) => {
      try {
        apply(db, JSON.parse(String(m.data)) as Change[])
      } catch (e) {
        console.error('sync: bad batch dropped —', e)
        return
      }
      for (let c of clients) {
        if (c != socket && c.readyState == WebSocket.OPEN) c.send(m.data)
      }
    }
    return response
  })

try {
  serve()
} catch (e) {
  if (!(e instanceof Deno.errors.AddrInUse)) throw e
}
