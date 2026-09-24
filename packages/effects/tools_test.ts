// The check: a run left for a person, and a run nobody is dispatching.

import { assert, assertEquals } from '@std/assert'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { blog, blogGraph, durableBlog } from './harness.ts'
import { type Options, runs } from './tools.ts'

let checkup = async (g: Graph, vocab: Vocab, options: Options = {}) => {
  let [said] = await runs({ vocab }, options).effect_check(
    { entity: { eid: 'c1' }, call: { args: {} } },
    g,
  ) as Bundle[]
  return {
    body: String((said.content as Comp).body),
    level: (said.error as Comp | undefined)?.code,
  }
}

let ago = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString()

let ledgered = async (...rows: Record<string, unknown>[]) => {
  let g = blogGraph([], durableBlog)
  await g.apply(
    rows.map((effect, i) => ({ entity: { eid: `r${i}` }, effect })),
    { trusted: true },
  )
  return g
}

Deno.test('a ledger whose runs all landed is nothing to report', async () => {
  let g = await ledgered({ state: 'done', at: ago(90) })
  assertEquals((await checkup(g, durableBlog)).level, undefined)
})

Deno.test('a run that spent its attempts is a fail', async () => {
  let g = await ledgered({ state: 'failed', at: ago(90) })
  let said = await checkup(g, durableBlog)
  assertEquals(said.level, 'fail')
  assert(said.body.includes('left for a person'), said.body)
})

Deno.test('a run pending past the cutoff is a warn, a fresh one is not', async () => {
  let g = await ledgered({ state: 'pending', at: ago(90) })
  let said = await checkup(g, durableBlog)
  assertEquals(said.level, 'warn')
  assert(said.body.includes('nothing is dispatching'), said.body)
  assertEquals(
    (await checkup(
      await ledgered({ state: 'pending', at: ago(1) }),
      durableBlog,
    ))
      .level,
    undefined,
  )
})

Deno.test('a graph that keeps no ledger has nothing to be behind on', async () => {
  let said = await checkup(blogGraph(), blog)
  assertEquals(said.level, undefined)
  assert(said.body.endsWith('— nothing to report'), said.body)
})
