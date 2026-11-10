import { equal, ok, test } from '@yaks/testing'
import { connector, fresh, seed } from './probe.ts'
import { stamp } from './directory.ts'
import type { Env } from './env.ts'

let env!: Env
let k = await fresh({}, (e) => env = e)
let them = await seed(k, [{ slug: 'comp-site', apps: ['site'] }])
let eid = them.eids['comp-site']
let agent = connector(k, them.cookie)
let post = (fields: Record<string, string>, cookie = k.owner.cookie) =>
  k.at(k.host, '/api/comp', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ space: 'comp-site', ...fields }).toString(),
  })

test('only the platform can grant a comp, and it records the reason and actor', async () => {
  try {
    equal(
      (await post({ tier: 'plus', reason: 'partner' }, them.cookie)).status,
      403,
    )
    equal((await post({ tier: 'plus' })).status, 400)
    equal((await post({ tier: 'other', reason: 'partner' })).status, 400)
    let comp = { tier: 'plus', reason: 'partner', by: k.owner.person }
    let grant = await post({ tier: 'plus', reason: 'partner' })
    equal(grant.status, 200)
    equal(await grant.json(), { space: 'comp-site', tier: 'plus', comp })
    equal((await k.dir.at(eid))!.comp, comp)
    await connector(k, k.owner.cookie).tool('graph_apply', {
      app: 'yak/platform',
      entities: [{ entity: { eid }, comp: null }],
    })
    equal((await k.dir.at(eid))!.comp, comp)

    // The granted tier reaches the consumer that needed it: custom domains.
    let domain = await agent.tool('domain_attach', {
      space: 'comp-site',
      app: 'site',
      hostname: 'comp-site.example.com',
    })
    ok(domain.includes('comp-site.example.com'))

    // A Stripe update keeps the grant; revoking the grant keeps Stripe's plan.
    await stamp(env, { entities: [{ entity: { eid }, plan: { tier: 'pro' } }] })
    equal((await k.dir.at(eid))!.tier, 'pro')
    let revoke = await post({ tier: 'revoke' })
    equal(await revoke.json(), { space: 'comp-site', tier: 'pro', comp: null })
    equal((await k.dir.at(eid))!.plan!.tier, 'pro')

    // The platform's ordinary graph door cannot forge a grant.
    let forged = await k.at(k.host, '/mcp', {
      method: 'POST',
      headers: {
        cookie: k.owner.cookie,
        'content-type': 'application/json',
        'x-yak-kernel': '1',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'graph_apply',
          arguments: {
            app: 'yak/platform',
            entities: [{ entity: { eid }, comp }],
          },
        },
      }),
    })
    let reply = await forged.json()
    ok(
      JSON.stringify(reply).includes('comp.tier is server-owned'),
      JSON.stringify(reply),
    )
    equal((await k.dir.at(eid))!.comp ?? null, null)
  } finally {
    await k.stop()
  }
})
