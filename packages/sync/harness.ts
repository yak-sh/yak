// Shared test fixtures (not part of the published package — see deno.json): a
// recipe-box vocabulary, a server graph behind a @yaks/api handler, client
// graphs connected to it, and pairs of stand-in sockets that carry frames
// between them. Everything runs in one process: the `fetch` a client is given
// IS the server's handler, and a socket is two objects passing strings.
//
// The domain is a shared recipe box — recipes with a course and a serving
// count, notes about them, cooks who wrote them — so nothing here needs
// knowledge from outside this file. `draft` is the one component that never
// leaves the client: what a cook has typed and not saved.

import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { type Bundle, type Graph, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { api, type Handler } from '@yaks/api'
import type { Connect, Socket } from './socket.ts'
import { type Sync, sync } from './sync.ts'
import type { Trouble } from './outbound.ts'

let doc: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    // A named thing: everything in the box has one.
    doc: {
      component: true,
      type: 'object',
      kind: true,
      properties: { title: { type: 'string' }, body: { type: 'string' } },
    },
    // A recipe, and the cook who wrote it down.
    recipe: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        serves: { type: 'number' },
        course: { enum: ['starter', 'dinner', 'pudding'] },
        cook: { type: 'string', ref: 'entity', death: 'detach' },
      },
    },
    // A note exists ABOUT a recipe — deleting the recipe takes its notes too.
    note: {
      component: true,
      type: 'object',
      kind: true,
      properties: {
        stars: { type: 'number' },
        recipe: { type: 'string', ref: 'recipe', death: 'cascade' },
      },
    },
    // What this cook has typed and not saved. Never leaves the browser.
    draft: {
      component: true,
      type: 'object',
      sync: 'none',
      properties: { text: { type: 'string' } },
    },
    // The text in the search box: gone when the tab closes.
    sieve: {
      component: true,
      type: 'object',
      sync: 'none',
      durable: 'connection',
      properties: { text: { type: 'string' } },
    },
    // Where this cook's finger is on the page: everyone else sees it, nobody
    // stores it, and it goes with the tab.
    pointing: {
      component: true,
      type: 'object',
      sync: 'peers',
      durable: 'connection',
      properties: { x: { type: 'number' }, y: { type: 'number' } },
    },
    created: {
      component: true,
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
        by: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
      },
    },
    updated: {
      component: true,
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
        by: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
      },
    },
  },
}

/** The recipe-box vocabulary this package's tests read and write against. */
export let box: Vocab = loadVocab(doc)

/** A graph over a fresh map. `adopt` is what a CLIENT store needs: the numbers
 * come from the server, not from this map. */
export let boxGraph = (adopt = false): Graph =>
  graph({ storage: ram(box, { adopt, number: true }), vocab: box })

/** A stand-in socket, driven by hand: it records what this side sent, and
 * `emit` fires the events a WebSocket would. It starts in the CONNECTING
 * state, so a frame sent before `emit('open')` waits exactly as it would on a
 * WebSocket. */
export type Fake = Socket & {
  /** every message this side sent, parsed */
  sent: unknown[]
  /** fire an event at the listeners registered on this side */
  emit: (type: string, data?: unknown) => void
}

let fake = (): Fake => {
  let at: Record<string, ((e: Event & { data?: unknown }) => void)[]> = {}
  let f: Fake = {
    readyState: 0,
    sent: [],
    send: (data) => {
      f.sent.push(JSON.parse(data))
    },
    close: () => {
      if (f.readyState == 3) return
      f.readyState = 3
      f.emit('close')
    },
    addEventListener: (type, listener) => {
      ;(at[type] ??= []).push(listener)
    },
    emit: (type, data) => {
      if (type == 'open') f.readyState = 1
      let event = type == 'message'
        ? new MessageEvent('message', { data })
        : new Event(type)
      for (let l of at[type] ?? []) l(event)
    },
  }
  return f
}

/** A pair of stand-in sockets wired to each other: what one sends the other
 * receives, and closing either closes both. */
export let pair = (): { client: Fake; server: Fake } => {
  let client = fake()
  let server = fake()
  let join = (from: Fake, to: Fake) => {
    let send = from.send
    let close = from.close
    from.send = (data) => {
      send(data)
      if (to.readyState == 1) to.emit('message', data)
    }
    from.close = () => {
      if (from.readyState == 3) return
      close()
      to.close()
    }
  }
  join(client, server)
  join(server, client)
  return { client, server }
}

/** A server: a graph, the request handler in front of it, and the socket
 * halves it has accepted. */
export type Server = {
  graph: Graph
  handler: Handler
  /** the server half of every socket a client has opened against it */
  sockets: Fake[]
  /** a client half waiting to be upgraded (the harness's own plumbing) */
  offer: (half: Fake) => void
}

/** The cook the server's handler treats every request as coming from — so a
 * stamped column the client could not have written itself shows up in a
 * read. */
export let COOK = 'c1'

/** A server graph behind a @yaks/api handler, upgrading to stand-in sockets. */
export let server = (): Server => {
  let g = boxGraph()
  let sockets: Fake[] = []
  let waiting: Fake[] = []
  let handler = api({
    graph: g,
    authenticate: () => ({ by: COOK }),
    upgrade: () => {
      let s = waiting.shift()!
      sockets.push(s)
      return { socket: s, response: new Response(null, { status: 101 }) }
    },
  })
  return { graph: g, handler, sockets, offer: (half) => waiting.push(half) }
}

/** A client graph connected to a server, with both transports pointed at an
 * in-process handler and no timers of its own: `fire()` is what runs a
 * scheduled reconnect. */
export type Client = {
  graph: Graph
  wire: Sync
  /** everything the sync reported */
  trouble: Trouble[]
  /** run the pending reconnect, if one is scheduled */
  fire: () => void
  /** the socket this client currently holds */
  socket: () => Fake | undefined
  /** resolves when every write in flight has been answered and every frame
   * applied */
  idle: () => Promise<void>
}

/** A client graph over its own map, connected to `srv` in this process. */
export let client = (srv: Server): Client => {
  let g = boxGraph(true)
  let trouble: Trouble[] = []
  let timers: (() => void)[] = []
  let opening: Promise<unknown> = Promise.resolve()
  let mine: Fake | undefined
  let connect: Connect = () => {
    let { client: c, server: s } = pair()
    mine = c
    srv.offer(s)
    // The handler receives the server half and attaches to it; both ends open
    // once it has, which is when the waiting subscribe messages are sent.
    opening = Promise.resolve(srv.handler(
      new Request('http://box.test/ws', { headers: { upgrade: 'websocket' } }),
    )).then(() => {
      s.emit('open')
      c.emit('open')
    })
    return c
  }
  let wire = sync(g, {
    url: 'http://box.test',
    fetch: (request) => srv.handler(request),
    connect,
    timer: (fn) => timers.push(fn),
    report: (t) => trouble.push(t),
  })
  return {
    graph: g,
    wire,
    trouble,
    fire: () => timers.shift()?.(),
    socket: () => mine,
    idle: async () => {
      await opening
      await wire.idle()
      await opening
      await wire.idle()
    },
  }
}

/** One entity, whole, out of a graph. */
export let at = (g: Graph, eid: string): Bundle | undefined =>
  (g.storage.tx((tx) => tx.get([eid])) as Bundle[])[0]

/** One component off a bundle, for a test that wants a column out of it. */
export let comp = (
  b: Bundle | undefined,
  name: string,
): Record<string, unknown> => {
  let c = b?.[name]
  return c && typeof c == 'object' ? { ...c } as Record<string, unknown> : {}
}
