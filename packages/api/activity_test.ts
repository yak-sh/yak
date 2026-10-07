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

test('API reads and writes descend from HTTP requests and streaming imports stay live', async () => {
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
  let pouring = request(events, 'http stream apply')
  await poured.text()
  ok(events.some((e) => e.kind == 'apply' && e.parent == pouring.id))
  ok(!JSON.stringify(events).includes('private'))
  ok(
    events.filter((e) =>
      e.kind == 'request' && e.stage == 'end' && e.name.startsWith('/')
    )
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
    events.filter((e) =>
      e.kind == 'request' && e.stage == 'start' && e.name == '/apply'
    ).length,
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

let taskContext = async (run: () => Promise<void>) => {
  let { AsyncLocalStorage } = await import('node:async_hooks')
  let { installContext } = await import('@yaks/trace')
  let local = new AsyncLocalStorage<import('@yaks/trace').Context | undefined>()
  let restore = installContext({
    get: () => local.getStore(),
    run: (at, work) => local.run(at, work),
  })
  try {
    await run()
  } finally {
    restore()
  }
}

test('interleaved HTTP handlers retain independent request parents after awaits', async () => {
  await taskContext(async () => {
    let { during, measure, peek } = await import('@yaks/trace')
    let { served } = await import('./request.ts')
    let g = shopGraph()
    let events: Event[] = []
    let off = channel(g).subscribe((e) => events.push(e))
    let release!: () => void
    let wait = new Promise<void>((resolve) => release = resolve)
    let first = true
    let serve = served(async () => {
      let n = first ? 11 : 23
      if (first) {
        first = false
        await wait
      } else {
        await Promise.resolve()
      }
      await during(
        peek(g)!.begin({ kind: 'query', name: 'read' }),
        async () => {
          await Promise.resolve()
          during(peek(g)!.begin({ kind: 'sql', name: 'book select' }), () => {
            measure({ rowsRead: n, rowsWritten: 0, statements: 1 })
          })
        },
      )
      return new Response('[]')
    }, { graph: g, route: () => '/query' })
    let a = serve(req('/query?q=private-a'))
    let b = serve(req('/query?q=private-b'))
    await b
    release()
    await a
    let roots = events.filter((e) => e.kind == 'request' && e.stage == 'end')
    equal(roots.map((e) => e.counts?.rowsRead), [23, 11])
    for (let root of roots) {
      let query = ok(
        events.find((e) => e.kind == 'query' && e.parent == root.id),
      )
      ok(events.some((e) => e.kind == 'sql' && e.parent == query.id))
      equal(root.counts?.statements, 1)
    }
    ok(!JSON.stringify(events).includes('private'))
    off()
  })
})

test('socket subscribe awaits and subsequent refreshes have separate request trees', async () => {
  await taskContext(async () => {
    let { during, measure, peek } = await import('@yaks/trace')
    let { receive } = await import('./socket.ts')
    let g = shopGraph()
    let read = g.read
    g.read = async (...args) => {
      await Promise.resolve()
      return during(
        peek(g)?.begin({ kind: 'query', name: 'registry read' }),
        () => {
          measure({ rowsRead: 7, rowsWritten: 0, statements: 1 })
          return read(...args)
        },
      )
    }
    let subs = subscriptions(g)
    let events: Event[] = []
    let off = channel(g).subscribe((e) => events.push(e))
    let frames: unknown[] = []
    await receive(
      subs,
      (frame) => frames.push(frame),
      JSON.stringify({
        id: 'private-subscription',
        subscribe: '.book',
      }),
    )
    let opening = request(events, 'ws subscribe')
    let end = ok(events.find((e) => e.id == opening.id && e.stage == 'end'))
    ok(events.some((e) => e.kind == 'query' && e.parent == opening.id))
    equal(end.counts?.rowsRead, 7)
    await g.apply([{ entity: { eid: 'private-book' }, book: { price: 8 } }])
    let refresh = request(events, 'ws refresh')
    let linked = ok(events.find((e) => e.id == refresh.parent))
    equal(linked.kind, 'phase')
    let fan = ok(
      events.find((e) => e.kind == 'fanout' && e.parent == refresh.id),
    )
    ok(events.some((e) => e.id == fan.id && e.stage == 'end'))
    ok(events.some((e) => e.id == refresh.id && e.stage == 'end'))
    ok(frames.length >= 2)
    ok(!JSON.stringify(events).includes('private'))
    off()
  })
})
