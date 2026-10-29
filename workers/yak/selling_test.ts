/// <reference lib="deno.ns" />
// Selling through the platform in memory: the shop example, checkout inputs,
// signed webhook refusals, account removal and the platform fee.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { test } from '@yaks/testing'
import * as apps from './apps.ts'
import { directory, stamp } from './directory.ts'
import * as dirPart from './directory.ts'
import type { Env } from './env.ts'
import { added, asked } from './examples/shop/cart.js'
import { signed } from './probe.ts'
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

test('a cart off the shop page is an ask the checkout door can price', async () => {
  await using k = await shopping()
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

test('the connect door refuses what Stripe did not sign', async () => {
  await using scenario = platform({ STRIPE_CONNECT_WEBHOOK_SECRET: WHSEC })
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
test('with no connect secret the door says so, and nothing else breaks', async () => {
  await using scenario = platform({ STRIPE_KEY: 'sk_probe' })
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
test('stopping selling forgets the account and calls nothing', async () => {
  await using scenario = platform({ STRIPE_CONNECT_WEBHOOK_SECRET: WHSEC })
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

test('the fee is an owner’s to set, and is charged on the next request', async () => {
  await using scenario = platform()
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

test('the fee is whole basis points, and never more than the sale', async () => {
  await using scenario = platform()
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
