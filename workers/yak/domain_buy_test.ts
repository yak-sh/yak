// A domain bought through the whole kernel (@yaks/domains, T-1314): the paid
// checkout's webhook writes one order however often it is told, the
// directory's effect registers the name at the Registrar stand-in, makes its
// zone and attaches it with every record written, and its renewal follows the
// space's plan. The checkout itself is the signed-in plan settings' button
// (billing.ts `buyDomain`); the connector only searches.
import { equal, ok, test } from '@yaks/testing'
import { delivered } from '@yaks/stripe/testing'
import { parseHTML } from 'linkedom'
import {
  apexPost,
  connector,
  fresh,
  onPlus,
  registered,
  seed,
  tagged,
  WEBHOOK_SECRET,
  zoneRecords,
} from './probe.ts'
import { stamp } from './directory.ts'
import type { Env } from './env.ts'
import { stub } from '@std/testing/mock'

// A checkout for `name` paid on the Stripe webhook, live unless it says not.
let pay = (
  k: Awaited<ReturnType<typeof fresh>>,
  space: string,
  serves: string,
  name: string,
  id: string,
  livemode = true,
) =>
  delivered(
    apexPost(k),
    '/stripe/webhook',
    WEBHOOK_SECRET,
    'checkout.session.completed',
    {
      id,
      livemode,
      mode: 'payment',
      payment_status: 'paid',
      client_reference_id: space,
      metadata: { ...tagged(space), domain: name, serves, cents: '1044' },
    },
  ).then((said) => JSON.parse(said).did)

test('a paid domain registers once, attaches to its app with its DNS written, and renews while the plan pays', async () => {
  let env!: Env
  let k = await fresh({ CF_REGISTRAR_TOKEN: 'a-token' }, (e) => env = e)
  let { eids, cookie } = await seed(k, [{ slug: 'bakery', apps: ['menu'] }])
  let space = eids.bakery
  await onPlus(k, space)
  let app = (await k.dir.apps((await k.dir.at(space))!))
    .find((a) => a.slug == 'menu')!
  let name = 'bakery-menu.com'

  let found = await connector(k, cookie).tool('domain_search', {
    space: 'bakery',
    query: 'bakery-menu',
  })
  ok(found.includes('bakery-menu.com — $10.44 for the first year'), found)
  ok(found.includes('/manage/bakery/domains'), found)

  let paid = () => pay(k, space, app.eid, name, 'cs_domain')
  equal(await paid(), `bakery bought ${name}`)
  equal(await paid(), 'already ordered')
  await k.settled()

  let host = (await k.dir.hosts((await k.dir.at(space))!))
    .find((h) => h.name == name)!
  equal([host.serves, !!host.verified], [app.eid, true])
  equal(await registered(k), { [name]: { auto_renew: true } })
  let written = (await zoneRecords(k)).filter((r) => r.includes(name))
  ok(written.includes(`CNAME ${name} origin.saas.yaks.app`), written.join('\n'))
  ok(written.some((r) => r.startsWith(`TXT _cf-custom-hostname.${name}`)))

  // Off a paid plan, it stops renewing; back on one, it renews again.
  await stamp(env, {
    entities: [{ entity: { eid: space }, plan: { tier: 'free' } }],
  })
  await k.settled()
  equal(await registered(k), { [name]: { auto_renew: false } })
  await stamp(env, {
    entities: [{ entity: { eid: space }, plan: { tier: 'plus' } }],
  })
  await k.settled()
  equal(await registered(k), { [name]: { auto_renew: true } })
})

