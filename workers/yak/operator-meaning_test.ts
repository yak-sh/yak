// The Operator's recall ranks by meaning over its store's own vectors
// (operator-store.ts `Vectors`), so a memory worded differently from the
// person's message still reaches the turn beside it (T-1674).
import { equal, test } from '@yaks/testing'
import type { Embedder } from '@yaks/embedding'
import type { Request } from '@yaks/model'
import { platform } from './directory-rows-probe.ts'
import { directoryOf } from './directory.ts'
import { operatorModel, operatorService } from './operator-testing.ts'
import { receive } from './operator-channels.ts'
import { operatorStore } from './operator-store.ts'
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
let [, { entity: memory }] = await store.g.apply([
  { entity: { eid: person }, person: {} },
  {
    entity: { eid: crypto.randomUUID() },
    memory: {},
    doc: { title: KEPT, body: KEPT },
    $actor: { by: person },
  },
], { trusted: true })
await store.vectors!.work()

await receive(
  store,
  { space: eid, person, channel: 'chat' },
  'How often should my backyard veggies get a drink?',
)
await service.drain()
let turn = JSON.stringify(asked.at(-1)!.items)

test('a memory worded unlike the message reaches its turn by meaning', () => {
  equal(turn.includes('Nearest memories and decisions'), true)
  equal(turn.includes(KEPT), true)
})
test('its vectors are kept in the Operator store', async () => {
  equal(store.vectors!.owes(), false)
  equal(
    (await store.meaning!('tomatoes', { limit: 1 }))[0]?.entity,
    memory.eid,
  )
})
