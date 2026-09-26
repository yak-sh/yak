// The Stripe client (stripe.ts): what goes on the wire, and a call asked
// again when it did not get through, against a Stripe stood in by `fetch`.
import { assert, assertEquals, assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import { FakeTime } from '@std/testing/time'
import { ask, form } from './stripe.ts'

// --- what goes on the wire to Stripe -------------------------------------

Deno.test('form encoding nests the way Stripe reads it', () => {
  assertEquals(
    form({
      mode: 'subscription',
      line_items: { 0: { price: 'price_1', quantity: 1 } },
      managed_payments: { enabled: true },
      metadata: { space: 'e1' },
      customer: null,
    }),
    [
      ['mode', 'subscription'],
      ['line_items[0][price]', 'price_1'],
      ['line_items[0][quantity]', '1'],
      ['managed_payments[enabled]', 'true'],
      ['metadata[space]', 'e1'],
    ],
  )
})

// --- one call, asked again when it did not get through --------------------

// Stripe as the answers it gives, one per call: a Response, or an Error the
// connection threw. `heard` is the headers each call carried.
let stripe = (...answers: (Response | Error)[]) => {
  let heard: Headers[] = []
  let fetch = stub(
    globalThis,
    'fetch',
    (_url: string | URL | Request, init?: RequestInit) => {
      heard.push(new Headers(init?.headers))
      let a = answers.shift()!
      return a instanceof Error ? Promise.reject(a) : Promise.resolve(a)
    },
  )
  return { heard, [Symbol.dispose]: () => fetch.restore() }
}
let KEY = { STRIPE_KEY: 'sk_test_1' }
let made = () => Response.json({ id: 'cus_1' })
let held = () =>
  Response.json({ error: { message: 'held' } }, {
    status: 409,
    headers: { 'stripe-should-retry': 'true' },
  })
let lost = () => new TypeError('Network connection lost.')

// `p`, with the fake clock run on until it settles, however many waits it
// takes on the way.
let settled = async <T>(time: FakeTime, p: Promise<T>) => {
  let done = false
  p.then(() => done = true, () => done = true)
  while (!done) await time.nextAsync()
  return p
}

Deno.test('a write that did not get through is asked again, as one write', async () => {
  for (let first of [lost(), held()]) {
    using time = new FakeTime()
    using s = stripe(first, made())
    let out = ask(KEY, '/v1/customers', { email: 'ana@books.example' })
    assertEquals(await settled(time, out), { id: 'cus_1' })
    assertEquals(s.heard.length, 2)
    let [a, b] = s.heard.map((h) => h.get('idempotency-key'))
    assert(a && a == b, 'one idempotency key for both tries')
  }
})

Deno.test('a refusal is said once, and a call never answered fails', async () => {
  {
    using s = stripe(
      Response.json({ error: { message: 'No such customer' } }, {
        status: 400,
      }),
    )
    await assertRejects(() => ask(KEY, '/v1/customers/cus_x'), 'No such')
    assertEquals(s.heard.length, 1)
  }
  using time = new FakeTime()
  using _ = stripe(lost(), lost(), lost(), lost())
  await assertRejects(
    () => settled(time, ask(KEY, '/v1/customers/cus_1')),
    TypeError,
  )
})
