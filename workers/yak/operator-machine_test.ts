// An Operator's steps on its person's own machine: a platform admin who owns
// a space with a tunnel is answered by the machine behind it, through a stub
// gateway, and everyone else in the space by the hosted model.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { identityEid, mint } from '@yaks/graph'
import { type Model, ModelError, type Request } from '@yaks/model'
import { answering } from '@yaks/model/step'
import { CALLER } from '@yaks/tunnel'
import { transcript } from '@yaks/session'
import { platform } from './directory-probe.ts'
import { directoryOf, META, stamp } from './directory.ts'
import type { Env } from './env.ts'
import { operatorMemory, operatorModel } from './operator-testing.ts'
import { drain } from './operator-store.ts'
import { operating, operatorChoice } from './operator.ts'

// The machine: what it was asked for, the models it has no allowance left for
// (`spent`), and whether its tunnel's gateway reaches it (`up`).
let box: string[] = [], spent: string[] = [], up = true
let serve: Model = (req) => {
  box.push(req.model)
  if (spent.includes(req.model)) {
    return Promise.reject(new ModelError('limit', 'usage limit reached'))
  }
  return Promise.resolve({
    id: mint(),
    model: req.model,
    items: [{ kind: 'assistant', text: `the machine's ${req.model}` }],
    usage: { input_tokens: 1000, output_tokens: 10 },
    cost: 5,
  })
}
let answer = answering(serve, (e) => {
  throw e
})
// Who the platform told the machine was asking, a step at a time.
let callers: (string | null)[] = []
let DISPATCH = {
  get: () => {
    if (!up) throw new Error('the machine is off')
    return {
      fetch: (r: globalThis.Request) => {
        callers.push(r.headers.get(CALLER))
        return answer(r)
      },
    }
  },
} as unknown as Env['DISPATCH']
let { env } = platform('operator-machine', { DISPATCH })
let dir = directoryOf(env.STORE)
let jeff = mint(), bob = mint()
let as = (person: string) => ({ 'x-yak-person': person, 'x-yak-role': 'owner' })
let eid = await dir.mint(jeff, 'jeffs', 'Jeff', as(jeff))
await stamp(env, {
  entities: [{
    entity: { eid },
    tunnel: { id: mint(), service: mint(), adopted: true },
  }, {
    entity: { eid: '$seat' },
    member: { space: eid, person: bob, role: 'editor' },
  }, {
    entity: { eid: '$admin' },
    member: {
      space: (await dir.space(META.space))!.eid,
      person: jeff,
      role: 'owner',
    },
  }],
})
let space = (await dir.at(eid))!

// The hosted model, and every request it was sent.
let hosted: Request[] = []
let paid = operatorModel((req) => {
  hosted.push(req)
  return Promise.resolve({
    id: mint(),
    model: req.model,
    items: [{ kind: 'assistant', text: 'the hosted model' }],
    cost: 0.001,
  })
})
let store = operatorMemory()
let operator = operating(store, env, paid)
let on = (provider: string, model: string) => ({
  provider: identityEid('provider', [provider]),
  model: identityEid('model', [model]),
})
let HOSTED = on(operatorChoice(env).provider, paid.name)

// One turn: what the machine and the hosted model were asked, the model its
// input names, what it was answered, and what its entries cost the space.
let turn = async (
  person: string,
  o: Parameters<typeof operator.ask>[3] = {},
) => {
  box.length = hosted.length = 0
  let out = await operator.ask({ person }, space, { say: 'Hello' }, o)
  await drain(store)
  let entries = await transcript(store.g, out.session)
  let mine = entries.slice(entries.findIndex((b) => b.entity.eid == out.input))
  return {
    box: [...box],
    hosted: hosted.length,
    using: mine[0].using,
    said: mine.findLast((b) => b.output && b.content)?.content,
    cost: mine.reduce(
      (sum, b) => sum + Number((b.cost as { dollars?: number })?.dollars ?? 0),
      0,
    ),
    told: entries.filter((b) => b.operator_hosted).map((b) => !!b.completed),
    session: out.session,
  }
}

