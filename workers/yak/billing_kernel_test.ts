// The paid tier through the whole kernel (billing.ts, T-33125): the webhook
// door as Stripe reaches it, and the plan it writes on a real space in a real
// store. billing_test.ts holds the derivation at its seam; this holds the
// things only a runtime can answer — that the route exists at all, that the
// Origin guard lets a server-to-server POST through, and that a duplicate and
// an out-of-order delivery leave the graph exactly where it was.
//
// The door reads the whole subscription off the event and asks Stripe nothing
// back, so the subscription each event carries is a fabricated one
// (@yaks/stripe/testing `fakeSub`), the shape its plans `read` reads — the
// subject here is the route, the Origin guard and idempotent, out-of-order
// delivery, none of which is the purchase (roster_test.ts holds that against Stripe). The kernel boots
// with a webhook secret and no STRIPE_KEY, the shape a deploy has before the
// owner sets one; Stripe cannot reach a loopback kernel, so the test signs each
// delivery with that secret.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertMatch } from '@std/assert'
import { stub } from '@std/testing/mock'
import { managePath } from '@yaks/platform/routes'
import { REACH, TAB_PERSON } from '@yaks/platform/page-graph'
import {
  apexPost,
  fresh,
  kernel,
  meta,
  seed,
  tagged,
  unique,
  WEBHOOK_SECRET,
} from './probe.ts'
import { delivered, fakeSub, signed } from '@yaks/stripe/testing'
import { GET_PLAN } from '@yaks/platform/routes'
import { PRICE, STARTER, SUBSCRIBED } from '@yaks/platform/plans'

