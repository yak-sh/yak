// Shared test fixtures (not part of the published package — see deno.json): a
// recipe-box vocabulary, a server graph behind a @yaks/api handler, client
// graphs wired to it, and pairs of stand-in sockets that carry frames between
// them. Everything runs in one process: the `fetch` a client is handed IS the
// server's handler, and a socket is two objects passing strings.
//
// The domain is a shared recipe box — recipes with a course and a serving
// count, notes about them, cooks who wrote them — so nothing here needs
// knowledge from outside this file. `draft` is the one local-tier component:
// what a cook has typed and not saved.

import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { type Bundle, type Graph, graph } from '@yaks/graph'
import { memory } from '@yaks/memory'
import { api, type Handler } from '@yaks/api'
import type { Connect, Socket } from './socket.ts'
import { type Sync, sync } from './sync.ts'
import { syncKeywords } from './tier.ts'
import type { Trouble } from './outbound.ts'

let doc: VocabDoc = {
  $vocabulary: { 'https://yaks.sh/vocab/sync': true },
  $defs: {
    entity: {
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    // A named thing: everything in the box wears one.
    doc: {
      type: 'object',
      kind: true,
      properties: { title: { type: 'string' }, body: { type: 'string' } },
    },
    // A recipe, and the cook who wrote it down.
    recipe: {
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
      type: 'object',
      kind: true,
      properties: {
        stars: { type: 'number' },
        recipe: { type: 'string', ref: 'recipe', death: 'cascade' },
      },
    },
    // What this cook has typed and not saved. Never leaves the browser.
    draft: {
      type: 'object',
      persist: 'local',
      properties: { text: { type: 'string' } },
    },
    // The words in the search box: gone when the tab closes.
    sieve: {
      type: 'object',
      persist: 'none',
      properties: { text: { type: 'string' } },
    },
    created: {
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
        by: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
      },
    },
    updated: {
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
        by: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
      },
    },
  },
}

/** The recipe-box vocabulary this package's tests read and write against. */
export let box: Vocab = loadVocab(doc, [syncKeywords])

/** A graph over a fresh map. `adopt` is what a CLIENT store needs: the numbers
 * come from the server, not from this map. */
export let boxGraph = (adopt = false): Graph =>
  graph({ storage: memory(box, { adopt }), vocab: box })

/** A stand-in socket, driven by hand: it records what this side sent, and
 * `emit` plays the events a real one would fire. It starts CONNECTING, so a
 * frame sent before `emit('open')` waits exactly as it would on a real one. */
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

/** A server: a graph, the handler in front of it, and the socket halves it has
 * accepted. */
export type Server = {
  graph: Graph
  handler: Handler
  /** the server half of every socket a client has opened against it */
  sockets: Fake[]
  /** a client half waiting to be upgraded (the harness's own plumbing) */
  offer: (half: Fake) => void
}

/** The cook the server's door says every request is from — so a stamp the
 * client could not have written itself is visible in a read. */
export let COOK = 'c1'

/** A server graph behind a @yaks/api handler, upgrading to stand-in sockets. */
export let server = (): Server => {
  let g = boxGraph()
  let sockets: Fake[] = []
  let waiting: Fake[] = []
  let handler = api({
    graph: g,
    authenticate: () => ({ eid: COOK }),
    upgrade: () => {
      let s = waiting.shift()!
      sockets.push(s)
      return { socket: s, response: new Response(null, { status: 101 }) }
    },
  })
  return { graph: g, handler, sockets, offer: (half) => waiting.push(half) }
}

/** A client graph wired to a server, with the transports pointed in-process
 * and no timers of its own: `fire()` is what runs a scheduled reconnect. */
export type Client = {
  graph: Graph
  wire: Sync
  /** everything the wire reported */
  trouble: Trouble[]
  /** run the pending reconnect, if one is scheduled */
  fire: () => void
  /** the socket this client currently holds */
  socket: () => Fake | undefined
  /** settle: every batch in flight answered, every frame landed */
  idle: () => Promise<void>
}

/** A client graph over its own map, wired to `srv` in this process. */
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
    // The handler takes the server half and attaches to it; both ends open
    // once it has, which is when the held subscribe frames go out.
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
