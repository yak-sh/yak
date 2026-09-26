/// <reference lib="deno.ns" />
// Selling through yaks.app (sell.ts), driven through its doors the way a page,
// a seller and Stripe reach them: the shop example deployed and shopped in, a
// cart priced, paid, refunded and disputed at Stripe, a space connecting its
// own Stripe account, and the platform's fee. sell_test.ts holds the same
// module at its seams; this holds it over the platform in memory, from the
// kind of space serving_test.ts serves (serving-probe.ts), and against
// Stripe's own sandbox wherever money moves (probe.ts `stripeKey`).
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { until } from '../../bin/testing.ts'
import * as apps from './apps.ts'
import { directory, stamp } from './directory.ts'
import * as dirPart from './directory.ts'
import type { Env } from './env.ts'
import { added, asked } from './examples/shop/cart.js'
import { charged, delivered, merchant, signed, stripeKey } from './probe.ts'
import * as sell from './sell.ts'
import { call, type Ctx } from './tools.ts'
import { ADA, ADA_OWNS, as, platform, seeded, visit } from './serving-probe.ts'

// ---- the shop example, deployed and shopped in (T-34517) --------------------

// `workers/yak/examples/shop/` is the store recipe the selling guide teaches
// (public/docs/selling.md), and this is the proof it is an app and not a
// listing: the same bytes go up through `app_files`, `app_deploy` plants the
// `product` word and writes the seeded shirts, the storefront is served with
// its base and its reporter, and the inside of the app stays inside.
//
// Then the buying half, as far as this side of it goes. Taking money is the
// platform's door — `POST /api/pay/checkout`, on the seller's connected Stripe
// account (T-34525) — so the app holds no key, writes no worker, and has
// exactly one obligation: the items it posts must name products this store
// has, and must carry no money, because the door reads `price_cents` off the
// row itself. The order row and the buyer's letter are written by the Connect
// webhook (T-34526) and belong to its own test.
let SHOP = new URL('./examples/shop/', import.meta.url)

// Every file of the example, the way `app_files` takes a whole app in one
// call: text as text, and bytes as base64 (tools.ts `bytesOf` reads it back).
let base64 = (bytes: Uint8Array) =>
  btoa([...bytes].map((b) => String.fromCharCode(b)).join(''))

let shopFiles = async () => {
  let out: { path: string; content?: string; base64?: string }[] = []
  let walk = async (at: URL, under: string) => {
    for await (let e of Deno.readDir(at)) {
      let path = `${under}${e.name}`
      if (e.isDirectory) {
        await walk(new URL(`${e.name}/`, at), `${path}/`)
        continue
      }
      let bytes = await Deno.readFile(new URL(e.name, at))
      out.push(
        e.name.endsWith('.png')
          ? { path, base64: base64(bytes) }
          : { path, content: new TextDecoder().decode(bytes) },
      )
    }
  }
  await walk(SHOP, '')
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

// The space, the shop, and the tools' own context — the doors `app_files` and
// `app_deploy` are reached through, so what is deployed here is deployed the
// way an agent deploys it.
let shopping = async () => {
  let scenario = platform()
  let { env, files } = scenario
  let { dir, space } = await seeded(env)
  await dir.apply({
    entities: [{
      entity: { eid: '$shop' },
      doc: { title: 'The Shop' },
      app: {
        slug: 'shop',
        space: space.eid,
        version: 0,
        access: 'public',
        store: 'ada/shop.ccc333',
      },
      former: { slug: 'shop' },
    }],
  }, ADA_OWNS)
  let app = (await dir.app(space, 'shop'))!
  let ctx = { env, dir, person: ADA } as unknown as Ctx
  let deploy = async () => {
    await call(ctx, 'app_files', {
      space: 'ada',
      app: 'shop',
      files: await shopFiles(),
    })
    return (await call(ctx, 'app_deploy', { space: 'ada', app: 'shop' })).text
  }
  let shirts = async () =>
    await (await apps.fetch(visit('/shop/api/query?.product&?doc'), env))
      .json() as {
        entity: { eid: string }
        doc: { title: string }
        product: { price_cents: number; sizes: string }
      }[]
  return {
    [Symbol.dispose]: () => scenario[Symbol.dispose](),
    env,
    files,
    dir,
    space,
    app,
    ctx,
    deploy,
    shirts,
  }
}

// The platform's checkout door, as a page reaches it: same origin, under the
// app's own `/api/`, and no credential — the person buying has no account here
// and never will.
let paying = async (env: Env, body: unknown, cookie?: string) => {
  let res = await apps.fetch(
    visit('/shop/api/pay/checkout', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
      },
    }),
    env,
  )
  return { status: res.status, body: await res.json() }
}

