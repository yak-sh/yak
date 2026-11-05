import {
  assertAlmostEquals,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { affordable, ModelError } from '@yaks/model'
import { mint } from '@yaks/graph'
import { test } from '@yaks/testing'
import { platform } from './testing.ts'
import { directoryOf, stamp } from './directory.ts'
import { monthOf } from './meter.ts'
import { reserved, settled } from './model-spend.ts'
import { type Tally, tallying } from './lib/hops.ts'

let p = platform('model spending')
let dir = directoryOf(p.env.STORE)
// A space held to a 20-cent month, with no starter, so each case counts
// against figures it states.
let fixture = async (models = 0) => {
  let eid = mint()
  await stamp(p.env, {
    entities: [{
      entity: { eid },
      space: { slug: 'budget-' + eid, store: eid },
      budget: { dollars: 0.2 },
      starter: { dollars: 0 },
      meter: { month: monthOf(new Date()), models },
    }],
  })
  let space = (await dir.at(eid))!
  return { space, used: async () => (await dir.at(eid))!.meter!.models }
}
let pilot = await fixture(0.11129812)
let concurrent = await fixture(0.05)
let helpers = await fixture()
let released = await fixture()
let uncertain = await fixture()
let rollover = await fixture()
let free = await fixture(0.20023140)
let price = { input: 0.15, output: 0.5 }

test('the pilot last answered call fits the remaining space budget', async () => {
  let hold = await reserved(
    p.env,
    pilot.space,
    (left) => affordable(price, 100_000, left, 200_000),
  )
  assertEquals(hold.value.tokens, 147403)
  assertEquals(hold.value.dollars <= 0.08870188, true)
  await hold.settle(hold.value.dollars)
  assertEquals(await pilot.used() <= 0.2, true)
  // What is left is said in words and points to the plans; the conversation
  // that reads it names no amount.
  let no = await assertRejects(
    () =>
      reserved(p.env, pilot.space, (left) => affordable(price, 100_000, left)),
    ModelError,
  )
  assertStringIncludes(no.message, 'is too little for this call')
  assertStringIncludes(no.message, 'Compare paid plans')
  assertEquals(/\$\d/.test(no.message), false, no.message)
})

test('model and realtime calls cannot reserve the same remaining dollars', async () => {
  let quote = (left: number) => left >= 0.1 ? { dollars: 0.1 } : null
  let calls = await Promise.allSettled([
    reserved(p.env, concurrent.space, quote),
    reserved(p.env, concurrent.space, quote, mint(), 'realtime'),
  ])
  assertEquals(calls.filter((r) => r.status == 'fulfilled').length, 1)
  let fresh = (await dir.at(concurrent.space.eid))!
  assertAlmostEquals(fresh.meter!.models + fresh.meter!.realtime, 0.15)
})

// Three helpers spawned at once, each holding what fits: none is refused or
// read again for the others, and the month counts all three (T-141004).
test('holds made at once that fit together all hold, in one write each', async () => {
  let tally: Tally = new Map()
  let holds = await tallying(tally, () =>
    Promise.all(
      [1, 2, 3].map(() =>
        reserved(p.env, helpers.space, () => ({ dollars: 0.05 }))
      ),
    ))
  assertEquals([holds.length, tally.get('hops')], [3, 3])
  assertAlmostEquals(await helpers.used(), 0.15)
})

test('settlement releases unused dollars and a replay never debits twice', async () => {
  let call = mint()
  let hold = await reserved(
    p.env,
    released.space,
    () => ({ dollars: 0.18 }),
    call,
  )
  await hold.settle(0.02)
  await settled(p.env, call, 0.02)
  await assertRejects(() => settled(p.env, call, 0.03), Error, 'cost changed')
  assertAlmostEquals(await released.used(), 0.02)
  await assertRejects(
    () => reserved(p.env, released.space, () => ({ dollars: 0.18 }), call),
    ModelError,
    'already holds',
  )
})

test('an unanswered submitted call keeps its maximum unavailable', async () => {
  let hold = await reserved(p.env, uncertain.space, () => ({ dollars: 0.2 }))
  await assertRejects(
    () => reserved(p.env, uncertain.space, () => ({ dollars: 0.01 })),
    ModelError,
  )
  await assertRejects(() => hold.settle(0.21), Error, 'exceeded')
  assertAlmostEquals(await uncertain.used(), 0.2)
})

test('settling an older reservation does not reset or refund this month', async () => {
  let hold = await reserved(
    p.env,
    rollover.space,
    () => ({ dollars: 0.2 }),
    mint(),
    'models',
    new Date('2026-10-01'),
  )
  await stamp(p.env, {
    entities: [{
      entity: { eid: rollover.space.eid },
      meter: { month: '2026-11', models: 0.12 },
    }],
  })
  await hold.settle(0.01)
  assertAlmostEquals(await rollover.used(), 0.12)
  assertEquals((await dir.at(rollover.space.eid))!.meter!.month, '2026-11')
})

test('a zero-dollar call cannot worsen an older over-budget reading', async () => {
  let hold = await reserved(p.env, free.space, () => ({ dollars: 0 }))
  await hold.settle(0)
  assertAlmostEquals(await free.used(), 0.20023140)
})
