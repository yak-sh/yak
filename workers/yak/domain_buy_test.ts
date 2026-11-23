// A domain bought through the whole kernel (@yaks/domains, T-1314): the paid
// checkout's webhook writes one order however often it is told, the
// directory's effect registers the name at the Registrar stand-in, makes its
// zone and attaches it with every record written, and its renewal follows the
// space's plan. The checkout itself is the signed-in plan settings' button
// (billing.ts `buyDomain`); the connector only searches.
import { equal, ok, test } from '@yaks/testing'
import { delivered } from '@yaks/stripe/testing'
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
  ok(found.includes('/manage/bakery/billing#domains'), found)

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
