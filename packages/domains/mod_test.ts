import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import {
  fulfil,
  ordered,
  type Ports,
  type Rec,
  type Registration,
  renew,
  type State,
  Waiting,
} from './mod.ts'

// A registry whose workflows move only when the test says, and a graph of
// plain bundles keyed by eid, read by the two shapes the core asks.
let world = (states: State[] = ['succeeded']) => {
  let rows = new Map<string, Bundle>()
  let said: string[] = []
  let at = new Map<string, number>()
  let reg = (name: string): Registration => ({
    name,
    state: states[Math.min(at.get(name)!, states.length - 1)],
    expires: '2027-11-19T00:00:00Z',
    ...states.includes('failed') ? { error: 'registry_rejected' } : {},
  })
  let paying = true
  let refusing = false
  let p: Ports = {
    registry: {
      search: () => Promise.resolve([]),
      check: () => Promise.resolve([]),
      register: (name, renew) => {
        said.push(`register ${name} renew=${renew}`)
        at.set(name, 0)
        return Promise.resolve(reg(name))
      },
      registration: (name) => {
        if (!at.has(name)) return Promise.resolve(null)
        at.set(name, at.get(name)! + 1)
        return Promise.resolve(reg(name))
      },
      renewing: (name, on) => {
        said.push(`renew ${name} ${on}`)
        return Promise.resolve()
      },
      zone: (name) => Promise.resolve(`zone-${name}`),
    },
    graph: {
      read: (q) => {
        let [, key, said] =
          /^\.(entity\.eid|domain_registered&\.domain_order\.space|domain_order\.name)=(.*)$/
            .exec(String(q))!
        let value = said.replace(/^"(.*)"$/, '$1')
        let field = key.endsWith('space') ? 'space' : 'name'
        return Promise.resolve(
          [...rows.values()].filter((b) =>
            key == 'entity.eid'
              ? b.entity.eid == value
              : (b.domain_order as Record<string, unknown>)?.[field] == value &&
                (field == 'name' || !!b.domain_registered)
          ),
        )
      },
      apply: (bundles) => {
        for (let { $was: _, ...b } of bundles) {
          let old = rows.get(b.entity.eid)
          rows.set(b.entity.eid, {
            created: { at: `t${rows.size}` },
            ...old,
            ...b,
          })
        }
        return Promise.resolve(bundles)
      },
    },
    paying: () => Promise.resolve(paying),
    attach: (name, serves) => {
      said.push(`attach ${name} to ${serves}`)
      return Promise.resolve<Rec[]>([
        { type: 'CNAME', name, content: 'origin.saas.yaks.app' },
      ])
    },
    write: (zone, recs) => {
      said.push(...recs.map((r) => `${zone}: ${r.type} ${r.name}`))
      return Promise.resolve()
    },
    refund: (order) => {
      said.push(`refund ${order.checkout} ${order.cents}`)
      if (refusing) return Promise.reject(new Error('stripe is down'))
      return Promise.resolve('re_' + order.checkout)
    },
    now: () => '2026-11-19T00:00:00Z',
  }
  let order = async (
    name = 'ada.com',
    checkout = 'cs_' + name,
    live = true,
  ) => {
    await p.graph.apply([
      ordered(checkout, checkout, {
        name,
        space: 's',
        serves: 'app',
        cents: 1044,
        live,
      }),
    ])
    return checkout
  }
  return {
    p,
    rows,
    said,
    order,
    lapse: () => paying = false,
    refusing: (on: boolean) => refusing = on,
  }
}

test('a paid order registers once, attaches, writes its records and is marked', async () => {
  let w = world()
  let eid = await w.order()
  assertEquals(await fulfil(w.p, eid), {
    done: 'registered',
    name: 'ada.com',
    expires: '2027-11-19T00:00:00Z',
  })
  assertEquals(await fulfil(w.p, eid), { done: 'nothing' })
  assertEquals(w.said, [
    'register ada.com renew=true',
    'attach ada.com to app',
    'zone-ada.com: CNAME ada.com',
  ])
  assertEquals(w.rows.get(eid)!.domain_registered, {
    at: '2026-11-19T00:00:00Z',
    expires: '2027-11-19T00:00:00Z',
  })
})

test('a running workflow waits, and is never registered a second time', async () => {
  let w = world(['pending', 'in_progress', 'succeeded'])
  let eid = await w.order()
  let first = await assertRejects(() => fulfil(w.p, eid), Waiting)
  assertEquals([first.message, first.retry.after], [
    'ada.com is pending',
    60_000,
  ])
  await assertRejects(() => fulfil(w.p, eid), Waiting, 'in progress')
  assertEquals((await fulfil(w.p, eid)).done, 'registered')
  assertEquals(w.said.filter((s) => s.startsWith('register')).length, 1)
})

test('one needing a person waits an hour', async () => {
  let w = world(['action_required'])
  let eid = await w.order()
  let waiting = await assertRejects(() => fulfil(w.p, eid), Waiting)
  assertEquals(waiting.retry.after, 3_600_000)
})

test('a refused registration is refunded once, even when the refund fails first', async () => {
  let w = world(['failed'])
  let eid = await w.order()
  w.refusing(true)
  await assertRejects(() => fulfil(w.p, eid), Error, 'stripe is down')
  assertEquals(w.rows.get(eid)!.domain_refused, {
    at: '2026-11-19T00:00:00Z',
    why: 'registry_rejected',
  })
  w.refusing(false)
  let done = await fulfil(w.p, eid) as { why: string; refund: string }
  assertEquals([done.why, done.refund], ['registry_rejected', 're_cs_ada.com'])
  assertEquals(await fulfil(w.p, eid), { done: 'nothing' })
  assertEquals(w.said, [
    'register ada.com renew=true',
    'refund cs_ada.com 1044',
    'refund cs_ada.com 1044',
  ])
})

test('a second checkout for a name is refunded, whichever runs first', async () => {
  let w = world()
  let first = await w.order('ada.com', 'cs_1')
  let second = await w.order('ada.com', 'cs_2')
  assertEquals((await fulfil(w.p, second)).done, 'refunded')
  assertEquals((await fulfil(w.p, first)).done, 'registered')
  let third = await w.order('ada.com', 'cs_3')
  let done = await fulfil(w.p, third) as { why: string; refund: string }
  assertEquals([done.why, done.refund], [
    'ada.com was bought first at another checkout',
    're_cs_3',
  ])
  assertEquals(w.said.filter((s) => s.startsWith('register')).length, 1)
})

test('a sandbox payment registers nothing and is refunded', async () => {
  let w = world()
  let eid = await w.order('ada.com', 'cs_test', false)
  assertEquals((await fulfil(w.p, eid)).done, 'refunded')
  // Nor does it stand in the way of a paid one.
  assertEquals((await fulfil(w.p, await w.order())).done, 'registered')
  assertEquals(w.said, [
    'refund cs_test 1044',
    'register ada.com renew=true',
    'attach ada.com to app',
    'zone-ada.com: CNAME ada.com',
  ])
})

test('renewal follows the plan, for registered names only', async () => {
  let w = world()
  await fulfil(w.p, await w.order('ada.com'))
  await w.order('later.com')
  assertEquals(await renew(w.p, 's'), ['ada.com'])
  w.lapse()
  assertEquals(await renew(w.p, 's'), ['ada.com'])
  assertEquals(await renew(w.p, 'nobody'), [])
  assertEquals(w.said.filter((s) => s.startsWith('renew ')), [
    'renew ada.com true',
    'renew ada.com false',
  ])
})
