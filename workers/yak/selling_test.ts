import { line } from '@yaks/query'
import { KERNEL, meta, metaOf } from './meta.ts'
/// <reference lib="deno.ns" />
// Selling through the platform in memory: the shop example, checkout inputs,
// a seller's signed events, account removal and the platform fee.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { test } from '@yaks/testing'
import { stub } from '@std/testing/mock'
import { graph } from '@yaks/graph'
import { aliases } from '@yaks/alias'
import { keys } from '@yaks/key'
import { ram } from '@yaks/ram'
import { appVocab } from './vocab.ts'
import * as apps from './apps.ts'
import { appStore, directory, stamp } from './directory.ts'
import * as dirPart from './directory.ts'
import type { Env, Vars } from './env.ts'
import { added, asked } from './examples/shop/cart.js'
import { delivered } from '@yaks/stripe/testing'
import { paymentDoor } from './payment-doors.ts'
import * as sell from './sell.ts'
import { REACH, TAB_PERSON } from '@yaks/platform/page-graph'
import { packed } from '@yaks/host/payments'
import { call, type Ctx } from './tools.ts'
import {
  ADA,
  ADA_OWNS,
  as,
  SECRET,
  seeded,
  visit,
} from './serving-data-probe.ts'
import { platform as bindings } from './directory-rows-probe.ts'
import { lifecycleStores } from './app-lifecycle-probe.ts'
import { operators } from './operator-service-probe.ts'
import type { D1Like } from '@yaks/d1'
import { d1 } from '../../packages/d1/testing.ts'

let platform = (vars: Vars = {}) => {
  let scenario = bindings(SECRET, { BUILDER: operators, ...vars })
  return { ...scenario, ...lifecycleStores(scenario.env) }
}

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
  let { dir, space } = await seeded(env, 'public', scenario.dir)
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
    [Symbol.asyncDispose]: () => scenario[Symbol.asyncDispose](),
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

