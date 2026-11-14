// The two halves of a decision: writing a proposal down, and settling it.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Bundle, type Comp, type Graph, graph } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { docDoc } from '@yaks/doc/vocab'
import { kernelDoc } from '@yaks/kernel/vocab'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { examplesAreTheirKinds } from '../ram/testing.ts'
import { designDoc } from './vocab.ts'
import { runs } from './tools.ts'

// The runs, built the way a host builds them: a facet is a factory.
let tools = runs()

// A call, and the graph a host would hand the tool. The ids arrive as eids:
// the runner resolves what a person typed (@yaks/tools).
let asked = (args: Record<string, unknown>): [Bundle, Graph] => [
  { entity: { eid: 'c1' }, call: { args } },
  {} as Graph,
]

let comp = (b: Bundle, name: string) => b[name] as Comp

test('every design tool is declared and implemented', () => {
  assertEquals(loadTools(designDoc, tools).map((t) => t.name).sort(), [
    'design_decide',
    'design_new',
  ])
})

test('a proposal is design{} plus the words', async () => {
  let [said] = await tools.design_new!(
    ...asked({ title: 'One shape', body: 'why', project: 'p19' }),
  ) as Bundle[]
  assertEquals(comp(said, 'design'), {})
  assertEquals(comp(said, 'doc'), { title: 'One shape', body: 'why' })
  assertEquals(comp(said, 'filed'), { project: 'p19' })
})

test('a design written through any door is put forward by its writer', () => {
  let docs = [designDoc, docDoc, kernelDoc]
  let vocab = loadVocab(docs)
  let g = graph({ vocab, storage: ram(vocab) })
  g.apply([{ entity: { eid: 'ada' }, doc: { title: 'Ada' } }])
  let [b] = g.apply([{
    entity: { eid: 'd1' },
    design: {},
    doc: { title: 'One shape' },
    $actor: { by: 'ada' },
  }]) as Bundle[]
  assertEquals((b.proposed as Comp).by, 'ada')
  assertEquals(typeof (b.proposed as Comp).at, 'string')
})

test('each design kind example is its kind', () => {
  assertEquals(examplesAreTheirKinds([designDoc, docDoc, kernelDoc]), [
    'design',
    'review',
  ])
})

test('a proposal nobody filed wears no filing', async () => {
  let [said] = await tools.design_new!(...asked({ title: 'A thought' }))
  assertEquals(Object.keys(said as Bundle).sort(), [
    'design',
    'doc',
    'entity',
  ])
})

// An answer with no named decider keeps the original caller attribution.
test('a decision is the verdict on the design it names', async () => {
  let [said] = await tools.design_decide!(
    ...asked({ design: 'd1', verdict: 'declined' }),
  ) as Bundle[]
  assertEquals(said.entity.eid, 'd1')
  assertEquals(Object.keys(said).sort(), ['decided', 'entity'])
  assertEquals(comp(said, 'decided'), { verdict: 'declined' })
})
