/// <reference lib="deno.ns" />
import { equal, ok, test } from '@yaks/testing'
import { channel, type Event } from '@yaks/trace'
import { api } from './route.ts'
import { handler } from './routes.ts'
import { post, req, shopGraph } from './testing.ts'
import { subscriptions } from './subs.ts'

let request = (events: Event[], name: string) =>
  ok(
    events.findLast((e) =>
      e.kind == 'request' && e.name == name && e.stage == 'start'
    ),
  )

test('API write, read and NDJSON chunks descend from response-head request', async () => {
  let g = shopGraph()
  let events: Event[] = []
  let off = channel(g).subscribe((e) => events.push(e))
  let serve = api({ graph: g, authenticate: () => null })
  let sent = await serve(post('/apply?token=private', [
    {
      entity: { eid: 'book-private' },
      book: { price: 4 },
      doc: { title: 'private' },
    },
  ]))
  equal(sent.status, 200)
  await sent.json()
  let write = request(events, '/apply')
  ok(events.some((e) => e.kind == 'apply' && e.parent == write.id))
  let read = await serve(req('/query?q=.book.price%3D4'))
  equal(read.status, 200)
  await read.json()
  let query = request(events, '/query')
  ok(events.some((e) => e.kind == 'query' && e.parent == query.id))
  let poured = await serve(
    req('/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/x-ndjson' },
      body: JSON.stringify({
        entity: { eid: 'other-private' },
        book: { price: 5 },
      }) + '\n',
    }),
  )
  let pouring = request(events, '/apply')
  await poured.text()
  ok(events.some((e) => e.kind == 'apply' && e.parent == pouring.id))
  ok(!JSON.stringify(events).includes('private'))
  ok(
    events.filter((e) => e.kind == 'request' && e.stage == 'end')
      .every((e) => e.duration! >= 0 && e.counts?.status == 200),
  )
  off()
})

test('a reader overlay cannot steal composed graph activity or fanout parent', async () => {
  let g = shopGraph()
  let events: Event[] = []
  let off = channel(g).subscribe((e) => events.push(e))
  let serve = handler({
    graph: g,
    reader: { read: g.read, rows: g.rows, get: g.get },
    who: () => null,
    routes: [],
  })
  let out = await serve(post('/apply', [
    { entity: { eid: 'book' }, book: { price: 4 } },
  ]))
  await out.json()
  equal(
    events.filter((e) => e.kind == 'request' && e.stage == 'start').length,
    1,
  )
  let root = request(events, '/apply')
  ok(events.some((e) => e.kind == 'apply' && e.parent == root.id))
  ok(
    events.some((e) =>
      e.kind == 'fanout' && e.name == 'subscriptions' && e.parent
    ),
  )
  off()
})

test('subscription activity counts work but never queries, sink IDs or rows', async () => {
  let g = shopGraph()
  let subs = subscriptions(g)
  let frames = 0
  await subs.open(
    () => {
      frames++
    },
    'subscriber-private',
    '.book',
  )
  let c = channel(g)
  let off = c.subscribe(() => {})
  await g.apply([{ entity: { eid: 'book-private' }, book: { price: 3 } }])
  ok(frames >= 2)
  let fan = ok(c.history().find((e) => e.kind == 'fanout' && e.stage == 'end'))
  equal(fan.counts?.transactions, 1)
  equal(fan.counts?.subscriptions, 1)
  ok(!JSON.stringify(c.history()).includes('private'))
  off()
})