test(
  'the webhook flips a plan, once, whatever order it arrives in, and gives its credit once',
  async () => {
    let k = await kernel()
    let jeff2 = unique('jeff2')
    try {
      let { eids, person, email } = await seed(k, [{
        slug: jeff2,
        apps: ['recipes'],
      }])
      let space = eids[jeff2]
      let graph = meta(k)
      // The plan as the graph holds it. `id=` answers the whole bundle, so this
      // is the row the webhook wrote and nothing else.
      let plan = async () =>
        ((await graph.query(`id=${space}`))[0] as {
          plan?: Record<string, string>
        }).plan
      // The building credit it holds once, and the space its owner's first
      // subscription gave it to.
      let starter = async () =>
        ((await graph.query(`id=${space}`))[0] as {
          starter?: { dollars?: number }
        }).starter?.dollars
      let subscribed = async () =>
        ((await graph.query(`id=${person}`))[0] as {
          subscribed?: { space?: string }
        }).subscribed?.space
      let post = async (type: string, sub: unknown, at: number) =>
        (JSON.parse(
          await delivered(
            apexPost(k),
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
      let name = async () =>
        ((await graph.query(`id=${person}`))[0].doc as { title?: string })
          ?.title
      let before = await name()
      let checkout = {
        id: 'cs_names',
        mode: 'payment',
        payment_status: 'unpaid',
        metadata: { ...tagged(space), person },
      }
      let completed = 'checkout.session.completed'
      await post(completed, {
        ...checkout,
        customer_details: {
          name: 'Someone Else',
          email: 'someone@example.com',
        },
      }, Math.floor(Date.now() / 1000))
      assertEquals(await name(), before)
      await post(completed, {
        ...checkout,
        customer_details: { name: 'Jeff Peterson', email },
      }, Math.floor(Date.now() / 1000))
      assertEquals(await name(), 'Jeff Peterson')

      // ---- the subscription starts ----
      let sub = fakeSub(tagged(space))
      let now = Math.floor(Date.now() / 1000)
      let updated = 'customer.subscription.updated'
      assertEquals(await post(updated, sub, now), `${jeff2} is plus`)
      let paid = await plan()
      assertEquals(paid?.tier, 'plus')
      assertEquals(paid?.customer, sub.customer)
      assertEquals(paid?.subscription, sub.id)
      assertEquals(paid?.status, 'active')
      assertEquals(await starter(), STARTER + SUBSCRIBED)
      assertEquals(await subscribed(), space)
      assertEquals(
        paid?.until,
        new Date(sub.current_period_end * 1000).toISOString(),
      )

      // ---- the same event again. At-least-once delivery is the normal case,
      // and it must write nothing at all rather than write the same thing twice.
      assertEquals(await post(updated, sub, now), 'unchanged')
      assertEquals(await plan(), paid, 'the row did not move')

      // ---- deleted, then the older updated. Stripe delivers out of order, and
      // the second of these was written before the cancellation: a system that
      // applied events as transitions would put this space back on Plus. The
      // cancellation is the same subscription Stripe never moves out of
      // `canceled` (billing.ts rule 1), carrying when it ended.
      let endedAt = now + 30
      let ended = { ...sub, status: 'canceled', ended_at: endedAt }
      let deleted = 'customer.subscription.deleted'
      assertEquals(await post(deleted, ended, now + 60), `${jeff2} is free`)
      let dead = await plan()
      assertEquals(dead?.tier, 'free')
      assertEquals(dead?.status, 'canceled')
      assertEquals(dead?.ending, new Date(endedAt * 1000).toISOString())

      assertEquals(await post(updated, sub, now), 'stale')
      assertEquals(await plan(), dead, 'a cancelled plan does not come back')

      // ---- subscribing again is no first subscription: no second credit.
      let again = fakeSub(tagged(space))
      assertEquals(await post(updated, again, now + 90), `${jeff2} is plus`)
      assertEquals(await starter(), STARTER + SUBSCRIBED)
    } finally {
      await k.stop()
    }
  },
)

// Every one of these is refused before its object is read, so the object need
// not be Stripe's: the refusals are the door's own. A delivery getting in with
// no Origin is the test above.
test('an unsigned webhook is refused, and so is a foreign Origin', async () => {
  let k = await kernel()
  let jeff3 = unique('jeff3')
  let before = k.reported.length
  try {
    await seed(k, [{ slug: jeff3, apps: ['recipes'] }])
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

    // This door is behind the Origin guard that separates spaces (@yaks/platform/routes
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

    // A well-formed, fresh signature that does not match is what Stripe's
    // delivery looks like when our secret is wrong, so it reaches the platform
    // tracker though the webhook answers it. No signature, a stale one, and a
    // foreign Origin are the caller's own refusals, which anyone can send.
    await k.flushReports()
    let said = (text: string) =>
      k.reported.slice(before).filter((row) => row.error).some((row) =>
        (row.exception as { value: string }).value.includes(text)
      )
    assertEquals(
      [
        'the signature does not match',
        'no Stripe-Signature header',
        'the signature is too old',
        'foreign_origin',
      ].map(said),
      [true, false, false, false],
    )
  } finally {
    await k.stop()
  }
})

test('the billing doors say no before they say anything else', async () => {
  // The Plus plan is on sale, so its Billing page offers it.
  let k = await fresh({
    STRIPE_KEY: 'sk_test_probe',
    STRIPE_PRICE: 'price_plus',
  })
  let jeff4 = unique('jeff4')
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

    let { cookie } = await seed(k, [{ slug: jeff4, apps: [] }])

    // The space's Billing page is where a purchase starts, and the only
    // place: the card names the plan they are on and carries the button that
    // asks its door for a Stripe URL.
    let mine = await k.at('yaks.app', managePath('billing', jeff4), {
      headers: { cookie },
    })
    assertEquals(mine.status, 200)
    let card = await mine.text()
    assert(card.includes('>Plan<'), 'the card is on the Billing page')
    assert(
      card.includes('Get the Plus plan'),
      'and it offers the Plus plan to a free space',
    )
    assert(
      !card.includes('Manage billing'),
      'but not billing nobody has ever had',
    )

    // A plan's Get Started on the home and pricing pages, followed by
    // somebody signed in, lands on the Billing page of the space they open
    // first, where the card offers the plan.
    let to: string = GET_PLAN
    let hops = 0
    let landed
    for (;;) {
      landed = await k.at('yaks.app', to, {
        headers: { cookie },
        redirect: 'manual',
      })
      let next = landed.headers.get('location')
      if (!next) break
      await landed.body?.cancel()
      to = new URL(next, 'https://yaks.app').pathname
      assert(++hops < 5, 'Get Started goes round in circles')
    }
    assertMatch(to, /^\/manage\/[a-z0-9-]+\/billing$/)
    assertEquals(landed.status, 200)
    assert(
      (await landed.text()).includes('Get the Plus plan'),
      'the Billing page offers the Plus plan',
    )

    // And the informational page is there for anybody, with no way to buy on
    // it: the agent surface may link this and nothing else (C-33033).
    let page = await k.at('yaks.app', '/pricing')
    assertEquals(page.status, 200)
    let html = await page.text()
    assert(html.includes(`$${PRICE.plus} a month`), 'the price is on the page')
    assert(
      !/api\/billing|checkout\.stripe\.com/.test(html),
      'and no way to start a purchase is',
    )
  } finally {
    await k.stop()
  }
})

// The pay-by-invoice form (T-773): asking sends an invoice and starts nothing.
// The plan starts when the invoice is paid, and stops once a later one is
// past due. api.stripe.com is stood in for, answering the subscription as it
// stands at each moment: `active` from the start, as Stripe calls one sent
// its invoices, with its latest invoice.
test('an invoiced plan starts when its invoice is paid, and stops past due', async () => {
  let now = Math.floor(Date.now() / 1000)
  let space = ''
  let sub = (bill: string, over: Record<string, unknown> = {}) => ({
    id: 'sub_invoiced',
    customer: 'cus_invoiced',
    status: 'active',
    collection_method: 'send_invoice',
    created: now,
    start_date: now,
    current_period_start: now,
    latest_invoice: { status: bill, total: 49000 },
    metadata: tagged(space),
    items: {
      data: [{
        price: { id: 'price_pro_year' },
        current_period_end: now + 365 * 86400,
      }],
    },
    ...over,
  })
  let stands = sub('draft')
  let real = globalThis.fetch
  using _ = stub(globalThis, 'fetch', (input, init) => {
    let url = String(input instanceof Request ? input.url : input)
    if (!url.startsWith('https://api.stripe.com')) return real(input, init)
    let path = new URL(url).pathname
    // A call may reach fetch as a Request, carrying its own method.
    let method = input instanceof Request ? input.method : init?.method
    return Promise.resolve(Response.json(
      path == '/v1/subscriptions' && (method ?? 'GET') == 'GET'
        ? { data: [stands], has_more: false }
        : path.startsWith('/v1/subscriptions')
        ? stands
        : { id: 'cus_invoiced' },
    ))
  })
  let k = await fresh({
    STRIPE_KEY: 'sk_test_probe',
    STRIPE_PRICE: 'price_plus',
    STRIPE_PRICE_PRO: 'price_pro_month',
    STRIPE_PRICE_PRO_YEAR: 'price_pro_year',
  })
  try {
    let slug = unique('inv')
    let them = await seed(k, [{ slug, apps: [] }])
    space = them.eids[slug]
    stands = sub('draft')
    let plan = async () =>
      ((await meta(k).query(`id=${space}`))[0] as {
        plan?: Record<string, string>
      }).plan
    // The Billing page's invoice form, as it writes through the page graph's
    // door (reach-door.ts).
    let ask = () =>
      k.at('yaks.app', `${REACH}/apply`, {
        method: 'POST',
        headers: {
          cookie: them.cookie,
          [TAB_PERSON]: them.person,
          'content-type': 'application/json',
        },
        body: JSON.stringify([{
          entity: { eid: crypto.randomUUID() },
          invoiceAsk: {
            space,
            email: 'clerk@township.test',
            name: 'Hollow Township',
          },
        }]),
      })
    let post = async (type: string, object: unknown, at: number) =>
      (JSON.parse(
        await delivered(
          apexPost(k),
          '/stripe/webhook',
          WEBHOOK_SECRET,
          type,
          object,
          '',
          at,
        ),
      ) as { did: string }).did

    let asked = await ask()
    assertEquals(asked.status, 200, await asked.clone().text())
    await asked.body?.cancel()
    let waiting = await plan()
    // A row with no tier is the free plan: nothing about it moved.
    assertEquals([waiting?.tier ?? 'free', waiting?.status], [
      'free',
      'incomplete',
    ])
    assertEquals(waiting?.subscription, 'sub_invoiced')

    // Asked again while the first waits: refused, so nothing bills twice.
    let again = await ask()
    assertEquals(again.status, 400)
    assertMatch(await again.text(), /waiting on its first invoice/)

    // The invoice is paid: Stripe says so, and the plan starts.
    stands = sub('paid')
    let paid = {
      object: 'invoice',
      parent: {
        subscription_details: {
          subscription: 'sub_invoiced',
          metadata: tagged(space),
        },
      },
    }
    assertEquals(await post('invoice.paid', paid, now + 10), `${slug} is pro`)
    assertEquals((await plan())?.tier, 'pro')

    // A year on, the renewal's invoice is past due: the plan stops.
    stands = sub('open', { status: 'past_due' })
    assertEquals(
      await post('customer.subscription.updated', stands, now + 20),
      `${slug} is free`,
    )
    let late = await plan()
    assertEquals([late?.tier, late?.status], ['free', 'unpaid'])
  } finally {
    await k.stop()
  }
})
