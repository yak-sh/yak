// Clock probes stay on the page socket, even while a query awaits its ack.
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { installPair, made, Pair } from '../../packages/workerd/testing.ts'
import { pageSocket } from './page-socket.ts'
import type { Env } from './env.ts'
import type { App, Space } from './directory.ts'

test('page clock replies are direct epoch samples with no store traffic or ack dependency', async () => {
  let undo = installPair()
  let own = new Pair()[1]
  Object.assign(own, { close: () => {} })
  let reads = 0
  let reread = Promise.withResolvers<void>()
  let space = { slug: 'clocks' } as Space
  let app = { eid: 'page', slug: 'page', access: 'public', version: 1 } as App
  let who = { person: null, role: null }
  let env = {
    STORE: {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: (req: Request) => {
          if (new URL(req.url).pathname == '/ws') {
            return Promise.resolve(
              Object.assign(new Response(null, { status: 101 }), {
                webSocket: own,
              }),
            )
          }
          reads++
          if (reads == 2) reread.resolve()
          // Only the decoded query answer matters here, not body streaming.
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve([]),
          } as Response)
        },
      }),
    },
  } as unknown as Env
  try {
    await pageSocket(
      new Request('https://clocks.yaks.app/page/api/ws'),
      env,
      space,
      app,
      { uses: {}, reach: [{ space, app, who }] },
    )
    let front = made.at(-1)![1]
    let sent = front.send
    let next = Promise.withResolvers<void>()
    Object.assign(front, {
      close: () => {},
      send: (data: string) => {
        sent(data)
        next.resolve()
      },
    })
    let probe = (clock: number) => {
      let before = Date.now()
      let count = front.sent.length
      let requests = reads
      let forwarded = own.sent.length
      front.emit('message', JSON.stringify({ clock }))
      assertEquals(front.sent.length, count + 1)
      let reply = front.sent.at(-1)! as unknown as Record<string, unknown>
      assertEquals(Object.keys(reply).sort(), ['clock', 'received', 'sent'])
      assertEquals(reply.clock, clock)
      assert(typeof reply.received == 'number' && reply.received >= before)
      assert(typeof reply.sent == 'number' && reply.sent >= reply.received)
      assert(reply.sent <= Date.now())
      assertEquals(reads, requests)
      assertEquals(own.sent.length, forwarded)
    }
    probe(0)
    assertEquals(reads, 0)
    next = Promise.withResolvers<void>()
    front.emit(
      'message',
      JSON.stringify({ subscribe: '.doc', id: 'page', acks: true }),
    )
    await next.promise
    assertEquals(front.sent.length, 2)
    let snapshot = front.sent[1]
    assertEquals(typeof snapshot.ack, 'string')
    own.emit('message', JSON.stringify({ bundles: [] }))
    await reread.promise
    assertEquals(reads, 2)
    assertEquals(front.sent.length, 2)
    probe(123.5)
    next = Promise.withResolvers<void>()
    front.emit('message', JSON.stringify({ ack: snapshot.ack }))
    await next.promise
    assertEquals(front.sent.length, 4)
    assertEquals(front.sent[3].id, 'page')
    front.emit('close')
  } finally {
    undo()
  }
})
