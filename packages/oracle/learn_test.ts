// Public oracle tools retain distinct directional knowledge and refuse a
// stale revision without changing the topic or creating a context session.
import { equal, ok, test, throws } from '@yaks/testing'
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel/vocab'
import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
import { sessionDoc } from '@yaks/session'
import { contextDoc } from '@yaks/context'
import { toolsDoc } from '@yaks/tools/vocab'
import { docDoc } from '@yaks/doc/vocab'
import { memoryDoc } from '@yaks/memory'
import { topicDoc, topicEid } from '@yaks/topic'
import { oracleDoc } from './vocab.ts'
import { part } from './learn.ts'
import { runs } from './tools.ts'

let vocab = loadVocab([
  kernelDoc,
  toolsDoc,
  edgeDoc,
  sessionDoc,
  contextDoc,
  docDoc,
  memoryDoc,
  topicDoc,
  oracleDoc,
], [kernelKeywords, edgeKeywords])
let fresh = async (name: string) => {
  let g = graph({ vocab, storage: ram(vocab), plugins: [edges(vocab)] })
  let topic = topicEid(name), source = crypto.randomUUID()
  await g.apply([
    { entity: { eid: topic }, topic: { name }, doc: { title: name } },
    { entity: { eid: source }, doc: { body: 'The recorded source.' } },
  ])
  return { g, topic, source }
}
let call = (args: Record<string, unknown>): Bundle => ({
  entity: { eid: crypto.randomUUID() },
  call: { args },
})
let r = runs(), learned = await fresh('learned'), stale = await fresh('stale')
let missing = await fresh('missing'), separate = await fresh('separate')
let value = (f: Awaited<ReturnType<typeof fresh>>, body: string) => ({
  body,
  evidence: [f.source],
})
let revise = (
  f: Awaited<ReturnType<typeof fresh>>,
  body: string,
  was: unknown = null,
) =>
  r.oracle_revise!(
    call({ oracle: f.topic, self: value(f, body), was: { self: was } }),
    f.g,
  )
await revise(stale, 'Current knowledge')
await revise(separate, 'Private knowledge')
let [before] = await r.oracle_read!(
  call({ oracle: separate.topic }),
  separate.g,
)

test('oracle learning retains a cited immutable context without a placeholder session', async () => {
  let [row, source] = await revise(learned, 'What was learned')
  equal(part(source, 'content').body, 'What was learned')
  equal(part(row, 'topic_context').self, source.entity.eid)
  let cites = await learned.g.read(
    `.cites .edge.from=${source.entity.eid} ?edge`,
  )
  equal(part(cites[0], 'edge').to, learned.source)
  ok(part(cites[0], 'cites').hash)
  equal(await learned.g.read('.session'), [])
})
test('an older directional context cannot overwrite concurrent learning', async () => {
  await throws(() => revise(stale, 'Stale edit'))
  let [, source] = await r.oracle_read!(call({ oracle: stale.topic }), stale.g)
  equal(part(source, 'content').body, 'Current knowledge')
})
test('parent-facing learning does not replace a topic’s private context', async () => {
  let [row] = await r.oracle_revise!(
    call({
      oracle: separate.topic,
      parent: value(separate, 'Upward knowledge'),
      was: { parent: null },
    }),
    separate.g,
  )
  equal(part(row, 'topic_context').self, part(before, 'topic_context').self)
  ok(part(row, 'topic_context').parent != part(row, 'topic_context').self)
})
test('unknown evidence cannot be retained as learned knowledge', async () => {
  await throws(() =>
    r.oracle_revise!(
      call({
        oracle: missing.topic,
        self: { body: 'Unsupported', evidence: [crypto.randomUUID()] },
        was: { self: null },
      }),
      missing.g,
    )
  )
  equal(part((await missing.g.get([missing.topic]))[0], 'topic_context'), {})
})
