import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { delivered, fakeSub } from '@yaks/stripe/testing'
import {
  apexPost,
  fresh,
  meta,
  seed,
  tagged,
  unique,
  WEBHOOK_SECRET,
} from './probe.ts'

let k = await fresh({ STRIPE_KEY: 'sk_test_probe', STRIPE_PRICE: 'price_plus' })
let fixture = async () => {
  let slug = unique('subscriptions')
  let { eids } = await seed(k, [{ slug, apps: [] }])
  let space = eids[slug]
  let first = fakeSub(tagged(space))
  let second = fakeSub(tagged(space), { customer: first.customer })
  let post = (sub: unknown, at: number) =>
    delivered(
      apexPost(k),
      '/stripe/webhook',
      WEBHOOK_SECRET,
      'customer.subscription.updated',
      sub,
      '',
      at,
    )
  let now = Math.floor(Date.now() / 1000)
  await post(first, now)
  await post(second, now + 1)
  return { first, second, now, post, space }
}
let cases = [await fixture(), await fixture()]

for (let ending of [0, 1]) {
  test(`ending subscription ${ending} keeps the other paid subscription`, async () => {
    let f = cases[ending]
    let subs = [f.first, f.second]
    let real = globalThis.fetch
    using _ = stub(globalThis, 'fetch', (input, init) => {
      let at = new URL(String(input instanceof Request ? input.url : input))
      if (at.hostname != 'api.stripe.com') return real(input, init)
      assertEquals(at.pathname, '/v1/subscriptions')
      assertEquals(at.searchParams.get('customer'), f.first.customer)
      return Promise.resolve(Response.json({ data: subs, has_more: false }))
    })
    let plan = async () =>
      (await meta(k).query(`id=${f.space}`))[0].plan as {
        tier: string
        subscription: string
      }
    subs[ending].status = 'canceled'
    await f.post(subs[ending], f.now + 2)
    assertEquals((await plan()).tier, 'plus')
    assertEquals((await plan()).subscription, subs[1 - ending].id)
    subs[1 - ending].status = 'canceled'
    await f.post(subs[1 - ending], f.now + 3)
    assertEquals((await plan()).tier, 'free')
  })
}

addEventListener('unload', () => void k.stop())
