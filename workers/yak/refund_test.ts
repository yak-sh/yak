// A refund through the owner's budget door (budget.ts): the month and the
// starter read as if the dollars refunded had not been spent, and the budget
// stays the plan's.
import { equal, test } from '@yaks/testing'
import { fresh, seed } from './probe.ts'
import { stamp } from './directory.ts'
import { monthOf, starterOf } from './meter.ts'
import type { Env } from './env.ts'

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
      limit: 120,
      spent: 0,
      starter: 100,
    })
    let space = (await k.dir.at(eid))!
    equal([space.meter!.models, space.meter!.refunded, space.meter!.drawn], [
      89.55,
      89.55,
      0,
    ])
    let next = new Date(Date.parse(month + '-01T00:00:00Z') + 40 * 864e5)
    equal(starterOf(space, next), 100)
  } finally {
    await k.stop()
  }
})