Deno.test('the shop example deploys, seeds itself and serves its front', async () => {
  using k = await shopping()
  let out = await k.deploy()
  // The shop declares no components of its own, and that is the point: both
  // words it is made of are the platform's — `product`, which the checkout
  // door reads a price off, and `order`, which the platform writes when Stripe
  // says money moved — so there is no vocab.json here and nothing to plant.
  assertEquals(/\bcomponents:/.test(out), false, out)
  assertStringIncludes(out, 'seeded 3 entities')

  let shirts = await k.shirts()
  assertEquals(
    shirts.map((r) => r.doc.title).sort(),
    ['Everyday Tee — Charcoal', 'Everyday Tee — Oat', 'Long Sleeve — Moss'],
  )
  // Priced in whole cents, with the sizes the seller wrote.
  let charcoal = shirts.find((r) => r.doc.title.endsWith('Charcoal'))!
  assertEquals(charcoal.product.price_cents, 2800)
  assertEquals(charcoal.product.sizes, 'S, M, L, XL')

  // The storefront, as a shopper gets it.
  let page = await (await apps.fetch(visit('/shop/'), k.env)).text()
  assert(page.includes('<base href="/shop/">'), page.slice(0, 200))
  assert(page.includes('./api/pay/checkout'))
  // It holds no key and asks for none: an app that sells writes no Stripe
  // code at all.
  assertEquals(/sk_test|whsec_|api\.stripe\.com/.test(page), false)
  // The module beside it is served; the app's inside is not.
  assertEquals((await apps.fetch(visit('/shop/cart.js'), k.env)).status, 200)
  for (let inside of ['/shop/vocab.json', '/shop/seed/01-shirts.json']) {
    assertEquals((await apps.fetch(visit(inside), k.env)).status, 404, inside)
  }
  // And the icon it shipped, rather than the platform's tile.
  let icon = await apps.fetch(visit('/shop/icon.png'), k.env)
  assertEquals(icon.headers.get('content-type'), 'image/png')
  assertEquals(
    new Uint8Array(await icon.arrayBuffer()),
    await Deno.readFile(new URL('icon.png', SHOP)),
  )
})

Deno.test('a cart off the shop page is an ask the checkout door can price', async () => {
  using k = await shopping()
  await k.deploy()
  let shirts = await k.shirts()
  let tee = shirts.find((r) => r.doc.title.endsWith('Charcoal'))!
  let long = shirts.find((r) => r.doc.title.startsWith('Long'))!

  // The cart, built the way the page builds one, through the example's own
  // module: two of a shirt in M, and one long sleeve, which has no size.
  let cart = added(
    added([], { product: tee.entity.eid, options: 'M', qty: 2 }),
    { product: long.entity.eid },
  )
  let items = asked(cart)
  // What goes to the door names rows this store has, and says nothing about
  // money.
  assertEquals(items.map((i: { product: string }) => i.product), [
    tee.entity.eid,
    long.entity.eid,
  ])
  assertEquals(/price|amount|cent/.test(JSON.stringify(items)), false)
})

