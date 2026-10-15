// Clock probes stay on the page socket, even while a batch awaits its ack.
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { installPair, made, Pair } from '../../packages/workerd/testing.ts'
import { pageSocket } from './page-socket.ts'
import type { Env } from './env.ts'
import type { App, Space } from './directory.ts'

// A page socket over an app store that counts its reads, opened once: what is
// checked is how the open socket answers, not how it opens.
let page = await (async () => {
  let undo = installPair()
  let own = new Pair()[1]
  Object.assign(own, { close: () => {} })
  let reads = 0
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
          return Promise.resolve(Response.json([]))
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
    Object.assign(front, { close: () => {} })
    return { own, front, reads: () => reads }
  } finally {
    undo()
  }
})()

test('page clock replies are direct epoch samples with no store traffic or ack dependency', () => {
  let { own, front, reads } = page
  let probe = (clock: number) => {
    let before = Date.now()
    let count = front.sent.length
    let requests = reads()
    let forwarded = own.sent.length
    front.emit('message', JSON.stringify({ clock }))
    assertEquals(front.sent.length, count + 1)
    let reply = front.sent.at(-1)! as unknown as Record<string, unknown>
    assertEquals(Object.keys(reply).sort(), ['clock', 'received', 'sent'])
    assertEquals(reply.clock, clock)
    assert(typeof reply.received == 'number' && reply.received >= before)
    assert(typeof reply.sent == 'number' && reply.sent >= reply.received)
    assert(reply.sent <= Date.now())
    assertEquals(reads(), requests)
    assertEquals(own.sent.length, forwarded)
  }
  probe(0)
  // The raw feed's first batch awaits its ACK, and the next waits behind it.
  front.emit(
    'message',
    JSON.stringify({ subscribe: true, id: 'feed', acks: true }),
  )
  own.emit('message', JSON.stringify({ bundles: [] }))
  let first = front.sent[1]
  assertEquals(typeof first.ack, 'string')
  own.emit('message', JSON.stringify({ bundles: [] }))
  assertEquals(front.sent.length, 2)
  probe(123.5)
  front.emit('message', JSON.stringify({ ack: first.ack }))
  assertEquals(front.sent.length, 4)
  assertEquals(front.sent[3].id, 'feed')
  assertEquals(reads(), 0)
  front.emit('close')
})
