import {
  assertAlmostEquals,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { affordable, type Model, ModelError } from '@yaks/model'
import { mint } from '@yaks/graph'
import { test } from '@yaks/testing'
import { platform } from './testing.ts'
import { directoryOf, stamp } from './directory.ts'
import { monthOf } from '@yaks/platform/meter'
import { plans } from '@yaks/platform/standing'
import { expired, reserved, settled, TAB, tabbed } from './model-spend.ts'
import { accounted } from './meter.ts'
import { type Tally, tallying } from './lib/hops.ts'

let p = platform('model spending')
let dir = directoryOf(p.env.STORE)
// A space held to a 20-cent month, with no starter, so each case counts
// against figures it states.
let fixture = async (models = 0, more: Record<string, unknown> = {}) => {
  let eid = mint()
  await stamp(p.env, {
    entities: [{
      entity: { eid },
      space: { slug: 'budget-' + eid, store: eid },
      budget: { dollars: 0.2 },
      starter: { dollars: 0 },
      meter: { month: monthOf(new Date()), models },
      ...more,
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
let retried = await fixture()
let started = await fixture()
let measured = await fixture()
let duringDeploy = await fixture()
let rollover = await fixture()
let free = await fixture(0.20023140)
let visited = await fixture()
let welcoming = await fixture(0, { visitor_share: { percent: 50 } })
let counted = await fixture(0, {
  budget: { dollars: 100 },
  visitor_share: { percent: 100, calls: 2 },
})
let tab = await fixture()
let full = await fixture(0.2)
let interrupted = await fixture()
let swept = await fixture()
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
  // that reads it names no amount of the budget. The plans pointer may name
  // the credit a subscription adds.
  let no = await assertRejects(
    () =>
      reserved(p.env, pilot.space, (left) => affordable(price, 100_000, left)),
    ModelError,
  )
  let said = no.message.replace(plans(pilot.space, {}), '')
  assertEquals(said.trim().endsWith('is too little for this call.'), true, said)
  assertEquals(/\$\d/.test(said), false, said)
})

test('model and realtime calls cannot reserve the same remaining dollars', async () => {
  let quote = (left: number) => left >= 0.1 ? { dollars: 0.1 } : null
  let calls = await Promise.allSettled([
    reserved(p.env, concurrent.space, quote),
    reserved(p.env, concurrent.space, quote, mint(), { what: 'realtime' }),
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

// An embedding costs a sliver of a cent: its calls write the directory only
// once their tab reaches TAB, and a space with nothing left is refused.
test('calls on a tab write the directory once it runs up', async () => {
  let tally: Tally = new Map()
  let quote = () => ({ dollars: TAB / 4 })
  await tallying(tally, async () => {
    for (let i = 0; i < 3; i++) {
      await (await tabbed(p.env, tab.space, quote)).settle(TAB / 4)
    }
  })
  assertEquals([tally.get('hops') ?? 0, await tab.used()], [0, 0])
  await (await tabbed(p.env, tab.space, quote)).settle(TAB / 4)
  assertAlmostEquals(await tab.used(), TAB)
  await assertRejects(() => tabbed(p.env, full.space, quote), ModelError)
})

test('a released call is held again, and a completed zero-cost call is final', async () => {
  let call = mint()
  let hold = () =>
    reserved(p.env, retried.space, () => ({ dollars: 0.05 }), call)
  let first = await hold()
  await first.release()
  assertAlmostEquals(await retried.used(), 0)
  let second = await hold()
  await first.release()
  assertAlmostEquals(await retried.used(), 0.05)
  await second.settle(0, false)
  assertAlmostEquals(await retried.used(), 0)
  await assertRejects(hold, ModelError, 'already holds')
})

// A provider's refusal (@yaks/model `refused`) ran nothing, so the next model
// holds the same call, even once the provider acknowledged it; output means it
// worked, so the debit stays and the call is not sent again.
test('a provider refusal before output releases the debit, and after output keeps it', async () => {
  let codes: Record<string, string> = {
    accepted: 'model_not_found',
    dry: 'project_spend_limit_exceeded',
    streaming: 'model_not_found',
  }
  let raw = Object.assign(async (req: Parameters<Model>[0]) => {
    await req.onSubmit?.()
    if (req.model == 'streaming') req.onFirst?.()
    else await req.onAck?.({ fixture: { id: 'r' } })
    throw new ModelError(codes[req.model])
  }, { quote: () => ({ dollars: 0.05, tokens: 1 }) })
  let callModel = accounted(p.env, (dir) => dir.at(started.space.eid), raw)
  let code = (req: Parameters<Model>[0]) =>
    callModel(req).then(() => 'answered', (e: ModelError) => e.code)
  for (let model of Object.keys(codes)) {
    let req = { call: mint(), model, items: [], tools: [] }
    assertEquals(
      [await code(req), await code(req)],
      [codes[model], model == 'streaming' ? 'submitted' : codes[model]],
    )
  }
  assertAlmostEquals(await started.used(), 0.05)
})

// A call cut short once the provider may have worked on it is charged what
// the provider said it used, else what it most likely cost: never the most it
// held.
test('a call that fails after its output began settles at its usage or its likely cost', async () => {
  let window = 100_000
  let raw = Object.assign(async (req: Parameters<Model>[0]) => {
    await req.onSubmit?.()
    req.onText?.({ index: 0, text: 'x'.repeat(4000) })
    throw Object.assign(
      new ModelError('transport'),
      req.model == 'said'
        ? { usage: { input_tokens: 2000, output_tokens: 1000 } }
        : {},
    )
  }, {
    info: (name: string) => Promise.resolve({ name, context: window, price }),
  })
  let callModel = accounted(p.env, (dir) => dir.at(interrupted.space.eid), raw)
  let charged = async (model: string) => {
    let before = await interrupted.used()
    let req = { call: mint(), model, items: [], tools: [], onText() {} }
    await assertRejects(() => callModel(req), ModelError, 'transport')
    return (await interrupted.used()) - before
  }
  // 2,000 tokens in and 1,000 out, as it said
  assertAlmostEquals(await charged('said'), 0.0008, 1e-9)
  // a few tokens of request and the 1,000 it was seen writing
  assertAlmostEquals(await charged('silent'), 0.0005009, 1e-9)
})

test('a hold its caller died holding settles at its likely cost once expired, and a later measure replaces it', async () => {
  let call = mint()
  let now = new Date()
  await reserved(p.env, swept.space, () => ({ dollars: 0.15 }), call, {
    likely: 0.01,
    until: new Date(now.getTime() + 1000),
  })
  assertEquals(await expired(p.env, now), 0)
  assertAlmostEquals(await swept.used(), 0.15)
  assertEquals(await expired(p.env, new Date(now.getTime() + 2000)), 1)
  assertAlmostEquals(await swept.used(), 0.01)
  assertEquals(await expired(p.env, new Date(now.getTime() + 3000)), 0)
  await settled(p.env, call, 0.03)
  assertAlmostEquals(await swept.used(), 0.03)
  await settled(p.env, call, 0.03)
  assertAlmostEquals(await swept.used(), 0.03)
  await assertRejects(() => settled(p.env, call, 0.04), Error, 'cost changed')
})

test('an unanswered submitted call keeps its maximum unavailable', async () => {
  await reserved(p.env, uncertain.space, () => ({ dollars: 0.2 }))
  await assertRejects(
    () => reserved(p.env, uncertain.space, () => ({ dollars: 0.01 })),
    ModelError,
  )
  assertAlmostEquals(await uncertain.used(), 0.2)
})

test('measured cost above a quote settles once and later calls see the full debit', async () => {
  let call = mint()
  let hold = await reserved(
    p.env,
    measured.space,
    () => ({ dollars: 0.01 }),
    call,
  )
  await Promise.all([hold.settle(0.21), settled(p.env, call, 0.21)])
  assertAlmostEquals(await measured.used(), 0.21)
  await settled(p.env, call, 0.21)
  assertAlmostEquals(await measured.used(), 0.21)
  await assertRejects(
    () => reserved(p.env, measured.space, () => ({ dollars: 0.01 })),
    ModelError,
  )
})

test('settlement rereads a competing write through a directory on the previous deploy', async () => {
  let call = mint()
  await reserved(p.env, duringDeploy.space, () => ({ dollars: 0.1 }), call)
  let store = p.env.STORE
  let writes = 0
  let env = {
    STORE: {
      idFromName: (name: string) => store.idFromName(name),
      get: (id: unknown) => ({
        fetch: async (req: Request) => {
          let first = new URL(req.url).pathname == '/apply' && ++writes == 1
          // A second caller settles after the first caller has read the hold.
          if (first) assertEquals(await settled(p.env, call, 0.03), true)
          let answer = await store.get(id).fetch(req)
          if (!first || answer.status != 409) return answer
          let body = await answer.json()
          return Response.json({
            error: 'Skewed',
            message:
              'Durable Object on an older deploy refused a caller on a newer one: ' +
              body.message,
            retryable: true,
            refusal: { status: answer.status, body },
          }, { status: 503 })
        },
      }),
    },
  }
  assertEquals(await settled(env, call, 0.03), true)
  assertEquals(writes, 1)
  assertAlmostEquals(await duringDeploy.used(), 0.03)
})

test('settling an older reservation does not reset or refund this month', async () => {
  let hold = await reserved(
    p.env,
    rollover.space,
    () => ({ dollars: 0.2 }),
    mint(),
    { now: new Date('2026-10-01') },
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

// Visitors together spend a share of the month, 25% unless the owner set
// another: past it a visitor is told plainly, and a member is not held to it.
test("visitors spend only their share of the space's budget", async () => {
  let spend = (space = visited.space, visitor = true, dollars = 0.03) =>
    reserved(p.env, space, () => ({ dollars }), mint(), {
      visitor: visitor ? mint() : undefined,
    })
  let first = await spend()
  await first.settle(0.01)
  await (await spend()).settle(0.03)
  let no = await assertRejects(() => spend(), ModelError)
  assertStringIncludes(no.message, 'answers visitors again on the 1st')
  assertEquals(/plan|\$\d/.test(no.message), false, no.message)
  await (await spend(visited.space, false, 0.1)).settle(0.1)
  let fresh = (await dir.at(visited.space.eid))!
  assertAlmostEquals(fresh.meter!.models, 0.14)
  assertAlmostEquals(fresh.meter!.visitors!, 0.04)
  await (await spend(welcoming.space, true, 0.09)).settle(0.09)
  await assertRejects(() => spend(welcoming.space, true, 0.02), ModelError)
})

// T-144939: one visitor asks for as many model calls a day as the owner lets
// them, so no one stranger spends the visitors' whole share; others, and
// members, go on, and tomorrow they are answered again.
test('one visitor asks for only so many model calls a day', async () => {
  let today = new Date('2026-11-06T12:00:00Z')
  let spend = (visitor?: string, now = today, what?: 'realtime') =>
    reserved(p.env, counted.space, () => ({ dollars: 0.01 }), mint(), {
      visitor,
      now,
      what,
    })
  await Promise.all([spend('ada'), spend('ada')])
  let no = await assertRejects(() => spend('ada'), ModelError)
  assertStringIncludes(no.message, 'answers you again tomorrow')
  await spend('bo')
  await spend()
  await spend('ada', today, 'realtime')
  await spend('ada', new Date('2026-11-07T00:00:00Z'))
})
