// A person's chat message reaches their Operator with what they said before
// on its subject where the conversation's model no longer has it in front of
// it: said in another session, not earlier in this one (T-160247).
import { equal, test } from '@yaks/testing'
import type { Request } from '@yaks/model'
import { platform } from './directory-rows-probe.ts'
import { directoryOf } from './directory.ts'
import { operatorModel, operatorService } from './operator-testing.ts'
import { receive } from './operator-channels.ts'
import { operatorStore } from './operator-store.ts'
import { durable } from '../../packages/durable-object/testing.ts'

let { env } = platform('operator-earlier')
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
  await operatorStore(durable()),
)
env.BUILDER = service.binding
let { store } = service
let other = crypto.randomUUID()
await store.g.apply([
  { entity: { eid: person }, person: {} },
  { entity: { eid: other }, session: { id: other } },
  {
    entity: { eid: crypto.randomUUID() },
    entry: { session: other },
    content: { body: 'Keep the recipe attachments immutable.' },
    $actor: { by: person, via: other },
  },
], { trusted: true })
let ask = async (say: string) => {
  await receive(store, { space: eid, person, channel: 'chat' }, say)
  await service.drain()
  return JSON.stringify(asked.at(-1)!.items)
}
let first = await ask('Should the recipe attachments stay immutable?')
let second = await ask('And should recipe attachments stay immutable there?')
let QUOTE = 'Keep the recipe attachments immutable.'

test('a chat message brings what the person said in another session', () => {
  equal(first.includes('Earlier words from the same person'), true)
  equal(first.includes(QUOTE), true)
})
test('words still in front of the conversation are not quoted back to it', () => {
  equal(second.split('Should the recipe attachments stay immutable?').length, 2)
})
