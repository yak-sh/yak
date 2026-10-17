// The public module's JSON receipt door, not a second implementation of the
// outbox. The package tests own disk recovery and ordering.
import { assert, assertEquals, assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import { test } from '@yaks/testing'
import { store } from './public/client.js'

let receipt = {
  ok: true,
  aliases: { $note: 'note' },
  bundles: [{ entity: { eid: 'note' } }],
}
let payload = { entity: { eid: '$note' }, doc: { body: 'precious' } }
let json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status })
let wire = (
  send: (key: string, body: string) => Response,
  identity = () => json({ person: 'jo' }),
) =>
  stub(globalThis, 'fetch', (url, init) => {
    if (String(url).endsWith('/me')) return Promise.resolve(identity())
    assert(String(url).endsWith('/apply'))
    return Promise.resolve(
      send(
        new Headers(init?.headers).get('idempotency-key')!,
        String(init?.body),
      ),
    )
  })
let settled = async (ready: () => boolean) => {
  for (let i = 0; i < 100 && !ready(); i++) await Promise.resolve()
  assert(ready(), 'outbox did not settle')
}
let base = 'https://outbox-client.test/notes/api/'

let retriesPreserveReceipt = await (async () => {
  let calls: { key: string; body: string }[] = []
  let alarms: (() => void)[] = []
  let nativeTimer = globalThis.setTimeout
  let runtimeTick = Promise.withResolvers<void>()
  using _timers = stub(
    globalThis,
    'setTimeout',
    ((fn: () => void, ms?: number, ...args: unknown[]) => {
      // Only the outbox's retry belongs to this fixture. The shared kernel
      // may yield an alarm/mover with a zero-delay timer while it runs.
      if (ms !== 1000) return nativeTimer(fn, ms, ...args)
      alarms.push(fn)
      return 0
    }) as typeof setTimeout,
  )
  let response = json(
    { ok: true, pending: true, aliases: {}, bundles: [] },
    202,
  )
  using _fetch = wire((key, body) => {
    calls.push({ key, body })
    return response.clone()
  })
  let client = store(base)
  let changed = 0
  let off = client.outbox.onPending(() => changed++)
  try {
    await client.outbox.ready
    // The kernel can schedule its own zero-delay work while a request fails.
    setTimeout(() => runtimeTick.resolve(), 0)
    await assertRejects(() => client.apply(payload), Error, 'unsaved')
    let [pending] = client.outbox.pending()
    assertEquals(pending.state, 'pending')
    assertEquals(pending.sent, { entities: [payload] })
    assert(pending.key.startsWith('outbox:'))
    response = json({ bundles: [] }) // An incomplete 200 is no acceptance either.
    await settled(() => alarms.length == 1)
    alarms.shift()!()
    await settled(() => alarms.length == 1)
    assertEquals(calls.length, 2)
    assertEquals(client.outbox.pending().length, 1)
    response = json(receipt)
    // Unknown has already rejected its caller: the saved receipt removes the
    // retained intent, not a fabricated success for that earlier caller.
    alarms.shift()!()
    await settled(() => client.outbox.pending().length == 0)
    assertEquals(calls.length, 3)
    assert(calls.every((c) => c.key == calls[0].key && c.body == calls[0].body))
    assert(changed >= 2)
    assertEquals(await client.apply(payload), receipt)
    await runtimeTick.promise
  } finally {
    off()
    client.outbox.close()
  }
  return true
})()
test(
  'public apply preserves receipts and retries unknown JSON with the same write identity',
  () => assertEquals(retriesPreserveReceipt, true),
)

test('public apply retains deliberate refusal until explicitly retried or forgotten', async () => {
  let response = json({ error: { message: 'precondition changed' } }, 409)
  using _fetch = wire(() => response)
  let client = store(base)
  try {
    await assertRejects(
      () => client.apply(payload),
      Error,
      'precondition changed',
    )
    await settled(() => client.outbox.pending()[0]?.state == 'refused')
    let [pending] = client.outbox.pending()
    assertEquals(pending.refusal?.message, 'precondition changed')
    response = json(receipt)
    await client.outbox.retry(pending.key)
    await settled(() => client.outbox.pending().length == 0)
    response = json({ error: { message: 'not allowed' } }, 403)
    await assertRejects(() => client.apply(payload), Error, 'not allowed')
    await settled(() => client.outbox.pending()[0]?.state == 'refused')
    await client.outbox.forget(client.outbox.pending()[0].key)
    assertEquals(client.outbox.pending(), [])
  } finally {
    client.outbox.close()
  }
})

test('public outbox never sends when identity fails or changes under the cookie', async () => {
  let person = 'jo', fail = true, sends = 0
  using _fetch = wire(() => {
    sends++
    return json(receipt)
  }, () => fail ? json({}, 503) : json({ person }))
  let failed = store(base), changed = store(base)
  try {
    await assertRejects(() => failed.apply(payload))
    assertEquals(sends, 0)
    fail = false
    await changed.outbox.ready
    person = 'al'
    await assertRejects(
      () => changed.apply(payload),
      Error,
      'person has changed',
    )
    assertEquals(sends, 0)
    assertEquals(changed.outbox.pending()[0].state, 'pending')
  } finally {
    failed.outbox.close()
    changed.outbox.close()
  }
})

test('public outbox fails closed when browser IndexedDB cannot open', async () => {
  let before = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
  let sends = 0
  using _fetch = wire(() => {
    sends++
    return json(receipt)
  })
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: {
      open: () => {
        throw new Error('disk unavailable')
      },
    },
  })
  let client = store(base)
  try {
    await assertRejects(() => client.outbox.ready, Error, 'disk unavailable')
    await assertRejects(() => client.apply(payload), Error, 'disk unavailable')
    assertEquals(sends, 0)
    assertEquals(client.outbox.pending(), [])
  } finally {
    client.outbox.close()
    if (before) Object.defineProperty(globalThis, 'indexedDB', before)
    else delete (globalThis as { indexedDB?: unknown }).indexedDB
  }
})

// Closing a page while its pre-send identity request is in flight cannot
// begin a write later, under a replacement page's cookie or transport.
test('public outbox closed during identity recheck never starts the write', async () => {
  let identity = Promise.withResolvers<Response>()
  let checking = Promise.withResolvers<void>()
  let client = store(base), checks = 0, sends = 0
  using _fetch = stub(globalThis, 'fetch', (url) => {
    if (String(url).endsWith('/me')) {
      if (++checks == 1) return Promise.resolve(json({ person: 'jo' }))
      checking.resolve()
      return identity.promise
    }
    sends++
    return Promise.resolve(json(receipt))
  })
  try {
    let answer = assertRejects(() => client.apply(payload), Error, 'closed')
    await checking.promise
    client.outbox.close()
    identity.resolve(json({ person: 'jo' }))
    await answer
    assertEquals(sends, 0)
  } finally {
    client.outbox.close()
    identity.resolve(json({ person: 'jo' }))
  }
})
