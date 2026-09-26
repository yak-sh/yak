import { assert, assertEquals } from '@std/assert'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { kernelDoc } from './vocab.ts'
import { runs } from './tools.ts'

// The runs, built the way a host builds them: a facet is a factory.
let tools = runs()

// A tool is a function from the call to bundles: hand it the call and read
// what it answered. Nothing here opens a store — what the answer lands as is
// the runner's, tested where the runner is.
let asked = (args: Record<string, unknown>): [Bundle, Graph] => [
  { entity: { eid: 'c1' }, call: { args } },
  {} as Graph,
]

let comp = (b: Bundle, name: string) => b[name] as Comp

Deno.test('every kernel tool is declared and implemented', () => {
  assertEquals(loadTools(kernelDoc, tools).map((t) => t.name), ['comment_new'])
})

Deno.test('a comment is a doc aimed at an entity', async () => {
  let [said] = await tools.comment_new!(
    ...asked({ target: 'seven', body: 'looks right' }),
  ) as Bundle[]
  assertEquals(comp(said, 'comment').target, 'seven')
  assertEquals(comp(said, 'doc').body, 'looks right')
  assert(said.entity.eid.startsWith('$'), said.entity.eid)
})
