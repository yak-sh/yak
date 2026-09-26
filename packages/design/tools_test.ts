// The two halves of a decision: writing a proposal down, and settling it.

import { assertEquals } from '@std/assert'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
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

Deno.test('every design tool is declared and implemented', () => {
  assertEquals(loadTools(designDoc, tools).map((t) => t.name).sort(), [
    'design_decide',
    'design_new',
  ])
})

Deno.test('a proposal is design{} plus the words, put forward', async () => {
  let [said] = await tools.design_new!(
    ...asked({ title: 'One shape', body: 'why', project: 'p19' }),
  ) as Bundle[]
  assertEquals(comp(said, 'design'), {})
  assertEquals(comp(said, 'doc'), { title: 'One shape', body: 'why' })
  assertEquals(comp(said, 'proposed'), {})
  assertEquals(comp(said, 'filed'), { project: 'p19' })
})

Deno.test('a proposal nobody filed wears no filing', async () => {
  let [said] = await tools.design_new!(...asked({ title: 'A thought' }))
  assertEquals(Object.keys(said as Bundle).sort(), [
    'design',
    'doc',
    'entity',
    'proposed',
  ])
})

// The mark carries the verdict and nothing else: `by`, `via` and `at` are
// stamped from the caller, so the line cannot name somebody else as decider.
Deno.test('a decision is the verdict on the design it names', async () => {
  let [said] = await tools.design_decide!(
    ...asked({ design: 'd1', verdict: 'declined' }),
  ) as Bundle[]
  assertEquals(said.entity.eid, 'd1')
  assertEquals(Object.keys(said).sort(), ['decided', 'entity'])
  assertEquals(comp(said, 'decided'), { verdict: 'declined' })
})
