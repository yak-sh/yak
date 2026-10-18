import { equal, test, throws } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import { content, NAMES, suite } from './platform-waits.ts'

test('platform wait registration needs no probe or hand arguments', () => {
  let definition = suite()
  equal(definition.name, 'platform-waits')
  equal(definition.benches.map((b) => b.name), [...NAMES])
  equal(definition.benches.every((b) => b.unit == 'ms'), true)
  throws(() => suite(['a-deployed-account']))
})

test('platform HTML waits consume content, not just successful headers', async () => {
  let sent = false
  let body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('<h1>'))
      queueMicrotask(() => {
        sent = true
        controller.enqueue(new TextEncoder().encode('The saved app</h1>'))
        controller.close()
      })
    },
  })
  equal(
    await content(new Response(body), 'The saved app'),
    '<h1>The saved app</h1>',
  )
  equal(sent, true)
})

test('an error or unrelated page cannot bank a fast platform wait', async () => {
  await assertRejects(() =>
    content(new Response('The app', { status: 503 }), 'The app')
  )
  await assertRejects(() => content(new Response('Sign in'), 'The app'))
})

// Build requests before timing: these cases test admission, not URL parsing.
import { bindings, external } from './platform-forms.ts'
let paymentRequest = (
  path: string,
  key = String(bindings.STRIPE_KEY),
  method = 'POST',
) =>
  new Request(`https://api.stripe.com${path}`, {
    method,
    headers: { authorization: `Bearer ${key}` },
  })
let admitted = paymentRequest('/v1/checkout/sessions')
let rejected = [
  paymentRequest('/v1/checkout/sessions', 'sk_live_not_allowed'),
  paymentRequest('/v1/checkout/sessions', undefined, 'GET'),
  paymentRequest('/v1/charges'),
  paymentRequest('/v1/checkout/sessions?redirect=1'),
  new Request('https://other.invalid/v1/checkout/sessions', { method: 'POST' }),
]
test('platform local checkout fixture answers its admitted request', () => {
  equal(external(admitted)?.status, 200)
})
for (let [i, req] of rejected.entries()) {
  test(`platform payment fixture refuses unlisted request ${i}`, () => {
    equal(external(req), undefined)
  })
}
