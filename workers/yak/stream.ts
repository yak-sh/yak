// The agent door's other half: the stream a client leaves open to HEAR from
// the server between its own calls (T-32686). Streamable HTTP gives a session
// two channels — the POST that carries a call and its reply, and a GET the
// client holds open as Server-Sent Events — and until now this door had only
// the first, because nothing here had anything to say unasked. An app that
// grows a tool does: the person's agent listed the tools once at connect, and
// `notifications/tools/list_changed` is how it learns to list them again.
//
// News is QUEUED in plain memory and drained by the stream's own loop, which
// is what the runtime allows: a response body belongs to the request that
// made it, and writing to it from the request that deployed the app would be
// "I/O on behalf of a different request". So a deploy leaves a line in this
// isolate's queue, and the open stream picks it up on its next tick — which
// is the same tick that sends the keepalive comment an idle SSE connection
// needs anyway.
//
// The queue is this ISOLATE's, keyed by person. A Worker isolate holds
// nothing between requests except what an open stream keeps alive — exactly
// the lifetime of what is registered here — so the client's GET and the
// deploy that notifies it must land on the same isolate to meet. In practice
// they do (one client, one connection, one colo); when they do not, the
// client hears nothing and lists its tools at the next connect, which is
// where it would have been anyway. The durable form is the McpAgent shape
// mcp.ts's header names: a Durable Object per session, which is a second DO
// class and a migration to buy delivery nobody has asked for yet.
type Held = { frames: string[] }

let held = new Map<string, Set<Held>>()

// How often an open stream looks for news, and how many ticks of quiet before
// it says something anyway so the connection is not dropped as idle.
let TICK = 250
let BEAT = 60_000 / TICK
// What one stream may hold undelivered: a notification is "your list moved",
// so many of them say nothing more than one.
let DEEP = 8

let add = (person: string, mine: Held) => {
  let all = held.get(person) ?? new Set()
  all.add(mine)
  held.set(person, all)
}

let drop = (person: string, mine: Held) => {
  let all = held.get(person)
  if (!all) return
  all.delete(mine)
  if (!all.size) held.delete(person)
}

// The stream itself: an event-stream this person's client holds open. It
// opens with a comment frame, which is nothing to a client and proof to the
// one holding it that the stream is live.
export let listen = (person: string): Response => {
  let bytes = new TextEncoder()
  let mine: Held = { frames: [] }
  let live = true
  let body = new ReadableStream({
    start(c) {
      let send = (frame: string) => {
        try {
          c.enqueue(bytes.encode(frame))
        } catch {
          live = false // the client let go mid-send
        }
      }
      add(person, mine)
      send(': open\n\n')
      // The stream's own loop, in the stream's own request: it drains what
      // this isolate has queued for this person and keeps the line warm.
      let pump = async () => {
        for (let quiet = 0; live; quiet++) {
          await new Promise((r) => setTimeout(r, TICK))
          if (!live) break
          if (mine.frames.length) {
            quiet = 0
            for (let frame of mine.frames.splice(0)) send(frame)
          } else if (quiet >= BEAT) {
            quiet = 0
            send(': beat\n\n')
          }
        }
        drop(person, mine)
      }
      pump()
    },
    cancel() {
      live = false
      drop(person, mine)
    },
  })
  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'x-accel-buffering': 'no',
    },
  })
}

// Whoever is listening in this isolate right now — asked by name, so the
// caller decides which of them a piece of news is for without this module
// knowing anything about spaces.
export let listening = () => [...held.keys()]

// One JSON-RPC notification, to every stream this person has open. A
// notification has no id and takes no reply: nothing here waits.
export let told = (person: string, method: string, params?: unknown) => {
  let all = held.get(person)
  if (!all?.size) return
  let msg = JSON.stringify({
    jsonrpc: '2.0',
    method,
    ...(params ? { params } : {}),
  })
  for (let mine of all) {
    if (mine.frames.length < DEEP) mine.frames.push(`data: ${msg}\n\n`)
  }
}