test('the shop example deploys, seeds itself and serves its front', async () => {
  await using k = await shopping()
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

// Cart behavior needs the shop's product rows, without another deployment.
let cartVocab = appVocab()
let cartStore = graph({
  vocab: cartVocab,
  storage: ram(cartVocab),
  plugins: [aliases(), keys(cartVocab)],
})
let shelf = await cartStore.apply(
  await Deno.readTextFile(new URL('seed/01-shirts.json', SHOP)).then(
    JSON.parse,
  ),
)

test('a cart off the shop page is an ask the checkout door can price', () => {
  let shirts = shelf.filter((row) => row.product) as {
    entity: { eid: string }
    doc: { title: string }
  }[]
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

// Where the space stands with selling, read back off the directory.
let sold = async (env: Env) =>
  (await directory({ fetch: (r: Request) => dirPart.fetch(r, env) })
    .space('ada'))?.seller

// A button on that page, as it writes `act` through the page graph's door
// (reach-door.ts), which reaches nothing that needs the kernel whole.
let pressed = async (env: Env, act: Record<string, unknown>) =>
  await apps.fetch(
    new Request(`https://yaks.app${REACH}/apply`, {
      method: 'POST',
      headers: {
        cookie: await as(ADA),
        [TAB_PERSON]: ADA,
        'content-type': 'application/json',
      },
      body: JSON.stringify([{ entity: { eid: crypto.randomUUID() }, ...act }]),
    }),
    env,
  )

// Where a button that leaves for the provider's page sends them.
let leaving = async (env: Env, space: string, door: string) => {
  let res = await pressed(env, { leave: { space, door } })
  assertEquals(res.status, 200)
  let [left] = await res.json() as { leave: { url: string } }[]
  return new URL(left.leave.url)
}

let WHSEC = 'whsec_a_connect_probe_secret'

// What the provider's Connect door did with one signed event about `on`'s
// account (payment-doors.ts), as Stripe would deliver it.
let connected =
  (env: Vars) =>
  async (type: string, object: Record<string, unknown>, on: string) =>
    (JSON.parse(
      await delivered(
        async (path, init) =>
          (await paymentDoor(
            new Request(`https://yaks.app${path}`, init),
            env as Env,
          ))!,
        '/stripe/connect',
        WHSEC,
        type,
        object,
        on,
      ),
    ) as { did: string }).did

// The one button a space can press without a Stripe key set is Stop, and it
// needs no Stripe call at all: forgetting an account is a write of ours.
test('a seller is updated by its events and stopped by its button', async () => {
  await using scenario = platform({ STRIPE_CONNECT_WEBHOOK_SECRET: WHSEC })
  let { env } = scenario
  let { space } = await seeded(env, 'public', scenario.dir)
  let seller = { via: 'stripe', account: 'acct_probe', submitted: true }
  await stamp(env, {
    entities: [{
      entity: { eid: space.eid },
      seller: { ...seller, ready: false },
    }],
  })
  assertEquals(await sold(env), { ...seller, ready: false })
  let updated = (charges_enabled: boolean) =>
    connected(env)(
      'account.updated',
      { id: 'acct_probe', charges_enabled, details_submitted: true },
      'acct_probe',
    )
  assertEquals(await updated(true), 'ada can sell')
  assertEquals(await sold(env), { ...seller, ready: true })
  assertEquals(await updated(true), 'unchanged')
  let stopped = await pressed(env, { sellStop: { space: space.eid } })
  assertEquals(stopped.status, 200)
  await stopped.body?.cancel()
  assertEquals(await sold(env), null)
  assertEquals(await updated(true), 'no space sells through that account')
})

// A buyer pays, the seller refunds part of it, and the buyer disputes the
// rest: each is one event from the seller's account, and each lands on the
// order the first one wrote in the app's own store. The dispute carries no
// metadata, so its charge is read back from Stripe on the seller's account.
test('a sale is filed, refunded, disputed and restored on its order', async () => {
  await using k = await shopping()
  await k.deploy()
  let [shirt] = await k.shirts()
  await stamp(k.env, {
    entities: [{
      entity: { eid: k.space.eid },
      seller: { via: 'stripe', account: 'acct_shop', ready: true },
    }],
  })
  let tags = { space: k.space.eid, app: 'shop' }
  let shop = connected({
    ...k.env,
    STRIPE_KEY: 'sk_probe',
    STRIPE_CONNECT_WEBHOOK_SECRET: WHSEC,
  })
  let heard = (type: string, object: Record<string, unknown>) =>
    shop(type, object, 'acct_shop')
  assertEquals(
    await heard('checkout.session.completed', {
      id: 'cs_shop',
      payment_intent: 'pi_shop',
      payment_status: 'paid',
      amount_total: 2800,
      customer_details: { email: 'ana@example.com' },
      metadata: {
        ...tags,
        items: packed([{ product: shirt.entity.eid, qty: 1 }]),
      },
    }),
    'shop: paid 2800',
  )
  let charge = { payment_intent: 'pi_shop', metadata: tags }
  assertEquals(
    await heard('charge.refunded', charge),
    'shop: partially_refunded',
  )
  assertEquals(
    await heard('checkout.session.completed', {
      id: 'cs_shop',
      payment_intent: 'pi_shop',
      payment_status: 'paid',
      amount_total: 2800,
      metadata: tags,
    }),
    'unchanged',
  )
  let real = globalThis.fetch
  let asked: string[] = []
  using _ = stub(globalThis, 'fetch', (url, init) => {
    if (!String(url).startsWith('https://api.stripe.com/')) {
      return real(url, init)
    }
    asked.push(new URL(String(url)).pathname)
    return Promise.resolve(Response.json(charge))
  })
  assertEquals(
    await heard('charge.dispute.created', { charge: 'ch_shop' }),
    'shop: disputed',
  )
  assertEquals(asked, ['/v1/charges/ch_shop'])
  assertEquals(
    await heard('charge.dispute.closed', { charge: 'ch_shop', status: 'won' }),
    'shop: paid',
  )
  // Decided again, it undoes nothing: the order is no longer disputed.
  assertEquals(
    await heard('charge.dispute.closed', { charge: 'ch_shop', status: 'lost' }),
    'unchanged',
  )
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

test('the fee is an owner’s to set, and is charged on the next request', async () => {
  await using scenario = platform()
  let { env } = scenario
  await seeded(env, 'public', scenario.dir)
  let dir = directory({ fetch: (r: Request) => dirPart.fetch(r, env) })
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
  let platformSpace = (await dir.space('yak'))!
  let [written] = await meta(env).query(line`.entity.eid=${platformSpace.eid}`)
  assertEquals((written.updated as { by: string }).by, ADA)
  assertEquals(typeof (written.updated as { via: string }).via, 'string')
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

test('the fee is whole basis points, and never more than the sale', async () => {
  await using scenario = platform()
  let { env } = scenario
  await seeded(env, 'public', scenario.dir)
  let dir = directory({ fetch: (r: Request) => dirPart.fetch(r, env) })
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

// ---- an account its owner already has (T-2970) ----------------------------

let KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))

// Stripe, as far as connecting an existing account reaches it: the code
// traded for the account's id, and the account read back. Every other call
// goes where it was going.
let stripeLinks = (account: Record<string, unknown>) => {
  let real = globalThis.fetch
  let asked: string[] = []
  let fetch = stub(globalThis, 'fetch', (url, init) => {
    let at = new URL(String(url))
    if (!at.host.endsWith('stripe.com')) return real(url, init)
    asked.push(at.host + at.pathname)
    return Promise.resolve(Response.json(
      at.pathname == '/oauth/token' ? { stripe_user_id: account.id } : account,
    ))
  })
  return { asked, [Symbol.dispose]: () => fetch.restore() }
}

// The provider handing someone back to the callback with `query`, signed in
// as `who`.
let returned = async (env: Env, query: string, who = ADA) =>
  (await sell.callback({
    env,
    path: sell.CALLBACK,
    space: null,
    req: new Request(`https://yaks.app${sell.CALLBACK}?${query}`, {
      headers: { cookie: await as(who) },
    }),
  }))!

test('an account its owner already has is connected instead of a new one', async () => {
  await using scenario = platform({
    STRIPE_KEY: 'sk_probe',
    STRIPE_CLIENT_ID: 'ca_probe',
    VAULT: d1() as unknown as D1Like,
    VAULT_KEY: KEY,
  })
  let { env } = scenario
  let { space } = await seeded(env, 'public', scenario.dir)
  await stamp(env, {
    entities: [{ entity: { eid: space.eid }, plan: { tier: 'plus' } }],
  })
  let page = await (await apps.fetch(
    new Request('https://yaks.app/manage/ada/selling', {
      headers: { cookie: await as(ADA) },
    }),
    env,
  )).text()
  assertStringIncludes(page, 'Create a Stripe account')
  assertStringIncludes(page, 'data-door="link"')
  // Pressing it sends them to Stripe's own page, which hands them back to
  // the callback with the state it was sent with.
  let to = await leaving(env, space.eid, 'link')
  assertEquals(
    to.origin + to.pathname,
    'https://connect.stripe.com/oauth/authorize',
  )
  assertEquals(to.searchParams.get('client_id'), 'ca_probe')
  assertEquals(
    to.searchParams.get('redirect_uri'),
    `https://yaks.app${sell.CALLBACK}`,
  )
  let state = to.searchParams.get('state')!
  using s = stripeLinks({
    id: 'acct_mine',
    charges_enabled: true,
    details_submitted: true,
  })
  // Somebody else's browser cannot finish it, and the attempt is spent.
  let stranger = await returned(env, `code=ac_1&state=${state}`, 'someone')
  assertEquals(stranger.headers.get('location'), sell.backTo(space, env))
  assertEquals(await sold(env), null)
  assertEquals(s.asked, [])
  // Begun again and finished by its owner, the account is the space's seller,
  // ready as Stripe says, and nothing new was opened at Stripe.
  let again = (await leaving(env, space.eid, 'link')).searchParams.get(
    'state',
  )!
  let back = await returned(env, `scope=read_write&code=ac_2&state=${again}`)
  assertEquals(back.status, 303)
  assertEquals(back.headers.get('location'), sell.backTo(space, env))
  assertStringIncludes(
    decodeURIComponent(back.headers.get('set-cookie')!),
    'Your Stripe account is connected.',
  )
  assertEquals(await sold(env), {
    via: 'stripe',
    account: 'acct_mine',
    ready: true,
    submitted: true,
  })
  assertEquals(s.asked, [
    'connect.stripe.com/oauth/token',
    'api.stripe.com/v1/accounts/acct_mine',
  ])
  // The same return twice connects nothing twice, and brings them back to
  // the page it was begun from, told so; a bare visit to the address, to
  // their spaces.
  let replayed = await returned(env, `code=ac_2&state=${again}`)
  assertEquals(s.asked.length, 2)
  assertEquals(replayed.headers.get('location'), sell.backTo(space, env))
  assertStringIncludes(
    decodeURIComponent(replayed.headers.get('set-cookie')!),
    'already used or has expired',
  )
  assertEquals(
    (await returned(env, '')).headers.get('location'),
    'https://yaks.app/manage',
  )
  // A space already taking payments is not offered a second account.
  let twice = await pressed(env, { leave: { space: space.eid, door: 'link' } })
  assertEquals(
    [twice.status, (await twice.json()).message],
    [409, 'ada is already taking payments'],
  )
  assertEquals(
    await sell.linkable(env, (await scenario.dir.space('ada'))!),
    false,
  )
})

// ---- the house (T-2983) ----------------------------------------------------

// An owner of `yak` marks a space as the house, and it sells on the platform's
// own account: its checkout names no account and takes no fee, whatever the
// rate, and the platform's own door hears its sale, refund and dispute naming
// none, finding the space by the tags the checkout carried.
test('the house sells on the platform’s own account and hears its sales there', async () => {
  await using k = await shopping()
  await k.deploy()
  let [shirt] = await k.shirts()
  let env = {
    ...k.env,
    STRIPE_KEY: 'sk_probe',
    STRIPE_WEBHOOK_SECRET: WHSEC,
  } as Env
  let dir = directory({ fetch: (r: Request) => dirPart.fetch(r, env) })
  let cookie = await as(ADA)
  let mark = (house: string) =>
    sell.houses(
      new Request('https://yaks.app/api/house', {
        ...setting(cookie, ''),
        body: `space=ada&house=${house}`,
      }),
      env,
    )
  assertEquals((await mark('true')).status, 403, 'only the platform’s owner')
  await seated(env, dir)
  await sell.fees(
    new Request('https://yaks.app/api/fee', setting(cookie, '250')),
    env,
  )
  assertEquals(await (await mark('true')).json(), { space: 'ada', house: true })
  assertEquals(await sold(env), {
    via: 'stripe',
    account: '',
    ready: true,
    submitted: true,
    house: true,
  })

  let real = globalThis.fetch
  let asked: { path: string; on: string | null; body: string }[] = []
  let charge = {
    payment_intent: 'pi_house',
    metadata: { space: k.space.eid, app: 'shop', house: 'true' },
  }
  using _ = stub(globalThis, 'fetch', (url, init) => {
    if (!String(url).startsWith('https://api.stripe.com/')) {
      return real(url, init)
    }
    asked.push({
      path: new URL(String(url)).pathname,
      on: new Headers(init?.headers).get('stripe-account'),
      body: decodeURIComponent(String(init?.body ?? '')),
    })
    return Promise.resolve(
      Response.json({ url: 'https://checkout.stripe.com/c', ...charge }),
    )
  })
  let space = { ...(await dir.space('ada'))!, tier: 'plus' as const }
  let paying = await sell.buying(env, {
    space,
    app: 'shop',
    root: 'https://ada.yaks.app/shop/',
  }, { items: [{ product: shirt.entity.eid, qty: 1 }] })
  assertEquals(paying.status, 200)
  let [made] = asked
  assertEquals(made.on, null)
  assert(!made.body.includes('application_fee_amount'))
  assertStringIncludes(made.body, 'metadata[fee]=0')
  assertStringIncludes(made.body, 'statement_descriptor_suffix]=ADA')

  let heard = async (type: string, object: Record<string, unknown>) =>
    (JSON.parse(
      await delivered(
        async (path, init) =>
          (await paymentDoor(
            new Request(`https://yaks.app${path}`, init),
            env,
          ))!,
        '/stripe/webhook',
        WHSEC,
        type,
        object,
      ),
    ) as { did: string }).did
  let session = {
    id: 'cs_house',
    mode: 'payment',
    payment_intent: 'pi_house',
    payment_status: 'paid',
    amount_total: 2800,
    metadata: {
      ...charge.metadata,
      fee: '0',
      items: packed([{ product: shirt.entity.eid, qty: 1 }]),
    },
  }
  assertEquals(
    await heard('checkout.session.completed', session),
    'shop: paid 2800',
  )
  // Its order names the platform's own account, '', which a refund is made
  // on.
  let [order] = await metaOf(appStore(env.STORE, space, k.app, env), {
    ...KERNEL,
    'x-yak-person': k.app.eid,
    'x-yak-role': 'editor',
  }).query(line`.order.intent=pi_house`)
  assertEquals((order.order as { account: string }).account, '')
  assertEquals(
    await heard('charge.refunded', { ...charge, refunded: true }),
    'shop: refunded',
  )
  assertEquals(
    await heard('charge.dispute.created', { charge: 'ch_house' }),
    'shop: disputed',
  )
  assertEquals(asked.at(-1)!.on, null, 'its charge is read on our own account')

  // Unmarked, the platform's door believes none of it.
  assertEquals(await (await mark('false')).json(), {
    space: 'ada',
    house: false,
  })
  assertEquals(await sold(env), null)
  assertEquals(
    await heard('charge.dispute.closed', { charge: 'ch_house', status: 'won' }),
    'not a house sale',
  )
})
