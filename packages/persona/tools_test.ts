// The tools facet: what the run answers, and what it refuses.

import { assert, assertEquals, assertRejects } from '@std/assert'
import type { Bundle, Comp, Graph, ToolCtx } from '@yaks/graph'
import { link, memory, voiced, world } from './harness.ts'
import { runs } from './tools.ts'

let asked = (g: Graph, args: Record<string, unknown>) =>
  runs().persona_read([], {
    graph: g,
    actor: null,
    read: (q) => g.read(q),
    args,
    call: 'c1',
  } as ToolCtx) as Promise<Bundle[]>

let peopled = (): Graph => {
  let g = world()
  g.apply([
    voiced('n1', 'TaskMaster', 'the voice'),
    memory('m1', 'one', 'first'),
    link('n1', 'contains', 'm1'),
  ])
  return g
}

Deno.test('the answer is prose, and says which call it came from', async () => {
  let [said] = await asked(peopled(), { persona: 'n1' })
  let body = String((said.content as Comp).body)
  assert(body.startsWith('# N-1 TaskMaster\n\nthe voice'), body)
  assert(body.includes('# M-2 one'), body)
  assertEquals((said.output as Comp).source, 'c1')
})

Deno.test('a persona nobody named, and one that is not a persona, are refused', async () => {
  let g = peopled()
  await assertRejects(() => asked(g, {}), Error, 'needs a persona')
  await assertRejects(() => asked(g, { persona: 'm1' }), Error, 'no persona')
})
