// A Session's live progress, carried from the process that RUNS it to the one
// that holds the sockets. Observations are transient by design
// (observations.ts): no journal row carries them, so they cannot ride the feed
// every committed row rides. The graph-native runner lives in the effects
// daemon now (T-35018), so it pushes them into the serving process's /observe
// socket and lets that process fan them out to whoever is watching.
//
// Best-effort by nature — the runner is not allowed to wait on the web. The
// link opens on the first observation and reopens on the next one after a
// close, so there is no reconnect poller here; frames written while it is
// opening wait in a bounded queue and frames written while it is down are
// dropped. A watcher loses a hint; the turn is untouched.
import type { Observation } from './observations.ts'

// Which server holds the sockets for THIS graph. TASKS_HOST names it outright;
// otherwise it is the port the sibling server binds (server_runtime.ts reads
// the same PORT), never a bare default — a probe daemon on its own port must
// not push its observations at the live server's watchers.
export let observeHost = () =>
  Deno.env.get('TASKS_HOST') ?? `127.0.0.1:${Deno.env.get('PORT') ?? 5173}`

// Deep enough to cover a socket handshake mid-stream, shallow enough that a
// server that never comes back costs nothing.
let QUEUE = 64
// Don't hammer a dead server: one connect attempt per window.
let RETRY_MS = 5_000

export let observeLink = (
  url = `ws://${observeHost()}/observe`,
  open: (url: string) => WebSocket = (u) => new WebSocket(u),
  clock: () => number = Date.now,
) => {
  let sock: WebSocket | undefined
  let queue: string[] = []
  let tried = 0
  let flush = () => {
    if (sock?.readyState != WebSocket.OPEN) return
    for (let frame of queue.splice(0)) sock.send(frame)
  }
  let connect = () => {
    if (sock || clock() - tried < RETRY_MS) return
    tried = clock()
    try {
      let s = open(url)
      sock = s
      s.onopen = flush
      s.onclose = () => {
        if (sock == s) sock = undefined
      }
      // An error frame precedes the close; swallow it so an unhandled event
      // never reaches the process's rejection guard.
      s.onerror = () => {}
    } catch {
      sock = undefined
    }
  }
  return {
    observe: (observation: Observation) => {
      queue.push(JSON.stringify(observation))
      if (queue.length > QUEUE) queue.shift()
      connect()
      flush()
    },
    close: () => {
      queue.length = 0
      sock?.close()
      sock = undefined
    },
  }
}