test('an admin’s turn in the space whose tunnel is theirs is answered by their machine, and the space is charged nothing', async () => {
  let t = await turn(jeff)
  assertEquals(t.box, ['sonnet'])
  assertEquals(t.hosted, 0)
  assertEquals(t.using, on('machine', 'sonnet'))
  assertEquals(t.said, { body: "the machine's sonnet" })
  // A machine lends its providers to its owner's Operator, and no app.
  assertEquals(callers, ['operator'])
  assertEquals(t.cost, 0)
  let [provider] = await store.g.get([identityEid('provider', ['machine'])])
  assertEquals(provider.provider, { name: 'machine' })
})

test('a member’s turn in the same space is answered by the hosted model, which the space pays for', async () => {
  let t = await turn(bob)
  assertEquals(t.box, [])
  assertEquals(t.hosted, 1)
  assertEquals(t.using, HOSTED)
  assertEquals(t.cost > 0, true)
})

test('a provider out of allowance passes the step to the machine’s other provider', async () => {
  spent = ['sonnet']
  let t = await turn(jeff)
  spent = []
  assertEquals(t.box, ['sonnet', 'gpt-6-sol'])
  assertEquals(t.hosted, 0)
  assertEquals(t.said, { body: "the machine's gpt-6-sol" })
  assertEquals([t.cost, t.told], [0, []])
})

test('a machine that is off passes each step to the hosted model, which is told to say so once, until the machine answers again', async () => {
  let told = () =>
    hosted.flatMap((r) => r.items).filter((i) =>
      i.kind == 'user' && i.text.includes('a hosted model is answering')
    ).length
  up = false
  let first = await turn(jeff)
  assertEquals([first.box, first.hosted], [[], 1])
  assertEquals(first.using, on('machine', 'sonnet'))
  assertEquals(first.said, { body: 'the hosted model' })
  assertEquals(first.cost > 0, true)
  assertEquals([first.told, told()], [[false], 1])
  // The line stands in the transcript, so the next step reads it there and
  // is given no second one.
  let second = await turn(jeff)
  assertEquals([second.hosted, second.told, told()], [1, [false], 1])
  up = true
  let back = await turn(jeff)
  assertEquals([back.box, back.hosted, back.told], [['sonnet'], 0, [true]])
  up = false
  assertEquals((await turn(jeff)).told, [true, false])
  up = true
})

test('a run names the machine’s provider and a model of it, and only its owner may', async () => {
  let say = { say: 'Hello', provider: 'machine', model: 'gpt-6-astra' }
  box.length = 0
  let out = await operator.run({ person: jeff }, space, say)
  assertEquals([box, out.model, out.cost], [['gpt-6-astra'], 'gpt-6-astra', 0])
  await assertRejects(
    () => operator.run({ person: bob }, space, say),
    Error,
    'no available machine provider',
  )
})

test('words that name their own model, as a call’s do, are answered by the hosted one', async () => {
  let t = await turn(jeff, { model: paid.name })
  assertEquals([t.box, t.hosted, t.using], [[], 1, HOSTED])
})

test('a turn nobody asked for at that moment waits for the machine that is off, and the space pays for none of it', async () => {
  up = false
  let t = await turn(jeff, { channel: 'machine' })
  assertEquals([t.box, t.hosted, t.cost], [[], 0, 0])
  // Its ask is owed again, for when the machine is back.
  let owed = await store.g.read(
    `.provisional&.ask&.entry.session=${t.session}&.fields=interrupted.code`,
  )
  assertEquals(owed.map((b) => b.interrupted), [{ code: 'unreachable' }])
  // His own words meanwhile fall to the hosted model, as ever.
  assertEquals((await turn(jeff)).hosted, 1)
  up = true
})
