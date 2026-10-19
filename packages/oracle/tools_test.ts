// Native oracle questions fork frozen context through the graph. A fake model
// exercises the same session reaction that serves a person's conversation.
import { equal, ok, test } from '@yaks/testing'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel/vocab'
import { edgeDoc, edgeKeywords, link } from '@yaks/edge'
import { react, sessionDoc, sessions, transcript } from '@yaks/session'
import { toolsDoc } from '@yaks/tools/vocab'
import { modelDoc, type Request } from '@yaks/model'
import { contextDoc } from '@yaks/context'
import { docDoc } from '@yaks/doc/vocab'
import { oracleDoc } from './vocab.ts'
import { runs } from './tools.ts'
import { question } from './Talk.tsx'

let vocab = loadVocab([
  kernelDoc,
  edgeDoc,
  sessionDoc,
  toolsDoc,
  modelDoc,
  contextDoc,
  docDoc,
  oracleDoc,
], [kernelKeywords, edgeKeywords])
let g = graph({ vocab, storage: ram(vocab), plugins: [sessions()] })
let model = identityEid('model', ['fixture'])
let provider = identityEid('provider', ['openai'])
let tree = crypto.randomUUID(), oracle = crypto.randomUUID()
let owner = crypto.randomUUID()
await g.apply([
  { entity: { eid: owner }, doc: { title: 'Caller' } },
  { entity: { eid: model }, model: { name: 'fixture' } },
  { entity: { eid: provider }, provider: { name: 'openai' }, using: { model } },
  { ...link(provider, 'serves', model), serves: { name: 'fixture' } },
  { entity: { eid: tree }, oracle_tree: { root: oracle } },
  {
    entity: { eid: oracle },
    session: { ended: true },
    doc: { title: 'Vehicle oracle' },
    oracle: {
      tree,
      domain: 'Vehicles',
      self: 'The car is a 2013 Honda Pilot.',
      shared: 'Vehicle facts.',
      evidence: [],
      revisions: [],
    },
  },
])
let call = (id: string, text: string): Bundle => ({
  entity: { eid: id },
  call: { args: { oracle, text } },
  $actor: { by: owner },
})
let run = runs().oracle_query!
let first = call(crypto.randomUUID(), '  How does it work?\n')
let [dialogue] = await run(first, g)
let before = await transcript(g, dialogue.entity.eid)
let again = await run(first, g)
let [second] = await run(call(crypto.randomUUID(), 'Another question'), g)
await g.apply([{
  entity: { eid: oracle },
  oracle: { self: 'The car has changed.' },
}])
let [third] = await run(call(crypto.randomUUID(), 'Updated question'), g)
let old = await transcript(g, dialogue.entity.eid)
let fresh = await transcript(g, third.entity.eid)
let requests: Request[] = []
let step = await react(g, dialogue.entity.eid, {
  model: (request) => {
    requests.push(request)
    return Promise.resolve({
      id: 'fixture-reply',
      model: 'fixture',
      items: [{ kind: 'assistant', text: 'A native answer.' }],
    })
  },
  tools: [
    'graph_query',
    'graph_show',
    'graph_schema',
    'graph_apply',
    'oracle_query',
  ]
    .map((name) => ({
      name,
      description: name,
      parameters: {},
      run: () => '',
    })),
})
let after = await transcript(g, dialogue.entity.eid)
let [source] = await g.get([oracle], ['session', 'oracle'])

test('oracle question preserves words and receives the retained context in a native fork', () => {
  ok(dialogue.native)
  ok(dialogue.fork)
  equal((before.at(-1)?.content as Comp).body, '  How does it work?\n')
  equal((before.at(-1)?.using as Comp).model, model)
  ok(String((before[0].content as Comp).body).includes('2013 Honda Pilot'))
  equal((source.session as Comp).ended, true)
})
test('replayed questions reuse their dialogue and independent questions fork separately', () => {
  equal(again[0].entity.eid, dialogue.entity.eid)
  ok(second.entity.eid != dialogue.entity.eid)
  equal(second.fork, dialogue.fork)
  equal(old.length, before.length)
})
test('a retained context revision never changes an existing receiving fork', () => {
  ok(String((old[0].content as Comp).body).includes('2013 Honda Pilot'))
  ok(String((fresh[0].content as Comp).body).includes('car has changed'))
  ok((third.fork as Comp).from != (dialogue.fork as Comp).from)
})
test('the existing native reaction answers an oracle question from its retained context', () => {
  equal(step.status, 'settled')
  equal((after.at(-1)?.content as Comp).body, 'A native answer.')
  ok(
    requests[0].items.some((item) =>
      item.kind == 'instruction' && item.text.includes('2013 Honda Pilot')
    ),
  )
})
test('the oracle composer records exact words and the selected oracle through a graph call', () => {
  let [row] = question(oracle, ' exact words\n')
  equal((row.call as Comp).args, { oracle, text: ' exact words\n' })
  equal((row.call as Comp).to, identityEid('tool', ['oracle_query']))
})
