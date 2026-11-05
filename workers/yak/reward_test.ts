// The month an invite gives (reward.ts), through the directory's own effect
// (facets/directory-effects.ts) over a directory in memory, with Stripe
// stood in by `fetch`: a free space is given the Plus plan free, a month a
// friend, and a space Stripe bills has its next charge moved a month later.
import { clock, equal, test } from '@yaks/testing'
import { stub } from '@std/testing/mock'
import { rows } from './directory-rows-probe.ts'
import type { Env } from './env.ts'
import { effects } from './facets/directory-effects.ts'
import type { Options } from './facets/store.ts'
import { codeOf, credit, invitation, words } from './referral.ts'
import { monthOn } from './reward.ts'

let NOW = Date.now()
let now = new Date(NOW).toISOString()
let env: Partial<Env> = { STRIPE_KEY: 'sk_test_fake', CLOCK: clock(NOW) }
let { dir } = rows(
  env,
  (graph) =>
    effects(undefined, { store: { meta: true, graph, env } } as Options),
)

// Stripe, as one subscription paid through `PAID` and the writes it was asked.
let PAID = Math.floor(NOW / 1000) + 10 * 86400
let asked: { path: string; body: string }[] = []
let fetch = stub(
  globalThis,
  'fetch',
  (url: string | URL | Request, init?: RequestInit) => {
    let path = new URL(String(url)).pathname
    if (init?.method == 'POST') asked.push({ path, body: String(init.body) })
    return Promise.resolve(Response.json({
      id: 'sub_paid',
      status: 'active',
      current_period_end: PAID,
    }))
  },
)

let someone = async (name: string, plan?: Record<string, string>) => {
  let person = crypto.randomUUID(), space = crypto.randomUUID()
  let slug = `${name.toLowerCase()}-${space.slice(0, 6)}`
  await dir.stamp({
    entities: [
      {
        entity: { eid: person },
        person: {},
        email: { address: `${slug}@example.com` },
        doc: { title: name },
      },
      {
        entity: { eid: space },
        space: { slug, store: slug },
        ...plan ? { plan } : {},
      },
      {
        entity: { eid: crypto.randomUUID() },
        member: { space, person, role: 'owner', own: true },
      },
    ],
  })
  return { person, space }
}
let build = (space: string, copy = false) =>
  dir.stamp({
    entities: [{
      entity: { eid: crypto.randomUUID() },
      app: {
        slug: `app-${crypto.randomUUID().slice(0, 6)}`,
        space,
        access: 'private',
      },
      ...copy ? { installed: { of: crypto.randomUUID(), version: 1 } } : {},
    }],
  })
let invited = async (by: { person: string }, name: string) => {
  let them = await someone(name)
  let code = await codeOf(dir, by.person)
  await credit(dir, them.person, words('Jeff', code))
  return them
}

// Jeff's space is free: two friends build, one builds twice, one installs a
// copy and nothing else.
let jeff = await someone('Jeff')
let ana = await invited(jeff, 'Ana')
let bo = await invited(jeff, 'Bo')
let cy = await invited(jeff, 'Cy')
await build(ana.space)
await build(ana.space)
await build(bo.space)
await build(cy.space, true)
let free = await dir.at(jeff.space)
let given = await dir.referrals(jeff.person)
let page = await invitation({} as Env, dir, jeff.person)

// Dee pays for her space through Stripe: her friend's app moves its charge.
let dee = await someone('Dee', {
  tier: 'plus',
  status: 'active',
  subscription: 'sub_paid',
  customer: 'cus_dee',
})
let eve = await invited(dee, 'Eve')
await build(eve.space)
let paying = await dir.at(dee.space)
let eves = await dir.referral(eve.person)
fetch.restore()

// Fay's own code, Fay's code for Eve, whom Dee brought in, Fay's code for
// Gus, who had built an app before it reached him, no code, and a code
// nobody holds.
let fay = await someone('Fay')
let gus = await someone('Gus')
await build(gus.space)
let mine = words('Fay', await codeOf(dir, fay.person))
let credited = [
  await credit(dir, fay.person, mine),
  await credit(dir, eve.person, mine),
  await credit(dir, gus.person, mine),
  await credit(dir, fay.person, 'Hi yaks.app, sign me up!'),
  await credit(dir, gus.person, words('Ana', 'nobody')),
]

test("each friend who builds their first app gives the inviter's free space one more month of the Plus plan", () => {
  equal(free?.comped, monthOn(monthOn(now)))
  equal(free?.tier, 'plus')
  equal(
    given.filter((r) => r.rewarded).map((r) => r.invitee).sort(),
    [ana.person, bo.person].sort(),
  )
  equal([page.joined, page.built], [3, 2])
})

test('a copy of somebody else’s app is no app of theirs', () => {
  equal(given.find((r) => r.invitee == cy.person)?.rewarded, null)
})

test('a space Stripe bills has its next charge moved a month later instead', () => {
  let until = monthOn(new Date(PAID * 1000).toISOString())
  equal(eves?.rewarded?.until, until)
  equal(eves?.rewarded?.subscription, 'sub_paid')
  equal(paying?.comped, null)
  equal(asked.map((a) => a.path), ['/v1/subscriptions/sub_paid'])
  let body = new URLSearchParams(asked[0].body)
  equal(body.get('trial_end'), String(Date.parse(until) / 1000))
  equal(body.get('proration_behavior'), 'none')
})

test('the code a person signed up with credits whoever holds it, once, and nobody for their own', () => {
  equal(credited, [null, null, null, null, null])
  equal(eves?.inviter, dee.person)
})
