import { stub } from '@std/testing/mock'
import { clock, equal, test, throws } from '@yaks/testing'
import { store } from './client.js'

test('public apply retains and retries a preview edit when IndexedDB is denied', async () => {
  let time = clock()
  let bundle = { entity: { eid: '$note' }, doc: { body: 'Draft edit' } }
  let receipt = { ok: true, aliases: { $note: 'note' }, bundles: [] }
  let sends: { key: string | null; body: unknown }[] = []
  using _fetch = stub(globalThis, 'fetch', (url, init) => {
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
