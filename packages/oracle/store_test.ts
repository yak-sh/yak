// Persistence checks cross apply/read so identity, ordering and transcript
// references are exercised through the same door as a retained tree.
import { equal, test } from '@yaks/testing'
import { type Comp, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel/vocab'
import { edgeDoc, edgeKeywords } from '@yaks/edge/vocab'
import { sessionDoc } from '@yaks/session/vocab'
import { project } from '@yaks/session'
import { toolsDoc } from '@yaks/tools/vocab'
import { docs as docDocs } from '@yaks/doc/vocab'
import { contextDoc } from '@yaks/context/vocab'
import { oracleDoc } from './vocab.ts'
import { graphTree, loadTree, treeBundles } from './store.ts'
import { identityEid } from '@yaks/graph/identity'
import type { OracleNode } from './tree.ts'

let vocab = loadVocab([
  kernelDoc,
  edgeDoc,
  sessionDoc,
  toolsDoc,
  ...docDocs,
  contextDoc,
  oracleDoc,
], [kernelKeywords, edgeKeywords])
let g = graph({ storage: ram(vocab), vocab })
let eid = crypto.randomUUID()
let source = crypto.randomUUID()
let revision = {
  revision: 'v1',
  advert: { title: 'Blue', description: 'Color facts' },
  self: 'Blue is a color.',
  shared: 'colors',
  evidence: [source],
}
let nodes: OracleNode[] = [{
  id: 'root',
  domain: 'Colors',
  children: ['leaf'],
  evidence: [source],
  tools: [],
  revisions: [revision],
}, {
  id: 'leaf',
  parent: 'root',
  domain: 'Blue',
  children: [],
  evidence: [source],
  tools: [],
  revisions: [revision],
}]
let evidence = [{
  id: source,
  at: '2026-01-01T00:00:00Z',
  words: 'Blue is a color.',
}]
let conversation = {
  id: 'q1',
  from: 'caller',
  to: 'root',
  revision: 'v1',
  turns: 1,
  declined: false,
  finished: true,
  items: [
    { kind: 'user' as const, text: 'Color?' },
    { kind: 'call' as const, id: 'c1', name: 'read_evidence', args: '{}' },
    { kind: 'result' as const, id: 'c1', output: 'Blue' },
    { kind: 'assistant' as const, text: 'Blue' },
  ],
}
let bundles = await treeBundles(eid, 'Colors', { root: 'root', nodes }, [
  conversation,
], evidence)
await g.apply([{
  entity: { eid: identityEid('tool', ['read_evidence']) },
  tool: {
    name: 'read_evidence',
    description: 'Existing registered implementation',
    revision: 'original',
  },
}])
await g.apply(bundles)
let before = await g.read('.oracle ?doc ?session')
await g.apply(bundles)
let loaded = await loadTree(g, eid)

test('tree repeat save preserves nodes, topology, evidence and revisions', async () => {
  equal(loaded.root, 'root')
  equal(loaded.nodes.find((n) => n.id == 'root'), nodes[0])
  equal(loaded.nodes.find((n) => n.id == 'leaf'), nodes[1])
  equal(await g.read('.oracle ?doc ?session'), before)
})

let resumed = await graphTree(g, {
  tree: eid,
  title: 'Colors',
  retained: true,
  rows: [],
  cutoff: '2026-02-01T00:00:00Z',
  limits: { maxNodes: 3, queryCalls: 2 },
  model: () =>
    Promise.resolve({
      id: 'reply',
      model: 'test',
      items: [{ kind: 'assistant', text: 'Blue.' }],
    }),
})
await resumed.question()({ message: 'Color?' })
let afterResume = await loadTree(g, eid)
let dialogues = await g.read('.oracle_dialogue *')
let tools = await g.read('.tool *')
let transcripts = await g.read('.entry *')
let sample = dialogues.find((r) =>
  transcripts.some((t) => (t.entry as Comp).session == r.entity.eid && t.call)
)!
let sampleItems = transcripts.filter((r) =>
  (r.entry as Comp).session == sample.entity.eid
).sort((a, b) => Number((a.entry as Comp).seq) - Number((b.entry as Comp).seq))
let projected = project(
  sampleItems,
  sampleItems,
  new Map([[identityEid('tool', ['read_evidence']), {
    name: 'read_evidence',
    description: 'read',
    parameters: { type: 'object' },
  }]]),
)
test('resumed graph question writes session participants and transcript', async () => {
  equal(afterResume, loaded)
  equal(resumed.stats().growthCalls, 0)
  equal(dialogues.length, 2)
  for (let row of dialogues) {
    let d = row.oracle_dialogue as Comp
    equal(
      (await g.get([String(d.from), String(d.to)])).every((r) => !!r.session),
      true,
    )
    equal(
      transcripts.some((r) => (r.entry as Comp).session == row.entity.eid),
      true,
    )
  }
  equal(tools[0].entity.eid, identityEid('tool', ['read_evidence']))
  equal((tools[0].tool as Comp).revision, 'original')
  equal(projected, conversation.items)
  equal(transcripts.filter((r) => r.call).every((r) => !!r.execution), true)
})
