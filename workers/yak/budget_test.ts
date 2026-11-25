// The platform owner's setting changes the Free plan once for all its spaces.
import { mint } from '@yaks/graph'
import { budget } from '@yaks/platform/meter'
import { equal, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import { rows } from './directory-rows-probe.ts'
import { fresh } from './probe.ts'

test('the platform owner can read and change the monthly Free plan budget', async () => {
  let k = await fresh()
  let read = async () =>
    (await k.at(k.host, '/api/budget?tier=free', {
      headers: { cookie: k.owner.cookie },
    })).json()
  let set = (dollars: string, cookie?: string) =>
    k.at(k.host, '/api/budget', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...cookie ? { cookie } : {},
      },
      body: `tier=free&dollars=${dollars}`,
    })
  equal(await read(), { tier: 'free', dollars: 10, from: '2026-12' })
  equal((await set('5')).status, 403)
  equal((await set('-1', k.owner.cookie)).status, 400)
  equal((await set('0', k.owner.cookie)).status, 200)
  equal((await read()).dollars, 0)
  equal((await set('12.50', k.owner.cookie)).status, 200)
  equal((await read()).dollars, 12.5)
})

test('the Free plan changes at the UTC month boundary and retains building credit and space overrides', async () => {
  let { graph, dir } = rows()
  let meta = mint(),
    free = mint(),
    later = mint(),
    custom = mint(),
    paid = mint()
  let end = new Date('2026-11-30T23:59:59.999Z')
  let next = new Date('2026-12-01T00:00:00Z')
  let put = (eid: string, slug: string, extra = {}) => ({
    entity: { eid },
    space: { slug },
    ...extra,
  })
  await graph.apply([
    put(meta, 'yak'),
    put(free, 'first', {
      starter: { dollars: 100 },
      meter: { month: '2026-11', drawn: 75, models: 5 },
    }),
    put(later, 'later', { starter: { dollars: 0 } }),
    put(custom, 'custom', { budget: { dollars: 3 }, starter: { dollars: 0 } }),
    put(paid, 'paid', { plan: { tier: 'plus' }, starter: { dollars: 0 } }),
  ], { trusted: true })
  let limit = async (eid: string, now: Date) =>
    budget(await dir.withBudget((await dir.at(eid))!), now).limit
  let set = (dollars: number) =>
    graph.apply([{
      entity: { eid: meta },
      free_ai_budget: { dollars },
    }], { trusted: true })
  let hold = (eid: string, dollars: number, now: Date) =>
    graph.apply([{
      entity: { eid },
      spend: {
        month: now.toISOString().slice(0, 7),
        models: dollars,
        held: true,
      },
    }], { trusted: true, now: now.toISOString() })

  equal(await limit(free, end), 50)
  equal(await limit(free, next), 35)
  await set(4)
  equal(await limit(free, end), 50)
  equal(await limit(free, next), 29)
  equal(await limit(custom, next), 3)
  equal(await limit(paid, next), 8)
  await hold(later, 4, next)
  await assertRejects(
    async () => await hold(later, 0.01, next),
    Error,
    'budget',
  )
  await set(5)
  await hold(later, 1, next)
})
