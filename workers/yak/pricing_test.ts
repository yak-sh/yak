// A price on a published app (pricing.ts, D-464), through app_publish on an
// in-memory platform: only from a space that can sell, the caller's own
// mistakes named, kept on a republish and taken off by free: true.
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { test } from '@yaks/testing'
import { stamp } from './directory.ts'
import { platform } from './directory-rows-probe.ts'
import { sellerOf } from './sell.ts'
import { ADA, SECRET, seeded } from './serving-data-probe.ts'
import { call, type Ctx } from './tools.ts'

let { env, dir: rows } = platform(SECRET)
let { dir, space } = await seeded(env, 'public', rows)
let ctx = { env, dir, person: ADA } as unknown as Ctx

let publish = async (args: Record<string, unknown> = {}) =>
  (await call(ctx, 'app_publish', { space: 'ada', app: 'cookbook', ...args }))
    .text
let refused = async (args: Record<string, unknown>) =>
  (await assertRejects(() => publish(args), Error)).message
let on = (row: Record<string, unknown>) =>
  stamp(env, { entities: [{ entity: { eid: space.eid }, ...row }] })
let seller = (ready: boolean) =>
  on({ seller: sellerOf({ account: 'acct_ada', ready, submitted: true }) })
let stored = async () => (await dir.app(space, 'cookbook'))!.published!.price
let listed = async () => (await call(ctx, 'app_published', {})).text
let sell = "space_sell(space: 'ada')"

test('a price is refused from a space that cannot sell, naming all it lacks', async () => {
  await on({ plan: null, seller: null })
  let lacks = await refused({ price: 40 })
  for (let said of ['the Personal plan', 'a Stripe account connected', sell]) {
    assertStringIncludes(lacks, said)
  }
  await on({ plan: { tier: 'plus' } })
  lacks = await refused({ price: 40 })
  assert(!lacks.includes('Personal plan'), lacks)
  assertStringIncludes(lacks, `account connected to it. ${sell} connects one`)
  await seller(false)
  assertStringIncludes(
    await refused({ price: 40 }),
    `finish setting up the account it connected. ${sell} answers a fresh link`,
  )
})

test("a price refuses the caller's own mistakes, each named", async () => {
  await on({ plan: { tier: 'plus' } })
  await seller(true)
  let wrong: [Record<string, unknown>, string][] = [
    [{ price: 0 }, 'above zero'],
    [{ price: -5 }, 'above zero'],
    [{ price: 'forty' }, 'above zero'],
    [{ price: 4.999 }, 'to the cent'],
    [{ price: 5, interval: 'week' }, 'interval: once, month or year'],
    [{ interval: 'month' }, 'interval goes with'],
    [{ free: true, price: 5 }, 'free: true takes no price'],
  ]
  for (let [args, said] of wrong) {
    assertStringIncludes(await refused(args), said)
  }
})

test('a price is stored on the offer, kept on a republish and taken off', async () => {
  await on({ plan: { tier: 'pro' } })
  await seller(true)
  assertStringIncludes(await publish({ price: 40 }), 'a copy costs $40 once')
  assertEquals(await stored(), { cents: 4000, interval: null })
  assertStringIncludes(
    await publish({ price: '$5', interval: 'month' }),
    'a copy costs $5 a month, for new buyers',
  )
  assertEquals(await stored(), { cents: 500, interval: 'month' })
  assertStringIncludes(await publish(), 'a copy costs $5 a month\n')
  assertStringIncludes(await listed(), '; $5 a month; ')
  assertStringIncludes(
    await publish({ price: 50, interval: 'year' }),
    '$50 a year',
  )
  assertStringIncludes(await publish({ free: true }), 'it is free again')
  assertEquals(await stored(), null)
  assert(!(await listed()).includes('$50'))
})
