// A refund through the owner's budget door (budget.ts): the month and the
// starter read as if the dollars refunded had not been spent, and the budget
// stays the plan's.
import { equal, test } from '@yaks/testing'
import { platform } from './directory-rows-probe.ts'
import { fetch as budget } from './budget.ts'
import { META } from './directory.ts'
import { monthOf, starterOf } from '@yaks/platform/meter'
import { monthlyBudget, STARTER } from '@yaks/platform/plans'
import { reserved } from './model-spend.ts'
import { ADA, as, SECRET } from './serving-data-probe.ts'

let { dir, env } = platform(SECRET)
let month = monthOf(new Date())
let [refunded, settled] = await dir.stamp({
  entities: [
    {
      entity: { eid: '$refunded' },
      space: { slug: 'refunded', store: 'refunded' },
      starter: { dollars: STARTER },
      spend: { month, models: 89.55 },
    },
    {
      entity: { eid: '$settled' },
      space: { slug: 'settled', store: 'settled' },
      starter: { dollars: STARTER },
      spend: { month, models: 5 },
    },
  ],
})
let owner = (await dir.space(META.space))!.eid
await dir.stamp({
  entities: [
    { entity: { eid: ADA }, person: {} },
    {
      entity: { eid: '$seat' },
      member: { space: owner, person: ADA, role: 'owner' },
    },
  ],
})
let cookie = await as(ADA)
let post = (slug: string, body: string) =>
  budget(
    new Request('https://yaks.app/api/budget', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: `space=${slug}&${body}`,
    }),
    env,
  )

test('a refund corrects the meter, and the budget and starter stay as they were', async () => {
  let too = await post('refunded', 'refund=90&why=loop')
  equal([too.status, (await too.json()).error.code], [400, 'bad_refund'])
  let why = await post('refunded', 'refund=89.55')
  equal([why.status, (await why.json()).error.code], [400, 'no_why'])
  let now = await post('refunded', 'refund=89.55&why=a+fork+cascade')
  equal(now.status, 200)
  equal(await now.json(), {
    space: 'refunded',
    dollars: null,
    limit: monthlyBudget('free', month) + STARTER,
    spent: 0,
    starter: STARTER,
  })
  let space = (await dir.at(refunded.entity.eid))!
  equal([space.meter!.models, space.meter!.refunded, space.meter!.drawn], [
    89.55,
    89.55,
    0,
  ])
  let next = new Date(Date.parse(month + '-01T00:00:00Z') + 40 * 864e5)
  equal(starterOf(space, next), STARTER)
})

test('only settled usage can be refunded, even when two refunds arrive together', async () => {
  let eid = settled.entity.eid
  let space = (await dir.at(eid))!
  let open = await reserved(env, space, () => ({ dollars: 6 }))
  let estimated = await reserved(env, space, () => ({ dollars: 3 }))
  await estimated.estimate(3)

  let refund = (dollars: number) =>
    post('settled', `refund=${dollars}&why=runaway`)
  let tooMuch = await refund(6)
  equal(tooMuch.status, 400)
  equal((await tooMuch.json()).error.code, 'bad_refund')
  let both = await Promise.all([refund(4), refund(4)])
  equal(both.map((r) => r.status).sort(), [200, 400])

  await open.release()
  await estimated.settle(1)
  let { meter } = (await dir.at(eid))!
  equal([meter!.models, meter!.refunded, meter!.drawn], [6, 4, 2])
})
