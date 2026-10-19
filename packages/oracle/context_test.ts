// Parent endpoint metadata selects directional context without changing a
// relation's stored direction. Only one generation of classified links shares.
import { equal, ok, test, throws } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel/vocab'
import { edgeDoc, edgeKeywords, edges, link } from '@yaks/edge'
import { contextDoc } from '@yaks/context'
import { toolsDoc } from '@yaks/tools/vocab'
import { docDoc } from '@yaks/doc/vocab'
import { taskDoc } from '@yaks/task/vocab'
import { memoryDoc, topicEid } from '@yaks/memory'
import { sha256 } from '@yaks/graph/sha256'
import { neighborhood } from './context.ts'

let vocab = loadVocab([
  kernelDoc,
  toolsDoc,
  edgeDoc,
  contextDoc,
  docDoc,
  memoryDoc,
  taskDoc,
  {
    $defs: {
      within: { component: true, type: 'object', edge: true, parent: 'to' },
    },
  },
], [kernelKeywords, edgeKeywords])
let g = graph({ vocab, storage: ram(vocab), plugins: [edges(vocab)] })
let labels = [
  'center',
  'incoming',
  'outgoing',
  'farther',
  'inverse',
  'empty',
  'unknown',
  'damaged',
]
let ids = labels.map(topicEid)
let contexts = ids.slice(0, 5).flatMap((eid, i) =>
  ['self', 'parent', 'children'].map((slot) => {
    let body = `knowledge-${i}-${slot}`
    return {
      entity: { eid: crypto.randomUUID() },
      prompt: { source: eid, revision: sha256(body) },
      content: { body },
    }
  })
)
await g.apply([
  ...ids.map((eid, i) => ({
    entity: { eid },
    topic: { name: labels[i] },
    ...i < 5
      ? {
        topic_context: Object.fromEntries(
          ['self', 'parent', 'children'].map((
            slot,
            j,
          ) => [slot, contexts[i * 3 + j].entity.eid]),
        ),
      }
      : {},
  })),
  ...contexts,
  link(ids[1], 'contains', ids[0]),
  link(ids[0], 'contains', ids[2]),
  link(ids[3], 'contains', ids[1]),
  link(ids[0], 'within', ids[4]),
  link(ids[0], 'cites', ids[3]),
  link(ids[6], 'reads', ids[0]),
])
let [center, empty, unknown] = await g.get([ids[0], ids[5], ids[6]])
let damaged = crypto.randomUUID()
await g.apply([
  {
    entity: { eid: damaged },
    prompt: { source: ids[7], revision: sha256('Original bytes') },
    content: { body: 'Edited bytes' },
  },
  { entity: { eid: ids[7] }, topic_context: { self: damaged } },
])
let [bad] = await g.get([ids[7]])

test('classified mixed relations admit the intended directional context one hop only', async () => {
  let { body, heads } = await neighborhood(g, center)
  for (
    let text of [
      'knowledge-0-self',
      'knowledge-1-children',
      'knowledge-2-parent',
      'knowledge-4-children',
    ]
  ) ok(body.includes(text))
  for (
    let text of [
      'knowledge-0-parent',
      'knowledge-0-children',
      'knowledge-1-self',
      'knowledge-1-parent',
      'knowledge-2-self',
      'knowledge-2-children',
      'knowledge-3-self',
      'knowledge-3-parent',
      'knowledge-3-children',
      'knowledge-4-parent',
    ]
  ) equal(body.includes(text), false)
  equal(heads.length, 4)
  ok(body.includes('-contains->'))
  ok(body.includes('-within->'))
})
test('an empty topic opens without inventing stored context', async () => {
  equal((await neighborhood(g, empty)).heads, [])
})
test('unclassified relationships do not share context automatically', async () => {
  let { body, heads } = await neighborhood(g, unknown)
  equal(heads, [])
  equal(body.includes('knowledge-0-'), false)
})
test('edited context bytes cannot masquerade as the retained revision', async () => {
  await throws(() => neighborhood(g, bad))
})