test('a sandbox payment and a second checkout for a taken name are refunded once each, and register nothing more', async () => {
  let refunds: string[] = []
  let real = globalThis.fetch
  using _ = stub(globalThis, 'fetch', async (input, init) => {
    let req = new Request(input, init)
    if (!req.url.startsWith('https://api.stripe.com')) return real(input, init)
    let { pathname } = new URL(req.url)
    let session = /^\/v1\/checkout\/sessions\/(.+)$/.exec(pathname)?.[1]
    if (session) {
      return Response.json({
        payment_intent: `pi_${session}`,
        amount_total: 1044,
      })
    }
    if (req.method != 'POST') {
      return Response.json({ data: [], has_more: false })
    }
    let body = new URLSearchParams(await req.text())
    refunds.push(`${body.get('payment_intent')} ${body.get('amount')}`)
    return Response.json({
      id: `re_${refunds.length}`,
      payment_intent: body.get('payment_intent'),
      amount: Number(body.get('amount')),
      status: 'succeeded',
    })
  })
  let k = await fresh({ CF_REGISTRAR_TOKEN: 'a-token', STRIPE_KEY: 'sk_test' })
  let { eids } = await seed(k, [{ slug: 'cafe', apps: [] }, {
    slug: 'diner',
    apps: [],
  }])
  await onPlus(k, eids.cafe)
  await onPlus(k, eids.diner)
  let name = 'cafe-menu.com'
  equal(
    await pay(k, eids.cafe, eids.cafe, name, 'cs_sandbox', false),
    `cafe bought ${name}`,
  )
  await k.settled()
  equal(await registered(k), {})
  equal(
    await pay(k, eids.cafe, eids.cafe, name, 'cs_cafe'),
    `cafe bought ${name}`,
  )
  await k.settled()
  equal(
    await pay(k, eids.diner, eids.diner, name, 'cs_diner'),
    `diner bought ${name}`,
  )
  await k.settled()
  equal(await registered(k), { [name]: { auto_renew: true } })
  equal(refunds, ['pi_cs_sandbox 1044', 'pi_cs_diner 1044'])
  let host = (await k.dir.hosts((await k.dir.at(eids.cafe))!))
    .find((h) => h.name == name)!
  equal(host.serves, eids.cafe)
})

