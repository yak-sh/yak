// What a persona page asks for its Untiered section: the memories in its
// scope, and nothing else in the graph.
import { equal, test } from '@yaks/testing'
import '../../testing.ts'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { docDoc } from '@yaks/doc'
import { memoryDoc } from '@yaks/memory/vocab'
import '../Entity.tsx'
import { inScope } from './Persona.tsx'

let kinds: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    project: { component: true, type: 'object', kind: true, properties: {} },
    task: { component: true, type: 'object', kind: true, properties: {} },
  },
}
let vocab = loadVocab([docDoc, memoryDoc, kinds])
let g = graph({ storage: ram(vocab), vocab, plugins: [] })
await g.apply([
  { entity: { eid: 'p' }, project: {} },
  { entity: { eid: 'task' }, task: {}, doc: { title: 'a task' } },
  { entity: { eid: 'fleet' }, memory: {}, doc: { title: 'for everyone' } },
  { entity: { eid: 'here' }, memory: { scope: 'p' }, doc: { title: 'for p' } },
])
let asked = async (persona: { home?: string }) =>
  (await g.read(inScope(persona))).map((b) => b.entity.eid).sort()

test("a persona's untiered rows are the memories in its scope", async () => {
  equal(await asked({ home: 'p' }), ['here'])
  equal(await asked({}), ['fleet'])
})
