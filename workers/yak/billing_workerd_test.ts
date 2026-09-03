// The paid tier through the whole kernel (billing.ts, T-33125): the webhook
// door as Stripe reaches it, and the plan it writes on a real space in a real
// store. billing_test.ts holds the derivation at its seam; this holds the
// things only a runtime can answer — that the route exists at all, that the
// Origin guard lets a server-to-server POST through, and that a duplicate and
// an out-of-order delivery leave the graph exactly where it was.
//
// The two `customer.subscription.*` events carry the whole subscription, so
// nothing here calls Stripe: the kernel boots with a webhook secret and no
// STRIPE_KEY, which is also the shape a deploy has before the owner sets one.
import { assert, assertEquals } from '@std/assert'
import { slow } from '../../src/testing.ts'
import { kernel, meta, seed } from './probe.ts'

let SECRET = 'whsec_a_probe_secret'

let hex = (b: ArrayBuffer) =>
  [...new Uint8Array(b)].map((n) => n.toString(16).padStart(2, '0')).join('')

// Stripe's own scheme: HMAC-SHA256 over `<timestamp>.<raw body>`, and the raw
// body is the exact string posted — so the test signs the same bytes it sends.
let signed = async (raw: string, at: number) => {
  let key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  let mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${at}.${raw}`),
  )
  return `t=${at},v1=${hex(mac)}`
}

let PERIOD = 1_900_000_000

let event = (
  type: string,
  space: string,
  over: Record<string, unknown> = {},
  created = Math.floor(Date.now() / 1000),
) =>
  JSON.stringify({
    id: `evt_${type}_${created}`,
    type,
    created,
    data: {
      object: {
        id: 'sub_probe',
        object: 'subscription',
        customer: 'cus_probe',
        status: 'active',
        metadata: { space },
        items: { data: [{ current_period_end: PERIOD }] },
        ...over,
      },
    },
  })

slow(
  'the webhook flips a plan, once, whatever order it arrives in',
  async () => {
    let k = await kernel({ STRIPE_WEBHOOK_SECRET: SECRET })
    try {
      let { cookie, eids } = await seed(k, [{
        slug: 'jeff',
        apps: ['recipes'],
      }])
      let space = eids['jeff']
      let graph = meta(k, cookie)
      // The plan as the graph holds it. `id=` answers the whole bundle, so this
      // is the row the webhook wrote and nothing else.
      let plan = async () =>
        ((await graph.query(`id=${space}`))[0] as {
          plan?: Record<string, string>
        }).plan

      let post = async (raw: string, at = Math.floor(Date.now() / 1000)) => {
        let r = await k.at('yaks.app', '/api/stripe/webhook', {
          method: 'POST',
          body: raw,
          headers: {
            'content-type': 'application/json',
            'stripe-signature': await signed(raw, at),
          },
        })
        return { status: r.status, body: await r.json() }
      }

      // Nothing paid for yet: the sweep has not run either, so there is no row.
      assertEquals(await plan(), undefined)

      // ---- the subscription starts ----
      let now = Math.floor(Date.now() / 1000)
      let started = event('customer.subscription.updated', space, {}, now)
      let first = await post(started, now)
      assertEquals(first.status, 200)
      assertEquals(first.body.did, 'jeff is plus')
      let paid = await plan()
      assertEquals(paid?.tier, 'plus')
      assertEquals(paid?.customer, 'cus_probe')
      assertEquals(paid?.subscription, 'sub_probe')
      assertEquals(paid?.status, 'active')
      assertEquals(paid?.until, new Date(PERIOD * 1000).toISOString())

      // ---- THE SAME EVENT AGAIN. At-least-once delivery is the normal case,
      // and it must write nothing at all rather than write the same thing twice.
      let again = await post(started, now)
      assertEquals(again.status, 200)
      assertEquals(again.body.did, 'unchanged')
      assertEquals(await plan(), paid, 'the row did not move')

      // ---- deleted, THEN an older updated. Stripe delivers out of order, and
      // the second of these was written BEFORE the cancellation: a system that
      // applied events as transitions would put this space back on Plus.
      let killed = now + 60
      let gone = await post(
        event(
          'customer.subscription.deleted',
          space,
          { status: 'canceled', ended_at: killed },
          killed,
        ),
        killed,
      )
      assertEquals(gone.body.did, 'jeff is free')
      let dead = await plan()
      assertEquals(dead?.tier, 'free')
      assertEquals(dead?.status, 'canceled')
      assertEquals(dead?.ending, new Date(killed * 1000).toISOString())

      let late = await post(
        event(
          'customer.subscription.updated',
          space,
          { status: 'active' },
          now,
        ),
        now,
      )
      assertEquals(late.status, 200)
      assertEquals(late.body.did, 'stale')
      assertEquals(await plan(), dead, 'a cancelled plan does not come back')
    } finally {
      await k.stop()
    }
  },
)

slow('an unsigned webhook is refused, and no Origin is not', async () => {
  let k = await kernel({ STRIPE_WEBHOOK_SECRET: SECRET })
  try {
    let { eids } = await seed(k, [{ slug: 'jeff', apps: ['recipes'] }])
    let raw = event('customer.subscription.updated', eids['jeff'])
    let at = Math.floor(Date.now() / 1000)

    let send = (headers: Record<string, string>) =>
      k.at('yaks.app', '/api/stripe/webhook', {
        method: 'POST',
        body: raw,
        headers: { 'content-type': 'application/json', ...headers },
      })

    // No signature, a signature over other bytes, and a signature that is
    // simply old: each is a 400 and none of them touches the graph.
    let bare = await send({})
    assertEquals(bare.status, 400)
    assertEquals((await bare.json()).error.code, 'bad_signature')

    let wrong = await send({ 'stripe-signature': await signed('{}', at) })
    assertEquals(wrong.status, 400)
    assertEquals(
      (await wrong.json()).error.message,
      'the signature does not match',
    )

    let old = await send({ 'stripe-signature': await signed(raw, at - 3600) })
    assertEquals((await old.json()).error.message, 'the signature is too old')

    // THE ONE THAT MATTERS. `/api/*` at the apex is behind the Origin guard
    // that separates spaces (route.ts `sameOrigin`, T-33118), and Stripe posts
    // server to server with NO Origin at all. An absent Origin is allowed
    // deliberately — a browser always sends one — and a webhook silently
    // 403ing is a plan that never activates, which nobody would see until a
    // customer complained. So: no Origin gets in...
    let stripe = await send({ 'stripe-signature': await signed(raw, at) })
    assertEquals(stripe.status, 200, 'Stripe sends no Origin and must get in')
    assertEquals((await stripe.json()).did, 'jeff is plus')

    // ...and a PAGE at somebody else's address still does not.
    let page = await send({
      'stripe-signature': await signed(raw, at),
      origin: 'https://evil.example',
    })
    assertEquals(page.status, 403)
    assertEquals((await page.json()).error.code, 'foreign_origin')
  } finally {
    await k.stop()
  }
})

slow('the billing doors say no before they say anything else', async () => {
  let k = await kernel()
  try {
    // Signed out, at both doors: the same refusal, and never a 500.
    for (let door of ['checkout', 'portal']) {
      let out = await k.at('yaks.app', `/api/billing/${door}`, {
        method: 'POST',
      })
      assertEquals(out.status, 401)
      assertEquals((await out.json()).error.code, 'unauthorized')
    }
    // A GET is not a door here, and neither is a name nobody wrote.
    let read = await k.at('yaks.app', '/api/billing/checkout')
    assertEquals(read.status, 405)
    await read.body?.cancel()
    let nowhere = await k.at('yaks.app', '/api/billing/nothing', {
      method: 'POST',
    })
    assertEquals(nowhere.status, 404)
    await nowhere.body?.cancel()

    // Signed in, with no STRIPE_KEY on this kernel: the door says the paid
    // tier is not switched on rather than throwing its way to a soft 500.
    let { cookie } = await seed(k, [{ slug: 'jeff', apps: [] }])
    let out = await k.at('yaks.app', '/api/billing/checkout', {
      method: 'POST',
      headers: { cookie },
    })
    assertEquals(out.status, 503)
    assertEquals((await out.json()).error.code, 'no_billing')

    // The signed-in page is where a purchase starts, and the only place: the
    // card names the plan they are on and carries the button that asks the
    // door above for a Stripe URL.
    let mine = await k.at('yaks.app', '/connect', { headers: { cookie } })
    assertEquals(mine.status, 200)
    let card = await mine.text()
    assert(card.includes('Your plan'), 'the card is on the connector page')
    assert(card.includes('Get Plus'), 'and it offers Plus to a free space')
    assert(
      !card.includes('Manage billing'),
      'but not billing nobody has ever had',
    )

    // And the informational page is there for anybody, with no way to buy on
    // it: the agent surface may link this and nothing else (C-33033).
    let page = await k.at('yaks.app', '/pricing')
    assertEquals(page.status, 200)
    let html = await page.text()
    assert(html.includes('$4'), 'the price is on the page')
    assert(
      !/api\/billing|checkout\.stripe\.com/.test(html),
      'and no way to start a purchase is',
    )
  } finally {
    await k.stop()
  }
})
