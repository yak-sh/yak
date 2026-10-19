// Native topic openings pin three-direction, one-hop context without creating
// source sessions. Consultations remain ordinary delegated native sessions.
import { equal, ok, test } from '@yaks/testing'
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel/vocab'
import { edgeDoc, edgeKeywords, edges, link } from '@yaks/edge'
import {
  react,
  sessionDoc,
  sessions,
  sessionTools,
  transcript,
} from '@yaks/session'
import { contextDoc } from '@yaks/context'
import { docDoc } from '@yaks/doc/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import { modelDoc, type Request } from '@yaks/model'
import { memoryDoc, topicEid } from '@yaks/memory'
import { identityEid } from '@yaks/graph/identity'
import { oracleDoc } from './vocab.ts'
import { part } from './learn.ts'
import { runs } from './tools.ts'

let vocab = loadVocab([
  kernelDoc,
  edgeDoc,
  sessionDoc,
  contextDoc,
  docDoc,
  toolsDoc,
  modelDoc,
  memoryDoc,
  oracleDoc,
], [kernelKeywords, edgeKeywords])
let g = graph({
  vocab,
  storage: ram(vocab),
  plugins: [edges(vocab), sessions()],
})
let model = identityEid('model', ['fixture']),
  provider = identityEid('provider', ['openai'])
let owner = crypto.randomUUID(),
  parent = crypto.randomUUID(),
  oracle = topicEid('native topic')
let evidence = crypto.randomUUID(), r = runs()
await g.apply([
  { entity: { eid: owner }, doc: { title: 'Caller' } },
  {
    entity: { eid: parent },
    session: { id: parent, operator: false, ended: true },
    native: {},
  },
  { entity: { eid: model }, model: { name: 'fixture' } },
  { entity: { eid: provider }, provider: { name: 'openai' }, using: { model } },
  { ...link(provider, 'serves', model), serves: { name: 'fixture' } },
  {
    entity: { eid: oracle },
    topic: { name: 'native topic' },
    doc: { title: 'Native topic' },
  },
  { entity: { eid: evidence }, doc: { body: 'Recorded evidence' } },
])
let call = (args: Record<string, unknown>, by = owner): Bundle => ({
  entity: { eid: crypto.randomUUID() },
  call: { args },
  $actor: { by },
})
let revise = (body: string, was: unknown) =>
  r.oracle_revise!(
    call({ oracle, self: { body, evidence: [evidence] }, was: { self: was } }),
    g,
  )
let [initial, source] = await revise('  Initial topic knowledge.\n', null)
let query = call({ oracle, text: 'What is known?' }, parent)
let [first] = await r.oracle_query!(query, g)
let old = await transcript(g, first.entity.eid)
let [updated, newSource] = await revise(
  'Updated topic knowledge.',
  initial.$was?.topic_context.self,
)
let [second] = await r.oracle_query!(call({ oracle, text: 'What changed?' }), g)
let fresh = await transcript(g, second.entity.eid)
let replay = await r.oracle_query!(query, g)
let requests: Request[] = []
let step = await react(g, first.entity.eid, {
  model: (request) => {
    requests.push(request)
    return Promise.resolve({
      id: 'reply',
      model: 'fixture',
      items: [{
        kind: 'assistant',
        text: 'The original topic knowledge remains available.',
      }],
    })
  },
  tools: [],
})
let wait = sessionTools(g).find((t) => t.name == 'wait')!
let waited = JSON.parse(
  await wait.run({ children: [first.entity.eid], timeout: 0 }, {
    session: parent,
    entries: [],
    call: { entity: { eid: crypto.randomUUID() } },
  }),
)
let sources = await g.read(`.cites .edge.from=${old[0].entity.eid} ?edge`)

test('a topic query opens one native conversation from exact immutable context bytes', () => {
  equal(part(source, 'content').body, '  Initial topic knowledge.\n')
  ok(first.native)
  equal(first.fork, undefined)
  equal(part(first, 'spawned').parent, parent)
  equal(part(old.at(-1), 'content').body, 'What is known?')
  equal(sources.map((b) => part(b, 'edge').to), [source.entity.eid])
  equal(replay[0].entity.eid, first.entity.eid)
})
test('topic context revisions affect new openings while an existing conversation stays pinned', () => {
  ok(String(part(old[0], 'content').body).includes('Initial topic knowledge.'))
  ok(!String(part(old[0], 'content').body).includes('Updated topic knowledge.'))
  ok(
    String(part(fresh[0], 'content').body).includes('Updated topic knowledge.'),
  )
  ok(part(updated, 'topic_context').self != source.entity.eid)
  ok(newSource.entity.eid != source.entity.eid)
})
test('the native model receives the pinned context and its caller can await the consultation', () => {
  equal(step.status, 'settled')
  ok(
    requests[0].items.some((i) =>
      i.kind == 'instruction' && i.text.includes('Initial topic knowledge.')
    ),
  )
  ok(
    JSON.stringify(waited).includes(
      'The original topic knowledge remains available.',
    ),
  )
})
test('saved context creates no placeholder session', async () => {
  let all = await g.read('.session')
  equal(all.length, 3)
})
