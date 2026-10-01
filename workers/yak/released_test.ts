// A release is a store-wide notice, not a graph subscription or an ack.
import { assertEquals } from '@std/assert'
import { test, until } from '@yaks/testing'
import { durable } from '../../packages/durable-object/testing.ts'
import { installPair, made, Pair } from '../../packages/workerd/testing.ts'
import { Store } from './graph.ts'
import type { Wire } from '@yaks/durable-object'
import { pageSocket } from './page-socket.ts'
import type { Env } from './env.ts'
import type { App, Space } from './directory.ts'

let released = (version: unknown, kernel = true, method = 'POST') =>
  new Request('https://store/released', {
    method,
    headers: {
      'x-store': 'releases/page',
      ...(kernel ? { 'x-yak-kernel': '1' } : {}),
    },
    ...(method == 'POST' ? { body: JSON.stringify({ version }) } : {}),
  })

test('only kernel POST /released tells every held socket, without subscriptions', async () => {
  using storage = durable()
  let socket = () => {
    let sent: unknown[] = []
    return {
      sent,
      readyState: 1,
      send: (data: string) => sent.push(JSON.parse(data)),
      serializeAttachment: () => {},
      deserializeAttachment: () => null,
    } satisfies Wire & { sent: unknown[] }
  }
  let one = socket()
  let two = socket()
  let store = new Store({
    storage,
    acceptWebSocket: () => {},
    getWebSockets: () => [one, two],
  })
  assertEquals((await store.fetch(released(2, false))).status, 404)
  assertEquals((await store.fetch(released(2, true, 'GET'))).status, 404)
  for (let version of ['2', null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assertEquals((await store.fetch(released(version))).status, 400)
  }
  assertEquals(one.sent, [])
  assertEquals(two.sent, [])
  assertEquals((await store.fetch(released(2))).status, 200)
  assertEquals(one.sent, [{ release: { version: 2 } }])
  assertEquals(two.sent, one.sent)
  assertEquals((await store.fetch(released(3))).status, 200)
  assertEquals(one.sent.at(-1), { release: { version: 3 } })
})

test('page socket forwards only its own release raw, outside the ack queue', async () => {
  let undo = installPair()
  let own = new Pair()[1]
  let home = new Pair()[1]
  Object.assign(own, { close: () => {} })
  Object.assign(home, { close: () => {} })
  let reads = 0
  let space = { slug: 'releases' } as Space
  let app = { eid: 'page', slug: 'page', access: 'public', version: 1 } as App
  let borrowed = { ...app, eid: 'home', slug: 'home' }
  let who = { person: null, role: null }
  let env = {
    STORE: {
      idFromName: (name: string) => name,
      get: (name: string) => ({
        fetch: (req: Request) => {
          if (new URL(req.url).pathname == '/ws') {
            return Promise.resolve(
              Object.assign(new Response(null, { status: 101 }), {
                webSocket: name.endsWith('/page') ? own : home,
              }),
            )
          }
          reads++
          return Promise.resolve(Response.json([]))
        },
      }),
    },
  } as unknown as Env
  try {
    await pageSocket(
      new Request('https://releases.yaks.app/page/api/ws'),
      env,
      space,
      app,
      {
        uses: {},
        reach: [{ space, app, who }, { space, app: borrowed, who }],
      },
    )
    let front = made.at(-1)![1]
    Object.assign(front, { close: () => {} })
    let raw: string[] = []
    let send = front.send
    front.send = (data) => {
      raw.push(data)
      send(data)
    }
    let packet = '{ "release": { "version": 2 } }'
    own.emit('message', packet)
    assertEquals(raw, [packet])
    home.emit('message', '{"release":{"version":99}}')
    assertEquals(raw, [packet])
    front.emit(
      'message',
      JSON.stringify({ subscribe: '.doc', id: 'page', acks: true }),
    )
    await until(() => front.sent.length == 2)
    let snapshot = front.sent[1]
    assertEquals(typeof snapshot.ack, 'string')
    let before = reads
    own.emit('message', JSON.stringify({ bundles: [] }))
    await until(() => reads > before)
    // A graph frame is now held for the unacknowledged snapshot.
    assertEquals(front.sent.length, 2)
    own.emit('message', packet)
    home.emit('message', '{"release":{"version":100}}')
    assertEquals(raw.at(-1), packet)
    assertEquals(front.sent.length, 3)
    assertEquals(reads, before + 1)
    front.emit('message', JSON.stringify({ ack: snapshot.ack }))
    await until(() => front.sent.length == 4)
    assertEquals(front.sent[3].id, 'page')
    front.emit('close')
  } finally {
    undo()
  }
})
