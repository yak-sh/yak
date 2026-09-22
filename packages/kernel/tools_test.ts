import { assert, assertEquals } from '@std/assert'
import type { Bundle, Comp, ToolCtx } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { kernelDoc } from './vocab.ts'
import { runs } from './tools.ts'

// The runs, built the way a host builds them: a facet is a factory.
let tools = runs()

// A tool is a function from bundles to bundles: hand it the arguments and read
// what it answered. Nothing here opens a store — what the answer lands as is
// the runner's, tested where the runner is.
let ctx = (args: Record<string, unknown>, at: Record<string, string> = {}) =>
  ({
    args,
    graph: {
      address: (ids: string[]) =>
        new Map(ids.filter((i) => at[i]).map((i) => [i, at[i]])),
    },
  }) as unknown as ToolCtx

let comp = (b: Bundle, name: string) => b[name] as Comp

Deno.test('every kernel tool is declared and implemented', () => {
  assertEquals(loadTools(kernelDoc, tools).map((t) => t.name), ['comment_new'])
})

Deno.test('a comment is a doc aimed at an entity', async () => {
  let [said] = await tools.comment_new!(
    [],
    ctx({ target: 'T-7', body: 'looks right' }, { 'T-7': 'seven' }),
  ) as Bundle[]
  assertEquals(comp(said, 'comment').target, 'seven')
  assertEquals(comp(said, 'doc').body, 'looks right')
  assert(said.entity.eid.startsWith('$'), said.entity.eid)
})

Deno.test('an id nothing addresses is taken as the eid it is', async () => {
  let [said] = await tools.comment_new!(
    [],
    ctx({ target: 'abc', body: 'hi' }),
  ) as Bundle[]
  assertEquals(comp(said, 'comment').target, 'abc')
})