// ---- the same cart through the platform's door, and Stripe's sandbox -------
//
// The seller is a connected account in the sandbox that can take money
// (probe.ts `merchant`), so every call the door makes on the seller's behalf
// is made on that account and read back from it.
Deno.test('a cart is priced at Stripe, paid, refunded and disputed', async () => {
  let key = stripeKey()
  using k = await shopping()
  await k.deploy()
  let shirts = await k.shirts()
  let tee = shirts.find((r) => r.doc.title.endsWith('Charcoal'))!
  let long = shirts.find((r) => r.doc.title.startsWith('Long'))!
  let items = asked(added(
    added([], { product: tee.entity.eid, options: 'M', qty: 2 }),
    { product: long.entity.eid },
  ))
  let seller = await merchant(key)
  let on = (path: string, fields?: Record<string, unknown>) =>
    charged(key, path, fields, seller)
  // The session the door made, read back off Stripe with its line items.
  let held = async (url: string) => {
    let id = /cs_test_[A-Za-z0-9]+/.exec(url)?.[0]
    assert(id, `no checkout session in ${url}`)
    return await on(`/v1/checkout/sessions/${id}?expand[]=line_items`) as {
      id: string
      mode: string
      amount_total: number
      customer_email: string | null
      success_url: string
      cancel_url: string
      metadata: Record<string, string>
      line_items: {
        data: {
          description: string
          quantity: number
          price: { unit_amount: number }
        }[]
      }
    }
  }
  let cookie = await as(ADA)

  // A platform with no Stripe key of its own says so, in one sentence.
  let off = await paying(k.env, { items })
  assertEquals(off.status, 503)
  assertEquals(off.body.error.code, 'no_selling')

  k.env.STRIPE_KEY = key

  let free = await paying(k.env, { items })
  assertEquals(free.status, 403)
  assertEquals(free.body.error.code, 'plus_required')
  await stamp(k.env, {
    entities: [{ entity: { eid: k.space.eid }, plan: { tier: 'plus' } }],
  })

  // The shop is deployed and the space has not connected Stripe. That is the
  // refusal a page will actually meet — a seller deploys before they finish
  // Stripe's form nearly every time — so it is refused by name, with the way
  // out in the sentence.
  let early = await paying(k.env, { items })
  assertEquals(early.status, 409)
  assertEquals(early.body.error.code, 'not_selling')
  assertStringIncludes(early.body.error.message, 'has not connected')

  // Now the seller is ready.
  await stamp(k.env, {
    entities: [{
      entity: { eid: k.space.eid },
      stripe: {
        account: seller,
        charges_enabled: true,
        details_submitted: true,
      },
    }],
  })

  let paid = await paying(k.env, {
    items,
    email: 'ana@example.com',
    success: '?ordered={CHECKOUT_SESSION_ID}',
  })
  assertEquals(paid.status, 200, JSON.stringify(paid.body))
  assertStringIncludes(paid.body.url, 'checkout.stripe.com')

  // The door priced it off the store, and carried the size into the name the
  // buyer reads on Stripe's own page.
  let made = await held(paid.body.url)
  assertEquals(made.mode, 'payment')
  let [first, second] = made.line_items.data
  assertEquals(first.description, 'Everyday Tee — Charcoal (M)')
  assertEquals(first.price.unit_amount, 2800)
  assertEquals(first.quantity, 2)
  assertEquals(second.description, 'Long Sleeve — Moss')
  assertEquals(second.price.unit_amount, 3600)
  assertEquals(made.amount_total, 2800 * 2 + 3600)
  assertEquals(made.customer_email, 'ana@example.com')
  // Back inside the app, with Stripe's own literal intact.
  assertEquals(
    made.success_url,
    'https://ada.yaks.app/shop/?ordered={CHECKOUT_SESSION_ID}',
  )
  assertEquals(made.cancel_url, 'https://ada.yaks.app/shop/')
  // The two words the webhook routes by.
  assertEquals(made.metadata.space, k.space.eid)
  assertEquals(made.metadata.app, 'shop')

  // A product this store does not have is refused before Stripe is asked —
  // an eid off another app, or one somebody made up.
  let wrong = await paying(k.env, {
    items: [{ product: crypto.randomUUID(), qty: 1 }],
  })
  assertEquals(wrong.status, 400)
  assertStringIncludes(wrong.body.error.message, 'no product')
  // And a buyer cannot name their own price: there is nowhere to put one.
  let cheap = await paying(k.env, {
    items: [{ product: tee.entity.eid, qty: 1, price_cents: 1 }],
  })
  assertEquals(cheap.status, 200)
  let other = await held(cheap.body.url)
  assertEquals(other.line_items.data[0].price.unit_amount, 2800)
  // A third sale, for the dispute the seller loses below.
  let third = await held(
    (await paying(k.env, { items: [{ product: long.entity.eid }] })).body.url,
  )
  // Nor send the buyer anywhere but back into the app.
  let away = await paying(k.env, { items, success: 'https://evil.example/' })
  assertEquals(away.status, 400)
  assertStringIncludes(away.body.error.message, 'stay inside this app')

  // Downgrading blocks new checkouts, but the completed checkouts below
  // still file their orders, receipt, refund and dispute.
  await stamp(k.env, {
    entities: [{ entity: { eid: k.space.eid }, plan: { tier: 'free' } }],
  })
  let downgraded = await paying(k.env, { items })
  assertEquals(downgraded.status, 403)
  assertEquals(downgraded.body.error.code, 'plus_required')

  // ---- and the money moves (T-34526) ------------------------------------
  //
  // Stripe's checkout page is not a thing a test can drive, so each session
  // is paid the way the API pays: a PaymentIntent confirmed with one of
  // Stripe's test cards, carrying the metadata the door put on the session's
  // intent. What finishing the page adds to the session — paid, the intent,
  // the buyer's address — is laid over the session Stripe holds.
  let settle = async (
    session: typeof made,
    card: string,
    email?: string,
  ) => {
    let intent = await on('/v1/payment_intents', {
      amount: session.amount_total,
      currency: 'usd',
      payment_method: card,
      payment_method_types: { 0: 'card' },
      confirm: true,
      metadata: session.metadata,
    }) as { id: string; latest_charge: string; status: string }
    assertEquals(intent.status, 'succeeded')
    let did = await hook(k.env, 'checkout.session.completed', {
      ...session,
      status: 'complete',
      payment_status: 'paid',
      payment_intent: intent.id,
      customer_details: email ? { email } : null,
    }, seller)
    return { intent, did }
  }

  // One row lands in the shop's own store — written by the platform, as the
  // app, with a letter to the buyer beside it in the same batch.
  k.env.STRIPE_CONNECT_WEBHOOK_SECRET = WHSEC
  let sale = await settle(made, 'pm_card_visa', 'ana@example.com')
  assertEquals(sale.did, 'shop: paid 9200')

  let orders = async () =>
    await (await apps.fetch(
      visit('/shop/api/query?.order&?doc', { headers: { cookie } }),
      k.env,
    )).json() as {
      entity: { eid: string }
      order: Record<string, string | number>
    }[]
  let status = async (intent: string) =>
    (await orders()).find((o) => o.order.intent == intent)?.order.status
  let [order] = await orders()
  assertEquals(order.order.session, made.id)
  assertEquals(order.order.intent, sale.intent.id)
  assertEquals(order.order.account, seller)
  assertEquals(order.order.total_cents, 9200)
  // No rate is set, so the platform took nothing.
  assertEquals(order.order.fee_cents, 0)
  assertEquals(order.order.email, 'ana@example.com')
  assertEquals(order.order.status, 'paid')
  // The cart came back whole, product eids and the size and all.
  assertEquals(JSON.parse(String(order.order.items)).length, 2)

  // The buyer's letter, in the same batch, aimed at the address they typed
  // and carrying what they bought.
  let post = await (await apps.fetch(
    visit('/shop/api/query?.mail&?doc&?deliver', {
      headers: { cookie },
    }),
    k.env,
  )).json() as { doc: { title: string; body: string } }[]
  assertEquals(post.length, 1)
  assertStringIncludes(post[0].doc.title, 'Your order from')
  assertStringIncludes(post[0].doc.body, 'Everyday Tee — Charcoal (M) × 2')
  assertStringIncludes(post[0].doc.body, '**Total $92.00**')

  // ---- the same event again. At-least-once delivery is the normal case,
  // and the order's eid is derived from the session — so this addresses the
  // row already there, derives the same properties, and leaves one order.
  await hook(k.env, 'checkout.session.completed', {
    ...made,
    status: 'complete',
    payment_status: 'paid',
    payment_intent: sale.intent.id,
    customer_details: { email: 'ana@example.com' },
  }, seller)
  assertEquals((await orders()).length, 1, 'one sale, one order')

  // ---- refunded, at Stripe. The charge inherits the PaymentIntent's
  // metadata, which is why the door put it there: a refund knows nothing of a
  // session. Part of the charge first, then the rest (T-37887).
  let refund = async (amount?: number) => {
    await on('/v1/refunds', { payment_intent: sale.intent.id, amount })
    return await hook(
      k.env,
      'charge.refunded',
      await on(`/v1/charges/${sale.intent.latest_charge}`),
      seller,
    )
  }
  assertEquals(await refund(4600), 'shop: partially_refunded')
  assertEquals(await status(sale.intent.id), 'partially_refunded')
  assertEquals(await refund(), 'shop: refunded')
  assertEquals(await status(sale.intent.id), 'refunded')

  // ---- disputed. Stripe's dispute card is charged and then disputed; a
  // dispute carries no metadata at all, so its charge is read back from Stripe
  // on the seller's account and the metadata comes off that.
  type Dispute = { id: string; status: string }
  let disputed = async (session: typeof made, total: number) => {
    let fought = await settle(session, 'pm_card_createDispute')
    assertEquals(fought.did, `shop: paid ${total}`)
    let dispute = await until(
      async () =>
        ((await on(`/v1/disputes?payment_intent=${fought.intent.id}`)) as {
          data: Dispute[]
        }).data[0],
      { timeout: 30_000, poll: 1000, label: 'the dispute' },
    )
    assertEquals(
      await hook(k.env, 'charge.dispute.created', dispute, seller),
      'shop: disputed',
    )
    assertEquals(await status(fought.intent.id), 'disputed')
    return { intent: fought.intent.id, dispute }
  }
  // Stripe decides a dispute once it is answered, and settles it after a
  // moment; the event is the dispute as it then stands.
  let decided = async (dispute: Dispute, answer: Record<string, unknown>) => {
    await on(`/v1/disputes/${dispute.id}`, answer)
    let closed = await until(
      async () => {
        let now = await on(`/v1/disputes/${dispute.id}`) as Dispute
        return /^(won|lost)$/.test(now.status) && now
      },
      { timeout: 60_000, poll: 1000, label: `${dispute.id} decided` },
    )
    return await hook(k.env, 'charge.dispute.closed', closed, seller)
  }

  // ---- the dispute decided (T-37887): won puts the order back to paid,
  // with the evidence Stripe's sandbox decides for the seller on...
  let won = await disputed(other, 2800)
  let winning = {
    evidence: { uncategorized_text: 'winning_evidence' },
    submit: true,
  }
  assertEquals(await decided(won.dispute, winning), 'shop: paid')
  assertEquals(await status(won.intent), 'paid')
  // A closed dispute on an order no longer disputed moves nothing.
  let again = await on(`/v1/disputes/${won.dispute.id}`)
  assertEquals(
    await hook(k.env, 'charge.dispute.closed', again, seller),
    'unchanged',
  )
  // ...and lost, the seller conceding, says the buyer's bank took the money.
  let lost = await disputed(third, 3600)
  assertEquals(
    await hook(
      k.env,
      'charge.dispute.closed',
      await on(`/v1/disputes/${lost.dispute.id}/close`, {}),
      seller,
    ),
    'shop: lost',
  )
  assertEquals(await status(lost.intent), 'lost')

  // A charge the merchant made outside this platform, on the same account:
  // not ours, and not a break.
  let elsewhere = await on('/v1/payment_intents', {
    amount: 500,
    currency: 'usd',
    payment_method: 'pm_card_visa',
    payment_method_types: { 0: 'card' },
    confirm: true,
  }) as { id: string; latest_charge: string }
  await on('/v1/refunds', { payment_intent: elsewhere.id })
  assertEquals(
    await hook(
      k.env,
      'charge.refunded',
      await on(`/v1/charges/${elsewhere.latest_charge}`),
      seller,
    ),
    'not a sale of ours',
  )
})

