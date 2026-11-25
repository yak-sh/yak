import { stub } from '@std/testing/mock'
import { type Frame, receive, subscriptions } from '@yaks/api'
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { clock, equal, test, throws } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { store } from './client.js'

test('public apply retains and retries a preview edit when IndexedDB is denied', async () => {
  let time = clock()
  let bundle = { entity: { eid: '$note' }, doc: { body: 'Draft edit' } }
  let receipt = { ok: true, aliases: { $note: 'note' }, bundles: [] }
  let sends: { key: string | null; body: unknown }[] = []
  using _fetch = stub(globalThis, 'fetch', (url, init) => {
    if (String(url).endsWith('/vocab.json')) {
      return Promise.resolve(Response.json([]))
    }
    if (String(url).endsWith('/who')) {
      return Promise.resolve(Response.json({ person: 'jo', writes: true }))
    }
    equal(String(url), 'https://preview.test/draft/_preview/ticket/api/apply')
    sends.push({
      key: new Headers(init?.headers).get('idempotency-key'),
      body: JSON.parse(String(init?.body)),
    })
    return sends.length === 1
      ? Promise.reject(new TypeError('Offline'))
      : Promise.resolve(Response.json(receipt))
  })
  let before = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: {
      open: () => {
        throw new DOMException('IndexedDB access is denied', 'SecurityError')
      },
    },
  })
  let page = store('https://preview.test/draft/_preview/ticket/api/', {
    clock: time,
  })
  try {
    equal((await page.me()).writes, true)
    await throws(() => page.apply(bundle), 'Offline')
    let [pending] = page.outbox.pending()
    equal(pending.state, 'pending')
    equal(pending.sent, { entities: [bundle] })
    equal(sends, [{ key: pending.key, body: pending.sent }])

    let accepted = Promise.withResolvers<void>()
    let off = page.outbox.onPending(() => {
      if (page.outbox.pending().length === 0) accepted.resolve()
    })
    await time.advance(1000)
    await accepted.promise
    off()
    equal(sends, [sends[0], sends[0]])
    equal(await page.apply(bundle), receipt)
  } finally {
    page.outbox.close()
    if (before) Object.defineProperty(globalThis, 'indexedDB', before)
    else Reflect.deleteProperty(globalThis, 'indexedDB')
  }
})

