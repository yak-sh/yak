// The Operator's recall ranks by meaning over its store's own vectors
// (operator-store.ts `Vectors`), so a memory worded differently from the
// person's message still reaches the turn beside it (T-1674), and only for
// someone who writes in the space.
import { equal, test } from '@yaks/testing'
import type { Embedder } from '@yaks/embedding'
import type { Request } from '@yaks/model'
import { platform } from './directory-rows-probe.ts'
import { directoryOf } from './directory.ts'
import { operatorModel, operatorService } from './operator-testing.ts'
import { receive } from './operator-channels.ts'
import { type OperatorStore, operatorStore } from './operator-store.ts'
import { operatorVectors } from './operator-vectors.ts'
import { embeds } from './testing.ts'
import { durable } from '../../packages/durable-object/testing.ts'

// An embedder that puts the memory .62 from the person's message, as near as
// yaks.app's model puts a paraphrase: past its floor for memories (embedding.ts
// `FLOORS`), short of the floor @yaks/memory measured on the box's model.
let meaning: Embedder = {
  model: 'subject-3',
  embed: (text) =>
    new Float32Array(
      /tomatoes/.test(text)
        ? [1, 0, 0]
        : /veggies/.test(text)
        ? [.62, Math.sqrt(1 - .62 ** 2), 0]
        : [0, 0, 1],
    ),
}

let { env } = platform('operator-meaning')
let dir = directoryOf(env.STORE)
let person = crypto.randomUUID(), eid = crypto.randomUUID()
await dir.apply({
  entities: [
    { entity: { eid: person }, person: {}, doc: { title: 'Ada' } },
    { entity: { eid }, space: { slug: 'ada', store: 'ada' } },
    {
      entity: { eid: crypto.randomUUID() },
      member: { person, space: eid, role: 'owner' },
    },
  ],
}, { 'x-yak-person': person, 'x-yak-role': 'owner' })
let asked: Request[] = []
let store = await operatorStore(durable(), {}, {}, {
  model: () => meaning,
  arm: () => Promise.resolve(),
})
let service = operatorService(
  env,
  { person, role: 'owner' as const, space: eid },
  operatorModel((req) => {
    asked.push(req)
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: [{ kind: 'assistant', text: 'Yes.' }],
      cost: 0.001,
    })
  }),
  store,
)
env.BUILDER = service.binding
let KEPT = 'Ada waters her tomatoes every morning before work'
let PRIVATE = 'Bea uses rainwater on her veggies'
let bea = crypto.randomUUID(), beas = crypto.randomUUID()
let [, { entity: memory }] = await store.g.apply([
  { entity: { eid: person }, person: {} },
  {
    entity: { eid: crypto.randomUUID() },
    memory: {},
    doc: { title: KEPT, body: KEPT },
    $actor: { by: person },
  },
  { entity: { eid: bea }, person: {} },
  {
    entity: { eid: beas },
    session: {},
    operator_session: { person: bea, space: eid },
  },
  // The private memories are closer than Ada's and would fill the ranking.
  ...Array.from({ length: 6 }, (_, i) => ({
    entity: { eid: crypto.randomUUID() },
    entry: { session: beas },
    memory: {},
    content: { body: `${PRIVATE} (${i + 1})` },
    $actor: { by: bea },
  })),
], { trusted: true })
await store.vectors!.work()

await receive(
  store,
  { space: eid, person, channel: 'chat' },
  'How often should my backyard veggies get a drink?',
)
await service.drain()
let turn = JSON.stringify(asked.at(-1)!.items)
// Someone outside the space, replying to a letter the Operator sent them.
await receive(
  store,
  {
    space: eid,
    person: crypto.randomUUID(),
    channel: 'letter',
    address: 'cy@example.com',
  },
  'How often should my backyard veggies get a drink?',
)
await service.drain()
let replied = JSON.stringify(asked.at(-1)!.items)

test('a memory worded unlike the message reaches its turn by meaning', () => {
  equal(turn.includes('Nearest memories and decisions'), true)
  equal(turn.includes(KEPT), true)
})
test("auto-recall leaves out another person's private memories", () => {
  equal(turn.includes(PRIVATE), false)
})
test('someone outside the space is brought none of its memories', () => {
  equal(replied.includes('cy@example.com'), true)
  equal(replied.includes('Nearest memories and decisions'), false)
})
test('its vectors are kept in the Operator store', async () => {
  equal(store.vectors!.owes(), false)
  equal(
    (await store.meaning!('tomatoes', { limit: 1 }))[0]?.entity,
    memory.eid,
  )
})

// The lender the Builder gives its store (operator-vectors.ts), over Workers
// AI: a store no session names a space for has nobody to bill, so it lends no
// embedder and its drains wait without failing, until a session names one.
env.AI = embeds({} as never) as unknown as typeof env.AI
let lent = Promise.withResolvers<void>()
let alone: OperatorStore = await operatorStore(
  durable(),
  {},
  {},
  operatorVectors(env, {
    space: () => alone,
    arm: () => Promise.resolve(),
    ready: () => {
      alone.vectors?.run()
      lent.resolve()
    },
  }),
)
await alone.g.apply([{
  entity: { eid: crypto.randomUUID() },
  memory: {},
  doc: { title: KEPT },
}], { trusted: true })
await alone.vectors!.work()
let waited = alone.vectors!.owes()
// A session arrives with the words it was started on.
let started = crypto.randomUUID()
await alone.g.apply([
  {
    entity: { eid: started },
    operator_session: { space: eid, person },
    session: { id: started },
  },
  {
    entity: { eid: crypto.randomUUID() },
    entry: { session: started },
    content: { body: 'Hello there.' },
  },
], { trusted: true })
// The space is learned by a read, and the drain then runs: wait on each, not
// on a count of ticks.
await lent.promise
for (let w; (w = alone.vectors!.work());) await w

test('a store no session names a space for waits to embed, then drains', () => {
  equal([waited, alone.vectors!.owes()], [true, false])
})
