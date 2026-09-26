// The paid tier through the whole kernel (billing.ts, T-33125): the webhook
// door as Stripe reaches it, and the plan it writes on a real space in a real
// store. billing_test.ts holds the derivation at its seam; this holds the
// things only a runtime can answer — that the route exists at all, that the
// Origin guard lets a server-to-server POST through, and that a duplicate and
// an out-of-order delivery leave the graph exactly where it was.
//
// The subscription in each event is one Stripe's sandbox holds (probe.ts
// `subscribed`), so the test needs STRIPE_KEY set to a test-mode key. The
// kernel itself boots with a webhook secret and no STRIPE_KEY — the events
// carry the whole subscription and the door reads nothing back — which is also
// the shape a deploy has before the owner sets one. Stripe cannot reach a
// loopback kernel, so the test signs each delivery with that secret.
import { assert, assertEquals } from '@std/assert'
import {
  charged,
  connector,
  delivered,
  kernel,
  meta,
  seed,
  signed,
  stripeKey,
  subscribed,
  WEBHOOK_SECRET,
} from './probe.ts'

Deno.test(
  'the webhook flips a plan, once, whatever order it arrives in',
  async () => {
    let key = stripeKey()
    let k = await kernel()
    try {
      let { eids } = await seed(k, [{
        slug: 'jeff2',
        apps: ['recipes'],
      }])
      let space = eids['jeff2']
      let graph = meta(k)
      // The plan as the graph holds it. `id=` answers the whole bundle, so this
      // is the row the webhook wrote and nothing else.
      let plan = async () =>
        ((await graph.query(`id=${space}`))[0] as {
          plan?: Record<string, string>
        }).plan
      let post = async (type: string, sub: unknown, at: number) =>
        (JSON.parse(
          await delivered(
            k,
            '/stripe/webhook',
            WEBHOOK_SECRET,
            type,
            sub,
            '',
            at,
          ),
        ) as { did: string }).did

      // Nothing paid for yet: the sweep has not run either, so there is no row.
      assertEquals(await plan(), undefined)

      // ---- the subscription starts ----
      let sub = await subscribed(k, key, { space }) as {
        id: string
        customer: string
        items: { data: { current_period_end: number }[] }
      }
      let now = Math.floor(Date.now() / 1000)
      let updated = 'customer.subscription.updated'
      assertEquals(await post(updated, sub, now), 'jeff2 is plus')
      let paid = await plan()
      assertEquals(paid?.tier, 'plus')
      assertEquals(paid?.customer, sub.customer)
      assertEquals(paid?.subscription, sub.id)
      assertEquals(paid?.status, 'active')
      assertEquals(
        paid?.until,
        new Date(sub.items.data[0].current_period_end * 1000).toISOString(),
      )

      // ---- the same event again. At-least-once delivery is the normal case,
      // and it must write nothing at all rather than write the same thing twice.
      assertEquals(await post(updated, sub, now), 'unchanged')
      assertEquals(await plan(), paid, 'the row did not move')

      // ---- deleted, then the older updated. Stripe delivers out of order, and
      // the second of these was written before the cancellation: a system that
      // applied events as transitions would put this space back on Plus.
      let ended = await charged(
        key,
        `/v1/subscriptions/${sub.id}`,
        undefined,
        undefined,
        'DELETE',
      ) as { ended_at: number }
      let deleted = 'customer.subscription.deleted'
      assertEquals(await post(deleted, ended, now + 60), 'jeff2 is free')
      let dead = await plan()
      assertEquals(dead?.tier, 'free')
      assertEquals(dead?.status, 'canceled')
      assertEquals(dead?.ending, new Date(ended.ended_at * 1000).toISOString())

      assertEquals(await post(updated, sub, now), 'stale')
      assertEquals(await plan(), dead, 'a cancelled plan does not come back')
    } finally {
      await k.stop()
    }
  },
)

// Every one of these is refused before its object is read, so the object need
// not be Stripe's: the refusals are the door's own. A delivery getting in with
// no Origin is the test above.
Deno.test('an unsigned webhook is refused, and so is a foreign Origin', async () => {
  let k = await kernel()
  try {
    await seed(k, [{ slug: 'jeff3', apps: ['recipes'] }])
    let raw = '{"type":"customer.subscription.updated"}'
    let at = Math.floor(Date.now() / 1000)

    let send = (headers: Record<string, string>) =>
      k.at('yaks.app', '/stripe/webhook', {
        method: 'POST',
        body: raw,
        headers: { 'content-type': 'application/json', ...headers },
      })

    // No signature, a signature over other bytes, and a signature that is
    // simply old: each is a 400 and none of them touches the graph.
    let bare = await send({})
    assertEquals(bare.status, 400)
    assertEquals((await bare.json()).error.code, 'bad_signature')

    let wrong = await send({
      'stripe-signature': await signed(WEBHOOK_SECRET, '{}', at),
    })
    assertEquals(wrong.status, 400)
    assertEquals(
      (await wrong.json()).error.message,
      'the signature does not match',
    )

    let old = await send({
      'stripe-signature': await signed(WEBHOOK_SECRET, raw, at - 3600),
    })
    assertEquals((await old.json()).error.message, 'the signature is too old')

    // This door is behind the Origin guard that separates spaces (route.ts
    // `sameOrigin`, `guarded`, T-33118). Stripe posts server to server with no
    // Origin at all, and an absent Origin is allowed deliberately — a browser
    // always sends one, and a webhook silently 403ing is a plan that never
    // activates. A page at somebody else's address, signature and all, still
    // does not get in.
    let page = await send({
      'stripe-signature': await signed(WEBHOOK_SECRET, raw, at),
      origin: 'https://evil.example',
    })
    assertEquals(page.status, 403)
    assertEquals((await page.json()).error.code, 'foreign_origin')

    // And none of those refusals was quiet. A webhook we cannot verify means
    // a secret has rolled or somebody is poking, and either is worth seeing:
    // it lands as an exception in the meta store, where the platform's own
    // breaks go, rather than on a log nobody opens.
    // Read as text, not parsed: the answer arrives with the unseen block
    // appended, which is these very exceptions being delivered — the channel
    // working is part of what is being asserted.
    let broke = await connector(k, k.owner.cookie).tool('graph_query', {
      space: 'yak',
      app: 'platform',
      query: '.exception',
    })
    assert(broke.includes('the signature does not match'), broke.slice(0, 400))
  } finally {
    await k.stop()
  }
})

Deno.test('the billing doors say no before they say anything else', async () => {
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

    let { cookie } = await seed(k, [{ slug: 'jeff4', apps: [] }])

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
    assert(html.includes('$9'), 'the price is on the page')
    assert(
      !/api\/billing|checkout\.stripe\.com/.test(html),
      'and no way to start a purchase is',
    )
  } finally {
    await k.stop()
  }
})
