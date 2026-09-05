// Shared test fixtures (not part of the published package — see deno.json).
//
// The domain is @yaks/sync's recipe box, and so is the server: this package
// sits on top of that one, so its tests are best run against the same graph,
// the same handler and the same stand-in sockets. What is added here is a
// CLIENT built by `client()` rather than by hand, an in-process socket for it,
// and a stand-in IndexedDB.
//
// Nothing here touches a network, a timer or a browser. `fire()` runs a
// scheduled reconnect, `idle()` settles everything in flight, and the
// IndexedDB is npm's `fake-indexeddb`, which is the same API in a Map.

import { IDBFactory } from 'fake-indexeddb'
import type { Bundle } from '@yaks/graph'
import type { Connect, Trouble } from '@yaks/sync'
import { box, type Fake, pair, type Server } from '../sync/harness.ts'
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
} from '../sync/harness.ts'

/** A client under test: what {@link client} returned, plus the handles a test
 * needs to drive its wire. */
export type Box = Client & {
  /** everything the wire reported */
  trouble: Trouble[]
  /** run the pending reconnect, if one is scheduled */
  fire: () => void
  /** the socket this client currently holds */
  socket: () => Fake | undefined
  /** settle: the local tier hydrated, every batch answered, every frame landed */
  idle: () => Promise<void>
}

/** A client over the recipe box. With a server, its transports are pointed at
 * that server in this process; without one, it is a graph with nobody else in
 * it. Nothing is kept unless the caller hands in a vault. */
export let boxClient = (srv?: Server, opts: ClientOpts = {}): Box => {
  let trouble: Trouble[] = []
  let timers: (() => void)[] = []
  let opening: Promise<unknown> = Promise.resolve()
  let mine: Fake | undefined

  // The handler takes the server half and attaches to it; both ends open once
  // it has, which is when the held subscribe frames go out.
  let connect: Connect = () => {
    let { client: c, server: s } = pair()
    mine = c
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
    idle: async () => {
      await c.ready
      for (let i = 0; i < 2; i++) {
        await opening
        await c.wire?.idle()
      }
    },
  })
}

/** A stand-in IndexedDB: npm's `fake-indexeddb`, which is the same API over a
 * Map. Two vaults over one of these are two page loads of one browser. */
export let fakeDb = (): IDBFactory => new IDBFactory()

/** The package's own IndexedDB vault, pointed at a stand-in. */
export let fakeIdb = (indexedDB: IDBFactory): Vault =>
  idb({ name: 'box', indexedDB })

/** One component off a bundle, for a test that wants a column out of it. */
export let comp = (
  b: Bundle | undefined,
  name: string,
): Record<string, unknown> => {
  let c = b?.[name]
  return c && typeof c == 'object' ? { ...c } as Record<string, unknown> : {}
}

/** The titles of a set of bundles, in the order they came — what most of these
 * tests assert on. */
export let titles = (bundles: Bundle[]): string[] =>
  bundles.map((b) => String(comp(b, 'doc').title))
