// The two halves of a decision: writing a proposal down, and settling it.

import { assertEquals } from '@std/assert'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { designDoc } from './vocab.ts'
import { runs } from './tools.ts'

// The runs, built the way a host builds them: a facet is a factory.
let tools = runs()

// A call, and a graph that knows the ids in `at`.
let asked = (
  args: Record<string, unknown>,
  at: Record<string, string> = {},
): [Bundle, Graph] => [
  { entity: { eid: 'c1' }, call: { args } },
  {
    address: (ids: string[]) =>
      new Map(ids.filter((i) => at[i]).map((i) => [i, at[i]])),
  } as unknown as Graph,
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
    ...asked({ title: 'One shape', body: 'why', project: 'P-19' }, {
      'P-19': 'p19',
    }),
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
    ...asked({ design: 'D-1', verdict: 'declined' }, { 'D-1': 'd1' }),
  ) as Bundle[]
  assertEquals(said.entity.eid, 'd1')
  assertEquals(Object.keys(said).sort(), ['decided', 'entity'])
  assertEquals(comp(said, 'decided'), { verdict: 'declined' })
})
