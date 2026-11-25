// A refund through the owner's budget door (budget.ts): the month and the
// starter read as if the dollars refunded had not been spent, and the budget
// stays the plan's.
import { equal, test } from '@yaks/testing'
import { fresh, seed } from './probe.ts'
import { stamp } from './directory.ts'
import { monthOf, starterOf } from '@yaks/platform/meter'
import type { Env } from './env.ts'
import { monthlyBudget, STARTER } from '@yaks/platform/plans'
import { reserved } from './model-spend.ts'

test('a refund corrects the meter, and the budget and starter stay as they were', async () => {
  let env!: Env
  let k = await fresh({}, (e) => env = e)
  try {
    let them = await seed(k, [{ slug: 'refunded', apps: [] }])
    let eid = them.eids.refunded
    let month = monthOf(new Date())
    await stamp(env, {
      entities: [{ entity: { eid }, spend: { month, models: 89.55 } }],
    })
    let post = async (body: string) => {
      let res = await k.at(k.host, '/api/budget', {
        method: 'POST',
        headers: {
          cookie: k.owner.cookie,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'space=refunded&' + body,
      })
      return [res.status, await res.json()]
    }
    let [no, too] = await post('refund=90&why=loop')
    equal([no, too.error.code], [400, 'bad_refund'])
    let [none, why] = await post('refund=89.55')
    equal([none, why.error.code], [400, 'no_why'])
    let [ok, now] = await post('refund=89.55&why=a+fork+cascade')
    equal(ok, 200)
    equal(now, {
      space: 'refunded',
      dollars: null,
      limit: monthlyBudget('free', month) + STARTER,
      spent: 0,
      starter: STARTER,
    })
    let space = (await k.dir.at(eid))!
    equal([space.meter!.models, space.meter!.refunded, space.meter!.drawn], [
      89.55,
      89.55,
      0,
    ])
    let next = new Date(Date.parse(month + '-01T00:00:00Z') + 40 * 864e5)
    equal(starterOf(space, next), STARTER)
  } finally {
    await k.stop()
  }
})

test('only settled usage can be refunded, even when two refunds arrive together', async () => {
  let env!: Env
  let k = await fresh({}, (e) => env = e)
  try {
    let them = await seed(k, [{ slug: 'settled', apps: [] }])
    let eid = them.eids.settled
    let space = (await k.dir.at(eid))!
    await stamp(env, {
      entities: [{
        entity: { eid },
        spend: { month: monthOf(new Date()), models: 5 },
      }],
    })
    let open = await reserved(env, space, () => ({ dollars: 6 }))
    let estimated = await reserved(env, space, () => ({ dollars: 3 }))
    await estimated.estimate(3)

    let refund = (dollars: number) =>
      k.at(k.host, '/api/budget', {
        method: 'POST',
        headers: {
          cookie: k.owner.cookie,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: `space=settled&refund=${dollars}&why=runaway`,
      })
    let tooMuch = await refund(6)
    equal(tooMuch.status, 400)
    equal((await tooMuch.json()).error.code, 'bad_refund')
    let both = await Promise.all([refund(4), refund(4)])
    equal(both.map((r) => r.status).sort(), [200, 400])

    await open.release()
    await estimated.settle(1)
    let { meter } = (await k.dir.at(eid))!
    equal([meter!.models, meter!.refunded, meter!.drawn], [6, 4, 2])
  } finally {
    await k.stop()
  }
})
