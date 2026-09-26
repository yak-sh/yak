// Shared test fixtures (not part of the published package — see deno.json).
//
// The subject is @yaks/sync's recipe box, and so is the server: this package
// sits on top of that one, so its tests are best run against the same graph,
// the same request handler and the same stand-in sockets. What is added here
// is a client built by `client()` rather than by hand, an in-process socket
// for it, and a stand-in IndexedDB.
//
// Nothing here touches a network, a timer or a browser. `fire()` runs a
// scheduled reconnect, `idle()` waits for everything in flight, and the
// IndexedDB is npm's `fake-indexeddb`, which is the same API over a Map.

import { IDBFactory } from 'fake-indexeddb'
import type { Bundle } from '@yaks/graph'
import type { Connect, Trouble } from '@yaks/sync'
import { box, type Fake, pair, type Server } from '../sync/testing.ts'
import { type Client, client, type ClientOpts } from './client.ts'
import { idb } from './idb.ts'
import type { Vault } from './vault.ts'

export {
  box,
  COOK,
  type Fake,
  pair,
  type Server,
  server,
} from '../sync/testing.ts'

/** A client under test: what {@link client} returned, plus what a test needs
 * to drive its connection to the server. */
export type Box = Client & {
  /** everything the connection reported */
  trouble: Trouble[]
  /** run the pending reconnect, if one is scheduled */
  fire: () => void
  /** the socket this client currently holds */
  socket: () => Fake | undefined
  /** lose the connection on this side only, as a dropped network does: the
   * page hears it close and the server does not. Returns the server's half,
   * still open, for the test to close when the server finally hears it. */
  cut: () => Fake | undefined
  /** wait until this browser's stored components are loaded, every POST has
   * been answered, and every frame has been handled */
  idle: () => Promise<void>
}

/** A client over the recipe box. Given a server, its `fetch` and its socket
 * are pointed at that server in this same process; without one, it is a graph
 * in this page alone. Nothing is stored unless the caller passes a vault. */
export let boxClient = (srv?: Server, opts: ClientOpts = {}): Box => {
  let trouble: Trouble[] = []
  let timers: (() => void)[] = []
  let opening: Promise<unknown> = Promise.resolve()
  let mine: Fake | undefined
  let theirs: Fake | undefined

  // The request handler is given the server half of the socket pair and
  // attaches to it; both ends open once it has, which is when the queued
  // subscribe frames are sent.
  let connect: Connect = () => {
    let { client: c, server: s } = pair()
    mine = c
    theirs = s
    srv!.offer(s)
    opening = Promise.resolve(srv!.handler(
      new Request('http://box.test/ws', { headers: { upgrade: 'websocket' } }),
    )).then(() => {
      s.emit('open')
      c.emit('open')
    })
    return c
  }

  let c = client(box, [], {
    vault: false,
    ...opts,
    url: srv ? 'http://box.test' : undefined,
    fetch: srv ? (request) => srv.handler(request) : undefined,
    connect: srv ? connect : undefined,
    timer: (fn) => timers.push(fn),
    report: (t) => trouble.push(t),
  })

  return Object.assign(c, {
    trouble,
    fire: () => timers.shift()?.(),
    socket: () => mine,
    cut: () => {
      mine!.readyState = 3
      mine!.emit('close')
      return theirs
    },
    idle: async () => {
      await c.ready
      for (let i = 0; i < 2; i++) {
        await opening
        await c.wire?.idle()
      }
    },
  })
}

/** A stand-in IndexedDB: npm's `fake-indexeddb`, which is the same API over
 * a Map. Two vaults over one of these stand for two page loads of the same
 * browser. */
export let fakeDb = (): IDBFactory => new IDBFactory()

/** The package's own IndexedDB vault, pointed at a stand-in. */
export let fakeIdb = (indexedDB: IDBFactory): Vault =>
  idb({ name: 'box', indexedDB })

/** One component off a bundle, for a test that wants a property out of it. */
export let comp = (
  b: Bundle | undefined,
  name: string,
): Record<string, unknown> => {
  let c = b?.[name]
  return c && typeof c == 'object' ? { ...c } as Record<string, unknown> : {}
}

/** The titles of a set of bundles, in the order they arrived — what most of
 * these tests assert on. */
export let titles = (bundles: Bundle[]): string[] =>
  bundles.map((b) => String(comp(b, 'doc').title))
