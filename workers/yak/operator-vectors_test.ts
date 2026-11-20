// The Operator's store pays for its vectors from the space its object is,
// kept as a request names it (operator-root.ts `spacedAt`): a memory kept
// before anyone has talked with the Operator is embedded too, where a store
// that knew its space only from a session asked no model and fell behind.
import { equal, test } from '@yaks/testing'
import { retries } from '@yaks/embedding'
import { platform } from './directory-rows-probe.ts'
import { directoryOf } from './directory.ts'
import { DIM } from './embedding.ts'
import { spacedAt } from './operator-root.ts'
import { type OperatorStore, operatorStore } from './operator-store.ts'
import { operatorVectors } from './operator-vectors.ts'
import { durable } from '../../packages/durable-object/testing.ts'

retries.waits = [0]

let { env } = platform('operator-vectors')
let asked = 0
env.AI = {
  gateway: () => ({ getUrl: () => Promise.resolve('http://unused.invalid') }),
  run: (_: string, input: unknown) => {
    asked++
    let { text } = input as { text: string[] }
    let one = Array.from({ length: DIM }, (_, i) => i == 0 ? 1 : 0)
    return Promise.resolve({ data: text.map(() => one) })
  },
} as unknown as typeof env.AI
let eid = crypto.randomUUID()
await directoryOf(env.STORE).apply({
  entities: [{ entity: { eid }, space: { slug: 'ada', store: 'ada' } }],
}, { 'x-yak-role': 'owner' })

let kept = async (space?: string) => {
  let store: OperatorStore = await operatorStore(
    durable(),
    {},
    {},
    operatorVectors(env, {
      space: () => store,
      arm: () => Promise.resolve(),
      hold: () => {},
    }),
  )
  if (space) spacedAt(store, space)
  await store.g.apply([{
    entity: { eid: crypto.randomUUID() },
    memory: {},
    doc: { title: 'Ada waters her tomatoes', body: 'every morning' },
  }], { trusted: true })
  await store.vectors!.work()
  return store.vectors!.owes()
}

test('a store that keeps its space embeds a memory no session came before', async () => {
  equal(await kept(eid), false)
  equal(asked > 0, true)
})