test('Domains quotes checkout, changes the destination, and transfers ownership on acceptance', async () => {
  let checkout: URLSearchParams | undefined
  let fetcher = globalThis.fetch
  using _ = stub(globalThis, 'fetch', async (input, init) => {
    let req = new Request(input, init)
    if (!req.url.startsWith('https://api.stripe.com')) {
      return fetcher(input, init)
    }
    if (new URL(req.url).pathname == '/v1/checkout/sessions') {
      checkout = new URLSearchParams(await req.text())
      return Response.json({
        id: 'cs_name',
        url: 'https://checkout.stripe.com/session',
      })
    }
    return Response.json(
      req.method == 'POST' ? { id: 'cus_domains' } : {
        data: [],
        has_more: false,
      },
    )
  })
  let k = await fresh({
    CF_REGISTRAR_TOKEN: 'a-token',
    STRIPE_KEY: 'sk_test_probe',
  })
  let { cookie, eids } = await seed(k, [{
    slug: 'studio',
    apps: ['one', 'two'],
  }, {
    slug: 'other-studio',
    apps: ['elsewhere'],
  }])
  let space = (await k.dir.at(eids.studio))!
  let [one, two] = (await k.dir.apps(space)).sort((a, b) =>
    a.slug.localeCompare(b.slug)
  )
  let [other] = await k.dir.apps((await k.dir.at(eids['other-studio']))!)
  await onPlus(k, space.eid)
  let path = '/manage/studio/domains'
  let read = async (at: string) =>
    await (await k.at('yaks.app', at, { headers: { cookie } })).text()
  let post = (body: Record<string, string>) =>
    k.at('yaks.app', path, {
      method: 'POST',
      headers: {
        cookie,
        origin: 'https://yaks.app',
        accept: 'application/json',
      },
      body: new URLSearchParams(body),
    })
  let search = (q: string) => read(path + '?search=' + encodeURIComponent(q))

  let start = await read(path)
  ok(start.includes('This space has no domains yet.'), start)
  ok((await read('/manage/studio/settings')).includes('Manage custom domains'))
  let results = await search('studio books')
  ok(results.includes('studiobooks.com'), results)
  ok(results.includes('studiobooks.org'), results)
  ok(results.includes('$10.44 first year · $10.44 per year to renew'), results)
  let taken = await search('taken.com')
  ok(taken.includes('Taken.'), taken)
  ok(taken.includes('No available domains'), taken)
  ok(!taken.includes('data-domain-buy'), taken)
  ok((await search('!!!')).includes('No available domains'))

  let name = 'studiobooks.com'
  let quote = { billing: 'domain', domain: name, cents: '1044', renews: '1044' }
  equal((await post({ ...quote, cents: '999' })).status, 409)
  equal(checkout, undefined)
  let opened = await post(quote)
  equal(opened.status, 200)
  equal(
    (await opened.json() as { url: string }).url,
    'https://checkout.stripe.com/session',
  )
  let sent = checkout!
  equal(sent.get('line_items[0][price_data][unit_amount]'), '1044')
  equal(sent.get('metadata[serves]'), null)
  equal(sent.get('metadata[renews]'), '1044')
  equal(new URL(sent.get('success_url')!).pathname, path)
  equal(await registered(k), {})

  await delivered(
    apexPost(k),
    '/stripe/webhook',
    WEBHOOK_SECRET,
    'checkout.session.completed',
    {
      id: 'cs_name',
      livemode: true,
      mode: 'payment',
      payment_status: 'paid',
      client_reference_id: space.eid,
      metadata: {
        ...tagged(space.eid),
        domain: name,
        cents: '1044',
        renews: '1044',
      },
    },
  )
  await k.settled()

  let listing = await read(path)
  ok(listing.includes('Unattached'), listing)
  ok(listing.includes('Certificate'), listing)
  ok(listing.includes('Renews by'), listing)
  ok(listing.includes('$10.44 per year at the registrar'), listing)
  equal(await k.dir.serves(name), null)
  let point = (destination: string) => post({ point_domain: name, destination })
  equal((await point(other.eid)).status, 400)
  equal((await point(one.eid)).status, 200)
  equal((await k.dir.serves(name))?.app?.eid, one.eid)
  equal((await point(two.eid)).status, 200)
  equal((await k.dir.serves(name))?.app?.eid, two.eid)
  equal((await point('')).status, 200)
  equal(await k.dir.serves(name), null)
  equal(await registered(k), { [name]: { auto_renew: true } })

  let bill = await read('/manage/studio/billing')
  ok(bill.includes('Domain renewals'), bill)
  ok(bill.includes(`${path}#${name}`), bill)
  ok(!bill.includes('data-domain-search'), bill)

  let recipient = await seed(k, [{ slug: 'receiving', apps: [] }])
  let target = (await k.dir.at(recipient.eids.receiving))!
  equal((await point(one.eid)).status, 200)
  let offer = { transfer_domain: name, receiving_space: target.slug }
  equal((await post(offer)).status, 200)
  equal((await post(offer)).status, 200)
  equal((await k.dir.serves(name))?.space.eid, space.eid)

  let updates = '/receiving/updates'
  let card = await (await k.at('yaks.app', updates, {
    headers: { cookie: recipient.cookie },
  })).text()
  ok(card.includes('Accept domain'), card)
  ok(card.includes('The domain arrives unattached.'), card)
  let nodes = parseHTML(card).document.querySelectorAll(
    'input[name="transfer"]',
  )
  equal(nodes.length, 1)
  let transfer = nodes[0].getAttribute('value')!
  let accept = (cookie: string) =>
    k.at('yaks.app', updates, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie, origin: 'https://yaks.app' },
      body: new URLSearchParams({ transfer, answer: 'accept' }),
    })
  ok((await accept(cookie)).status != 303)
  equal((await k.dir.serves(name))?.space.eid, space.eid)
  equal((await accept(recipient.cookie)).status, 303)
  equal((await accept(recipient.cookie)).status, 303)
  await k.settled()
  equal(await k.dir.serves(name), null)
  equal((await k.dir.hostname(name))?.space, target.eid)
  equal((await k.dir.domainOrders(space)).length, 0)
  equal((await k.dir.domainOrders(target))[0]?.order.bought_by, space.eid)
  equal(await registered(k), { [name]: { auto_renew: false } })
  ok(!(await read('/manage/studio/billing')).includes(name))
  let receiving = await (await k.at('yaks.app', '/manage/receiving/billing', {
    headers: { cookie: recipient.cookie },
  })).text()
  ok(receiving.includes(`/manage/receiving/domains#${name}`), receiving)
  ok(receiving.includes('auto-renew off'), receiving)
})