test('pages relay live rows alongside stored writes, and forget them on disconnect', async () => {
  let vocab = loadVocab({
    $defs: {
      desk: {
        component: true,
        sync: 'peers',
        durable: 'connection',
        properties: { scene: { type: 'string' }, other: { type: 'string' } },
      },
      shot: { component: true, properties: { name: { type: 'string' } } },
    },
  })
  let g = graph({ vocab, storage: ram(vocab) })
  let live = subscriptions(g, {
    timer: (fn) => {
      let due = true
      queueMicrotask(() => due && fn())
      return () => void (due = false)
    },
  })
  let time = clock()
  let http: Bundle[][] = []
  using _fetch = stub(globalThis, 'fetch', async (url, init) => {
    let path = new URL(String(url)).pathname
    if (path.endsWith('/vocab.json')) return Response.json(vocab.docs)
    if (path.endsWith('/who')) return Response.json({ person: 'writer' })
    if (path.endsWith('/query')) return Response.json([])
    equal(path, '/api/apply')
    let { entities } = JSON.parse(String(init?.body))
    http.push(entities)
    let bundles = await g.apply(entities)
    let aliases = Object.fromEntries(
      bundles.flatMap((b) => b.$alias ? [[b.$alias, b.entity.eid]] : []),
    )
    return Response.json({ ok: true, aliases, bundles })
  })
  let page = () => {
    let pending = Promise.resolve()
    let opening = () => {
      let frame = (f: Frame) => socket.onmessage?.({ data: JSON.stringify(f) })
      let socket = {
        readyState: 0,
        onopen: null as (() => void) | null,
        onclose: null as (() => void) | null,
        onmessage: null as ((event: { data: string }) => void) | null,
        send: (wire: string) => {
          pending = pending.then(async () => {
            await receive(live, frame, wire)
          })
        },
        close: () => {
          socket.readyState = 3
          pending = pending.then(async () => await live.drop(frame))
          socket.onclose?.()
        },
      }
      return socket
    }
    let latest: ReturnType<typeof opening>
    let app = store('https://desk.test/api/', {
      clock: time,
      connect: () => (latest = opening()) as unknown as WebSocket,
    })
    let socket = () => latest
    let open = async () => {
      let s = socket()
      s.readyState = 1
      s.onopen?.()
      await pending
    }
    return { app, drained: () => pending, open, socket }
  }
  let writer = page(), reader = page(), late = page()
  let showing = (app: typeof writer.app, filter: string) => {
    let view: Bundle[] = []
    let stop = app.subscribe(filter, (rows: Bundle[]) => view = rows)
    return { read: () => view.map((b) => b.desk), stop }
  }
  let own = showing(writer.app, '.desk')
  let remote = showing(reader.app, '.desk')
  let projected = showing(reader.app, '.shot&.fields=desk.scene')
  await reader.open()
  try {
    let mixed = await writer.app.apply({
      entity: { eid: '$desk' },
      desk: { scene: 'Opening', other: 'unchanged' },
      shot: { name: 'Camera' },
    })
    let eid = mixed.aliases.$desk
    equal(http, [[{ entity: { eid: '$desk' }, shot: { name: 'Camera' } }]])
    equal(mixed.bundles[0].desk, { scene: 'Opening', other: 'unchanged' })
    await writer.open()
    equal(own.read(), [{ scene: 'Opening', other: 'unchanged' }])
    equal(remote.read(), own.read())
    equal(projected.read(), [{ scene: 'Opening' }])

    await writer.app.apply({ entity: { eid }, desk: { scene: 'Wide' } })
    await writer.drained()
    equal(own.read(), [{ scene: 'Wide', other: 'unchanged' }])
    equal(remote.read(), own.read())
    equal(projected.read(), [{ scene: 'Wide' }])

    let joined = showing(late.app, '.desk')
    await late.open()
    equal(joined.read(), own.read())
    equal(await g.read('.desk'), [])
    equal(http.length, 1)

    writer.socket().close()
    await writer.drained()
    equal(remote.read(), [])
    equal(joined.read(), [])
    equal((await g.read('.shot'))[0].shot, { name: 'Camera' })

    await time.advance(1000)
    await writer.open()
    equal(remote.read(), [{ scene: 'Wide', other: 'unchanged' }])
    await writer.app.apply({ entity: { eid }, desk: null })
    await writer.drained()
    equal(remote.read(), [])
    equal(own.read(), [])
    joined.stop()
  } finally {
    for (let peer of [writer, reader, late]) {
      peer.socket()?.close()
      peer.app.outbox.close()
    }
    own.stop()
    remote.stop()
    projected.stop()
  }
})

test('a store says its words merged by component, asked once', async () => {
  let asked = 0
  using _fetch = stub(globalThis, 'fetch', (url) => {
    equal(String(url), 'https://shop.test/shop/api/vocab.json')
    asked++
    return Promise.resolve(Response.json([
      { $defs: { order: { properties: { email: { type: 'string' } } } } },
      { $defs: { order: { properties: { status: { type: 'string' } } } } },
    ]))
  })
  let shop = store('https://shop.test/shop/api/')
  equal(Object.keys((await shop.words()).order.properties), ['email', 'status'])
  await shop.words()
  equal(asked, 1)
})

test('a store posts to its payment doors as JSON and throws a refusal', async () => {
  let sent: [string, string | undefined, unknown][] = []
  using _fetch = stub(globalThis, 'fetch', (url, init) => {
    sent.push([
      String(url),
      init?.method,
      init?.body && JSON.parse(String(init.body)),
    ])
    return Promise.resolve(
      String(url).endsWith('/refunds')
        ? Response.json({ refund: 'r1', status: 'requested' }, { status: 202 })
        : Response.json(
          { error: { code: 'not_an_editor', message: 'Editors only' } },
          { status: 403 },
        ),
    )
  })
  let shop = store('https://shop.test/shop/api/')
  equal(await shop.pay('refunds', { request: 'r1', order: 'o1' }), {
    refund: 'r1',
    status: 'requested',
  })
  await throws(() => shop.pay('/refunds/r1'), 'Editors only')
  equal(sent, [
    ['https://shop.test/shop/api/pay/refunds', 'POST', {
      request: 'r1',
      order: 'o1',
    }],
    ['https://shop.test/shop/api/pay/refunds/r1', undefined, undefined],
  ])
})