// ---- selling (sell.ts, T-34524) --------------------------------------------
//
// The Connect webhook against a real directory: what an event from a seller's
// account does to the space it belongs to. The account and the onboarding link
// are made in Stripe's sandbox (probe.ts `stripeKey`), and read back from it.
//
// The space page's half of this — the three states an owner reads, and the
// button that posts back — is in mcp_load_test.ts instead: drawing that page
// reaches identity.ts for whether an assistant has ever connected, which
// wants the kernel whole. So the page is driven there, and the door is driven
// here.

// Where the space stands with selling, read back off the directory.
let sold = async (env: Env) =>
  (await directory({ fetch: (r: Request) => dirPart.fetch(r, env) }, true)
    .space('ada'))?.stripe

// The button on that page, as its form posts it. The page it is on is drawn in
// mcp_load_test.ts; the POST is apps.ts `saved` and reaches nothing that needs
// the kernel whole.
let pressed = async (env: Env, sell: string) =>
  await apps.fetch(
    new Request('https://yaks.app/manage/selling?space=ada', {
      method: 'POST',
      headers: {
        cookie: await as(ADA),
        origin: 'https://yaks.app',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: `sell=${sell}`,
    }),
    env,
  )

let WHSEC = 'whsec_a_connect_probe_secret'

// One event at the Connect door, signed with the secret the door was given —
// the hop Stripe cannot make to a test (probe.ts `delivered`). It answers
// what the door did.
let hook = async (env: Env, type: string, object: unknown, account: string) =>
  (JSON.parse(
    await delivered(
      {
        at: (host: string, path: string, init?: RequestInit) =>
          sell.fetch(new Request(`https://${host}${path}`, init), env),
      },
      '/stripe/connect',
      WHSEC,
      type,
      object,
      account,
    ),
  ) as { did: string }).did

Deno.test('a space connects Stripe, and the webhook makes it ready', async () => {
  let key = stripeKey()
  using scenario = platform({
    STRIPE_KEY: key,
    STRIPE_CONNECT_WEBHOOK_SECRET: WHSEC,
  })
  let { env } = scenario
  let { dir, space } = await seeded(env)
  let ctx = { env, dir, person: ADA } as unknown as Ctx
  let denied = () => call(ctx, 'space_sell', { space: 'ada' })
  await assertRejects(denied, Error, 'Plus')
  await assertRejects(() => sell.connect(env, space, ''), Error, 'Plus')
  await stamp(env, {
    entities: [{ entity: { eid: space.eid }, plan: { tier: 'plus' } }],
  })
  // Nothing connected.
  assertEquals(await sold(env), null)

  // The button. It answers a redirect to Stripe's own hosted form — the one
  // thing on that page that leaves the site.
  let went = await pressed(env, 'start')
  assertEquals(went.status, 303)
  let link = went.headers.get('location') ?? ''
  assertStringIncludes(link, 'https://connect.stripe.com/')

  // The id is written the moment Stripe answers with it, before the link is
  // asked for — so a person who wanders off mid-onboarding comes back to the
  // account they started rather than a second one.
  let account = (await sold(env))?.account ?? ''
  assert(account.startsWith('acct_'), account)
  try {
    assertEquals(await sold(env), {
      account,
      chargesEnabled: false,
      detailsSubmitted: false,
    })

    // What Stripe holds: the four controller properties that are the
    // charge-merchants-directly model.
    let made = await charged(key, `/v1/accounts/${account}`) as {
      controller: {
        fees: { payer: string }
        losses: { payments: string }
        stripe_dashboard: { type: string }
        requirement_collection: string
      }
    }
    assertEquals(made.controller.fees.payer, 'account')
    assertEquals(made.controller.losses.payments, 'stripe')
    assertEquals(made.controller.stripe_dashboard.type, 'full')
    assertEquals(made.controller.requirement_collection, 'stripe')

    // Pressing it again mints a new link on the same account — an account link
    // is single-use, and a second account would split one merchant's money
    // across books nobody can add up.
    let again = await pressed(env, 'start')
    assertEquals(again.status, 303)
    assertStringIncludes(again.headers.get('location') ?? '', 'connect.stripe')
    assertEquals((await sold(env))?.account, account, 'one account, ever')

    // ---- account.updated, as Stripe holds the account: nobody has been
    // through the form, which the row already says, so nothing moves.
    let updated = 'account.updated'
    assertEquals(await hook(env, updated, made, account), 'unchanged')

    // ---- and they are ready. Being ready is Stripe's verdict on a person's
    // identity form, which no test can fill in, so the two flags that verdict
    // sets are laid over the account Stripe holds.
    let ready = { ...made, charges_enabled: true, details_submitted: true }
    assertEquals(await hook(env, updated, ready, account), 'ada can sell')
    assertEquals(await sold(env), {
      account,
      chargesEnabled: true,
      detailsSubmitted: true,
    })

    // The same event again writes nothing at all: at-least-once delivery is
    // the normal case, and the row is derived rather than transitioned.
    assertEquals(await hook(env, updated, ready, account), 'unchanged')

    // ---- Stripe changes its mind: the account as it holds it again.
    assertEquals(await hook(env, updated, made, account), 'ada cannot sell')
    assertEquals((await sold(env))?.chargesEnabled, false)

    await stamp(env, {
      entities: [{ entity: { eid: space.eid }, plan: { tier: 'free' } }],
    })
    await assertRejects(denied, Error, 'Plus')

    // ---- the seller revokes us from their own dashboard. The event's object
    // is the platform's application, which the door does not read.
    assertEquals(
      await hook(
        env,
        'account.application.deauthorized',
        { object: 'application' },
        account,
      ),
      'ada disconnected',
    )
    // Forgotten here, and untouched at Stripe: the row is gone, the merchant
    // still has their account, their money and their records.
    assertEquals(await sold(env), null)

    // An event for an account nobody here sells through is answered 200 and
    // nothing else: a second delivery would find the same nothing, and making
    // Stripe repeat an unanswerable question for three days helps no one. The
    // platform's own account is one such.
    let platform = await charged(key, '/v1/account')
    assertEquals(
      await hook(env, updated, platform, String(platform.id)),
      'no space sells through that account',
    )
  } finally {
    // The sandbox keeps what a test made unless it is deleted.
    await charged(
      key,
      `/v1/accounts/${account}`,
      undefined,
      undefined,
      'DELETE',
    )
  }
})

Deno.test('the connect door refuses what Stripe did not sign', async () => {
  using scenario = platform({ STRIPE_CONNECT_WEBHOOK_SECRET: WHSEC })
  let { env } = scenario
  await seeded(env)
  let raw = '{"type":"account.updated"}'
  let post = (headers: Record<string, string>) =>
    sell.fetch(
      new Request('https://yaks.app/stripe/connect', {
        method: 'POST',
        body: raw,
        headers: { 'content-type': 'application/json', ...headers },
      }),
      env,
    )
  assertEquals((await post({})).status, 400)
  assertEquals(
    (await (await post({ 'stripe-signature': 't=1,v1=beef' })).json())
      .error.code,
    'bad_signature',
  )
  // The platform's secret is not this door's secret. Two endpoints, two
  // `whsec_`, and a door that verified the wrong one is a door answering
  // nothing.
  let at = Math.floor(Date.now() / 1000)
  assertEquals(
    (await post({
      'stripe-signature': await signed('whsec_the_other_one', raw, at),
    })).status,
    400,
  )
  // GET is not how an event arrives.
  assertEquals(
    (await sell.fetch(new Request('https://yaks.app/stripe/connect'), env))
      .status,
    405,
  )
})

// The secret is the owner's to set (README.md). Until he has, the door says so
// in one sentence — and every other half of selling still works, which is the
// whole reason it is a 503 rather than a boot failure.
Deno.test('with no connect secret the door says so, and nothing else breaks', async () => {
  using scenario = platform({ STRIPE_KEY: 'sk_probe' })
  let { env } = scenario
  await seeded(env)
  let res = await sell.fetch(
    new Request('https://yaks.app/stripe/connect', {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    }),
    env,
  )
  assertEquals(res.status, 503)
  assertEquals((await res.json()).error.code, 'no_selling')
})

// The one button a space can press without a Stripe key set is Stop, and it
// needs no Stripe call at all: forgetting an account is a write of ours.
Deno.test('stopping selling forgets the account and calls nothing', async () => {
  using scenario = platform({ STRIPE_CONNECT_WEBHOOK_SECRET: WHSEC })
  let { env } = scenario
  let { space } = await seeded(env)
  await stamp(env, {
    entities: [{
      entity: { eid: space.eid },
      stripe: {
        account: 'acct_probe',
        charges_enabled: true,
        details_submitted: true,
      },
    }],
  })
  assertEquals((await sold(env))?.chargesEnabled, true)
  assertEquals((await pressed(env, 'stop')).status, 303)
  assertEquals(await sold(env), null)
})

// ---- the fee (T-34554) -----------------------------------------------------

// The rate is a setting on the platform's own space row, not a number in the
// code, and this is the whole of what that has to mean: an owner of `yak` sets
// it, nobody else can, the next request is charged the new rate with nothing
// deployed, and the pricing page says what is being charged.
let feeAt = (env: Env, init: RequestInit = {}) =>
  sell.fees(new Request('https://yaks.app/api/fee', init), env)

let setting = (cookie: string, bps: string): RequestInit => ({
  method: 'POST',
  headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
  body: `bps=${bps}`,
})

// A seat in the platform's own space, which is what owning the platform IS.
let seated = async (env: Env, dir: ReturnType<typeof directory>) =>
  await stamp(env, {
    entities: [{
      entity: { eid: '$seat' },
      member: {
        space: (await dir.space('yak'))!.eid,
        person: ADA,
        role: 'owner',
      },
    }],
  })

Deno.test('the fee is an owner’s to set, and is charged on the next request', async () => {
  using scenario = platform()
  let { env } = scenario
  await seeded(env)
  let dir = directory({ fetch: (r: Request) => dirPart.fetch(r, env) }, true)
  let cookie = await as(ADA)
  // Ada owns her own space and is nobody in `yak`, so the platform's rate is
  // not hers to read or to move.
  assertEquals((await feeAt(env, { headers: { cookie } })).status, 403)
  assertEquals((await feeAt(env)).status, 403, 'nor a stranger with no cookie')
  await seated(env, dir)
  // Unset reads as nothing taken.
  assertEquals(await (await feeAt(env, { headers: { cookie } })).json(), {
    bps: 0,
    rate: '0%',
  })
  assertEquals(await (await feeAt(env, setting(cookie, '250'))).json(), {
    bps: 250,
    rate: '2.5%',
  })
  // The next request, with no deploy and no waiting out the read cache — the
  // write went through `stamp`, which empties it.
  assertEquals(await sell.feeOf(dir), 250)
  assertEquals(await (await feeAt(env, { headers: { cookie } })).json(), {
    bps: 250,
    rate: '2.5%',
  })
  // And the page a seller reads says the number the checkout will take.
  let page = await sell.priceAt(
    dir,
    new Response('<p>We take <span class="Fee">0%</span> of each sale.</p>'),
  )
  assertStringIncludes(await page.text(), 'We take <span class="Fee">2.5%<')
})

Deno.test('the fee is whole basis points, and never more than the sale', async () => {
  using scenario = platform()
  let { env } = scenario
  await seeded(env)
  let dir = directory({ fetch: (r: Request) => dirPart.fetch(r, env) }, true)
  let cookie = await as(ADA)
  await seated(env, dir)
  for (let no of ['-5', '2.5', '10001', 'lots', '']) {
    let res = await feeAt(env, setting(cookie, no))
    assertEquals(res.status, 400, no)
    assertEquals((await res.json()).error.code, 'bad_fee', no)
  }
  // The two ends that are not junk: nothing, and the whole sale.
  assertEquals((await feeAt(env, setting(cookie, '10000'))).status, 200)
  assertEquals((await feeAt(env, setting(cookie, '0'))).status, 200)
  assertEquals(await sell.feeOf(dir), 0)
})
