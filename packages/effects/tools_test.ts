// The check: a run left for a person, and a run nobody is working.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { type Bundle, type Comp, type Graph, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab, type Vocab } from '@yaks/vocab'
import { blog, blogGraph, owes, pooledBlog } from './testing.ts'
import { effectDoc } from './pool.ts'
import { type Options, runs } from './tools.ts'
import { effects } from './registry.ts'

let checkup = async (g: Graph, vocab: Vocab, options: Options = {}) => {
  let [said] = await runs({ vocab }, options).effect_check(
    { entity: { eid: 'c1' }, call: { args: {} } },
    g,
  ) as Bundle[]
  return {
    body: String((said.content as Comp).body),
    level: (said.finding as Comp | undefined)?.level,
  }
}

let ago = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString()

let pooled = async (...rows: Record<string, unknown>[]) => {
  let g = blogGraph([], pooledBlog)
  await g.apply(
    rows.map((effect, i) => ({ entity: { eid: `r${i}` }, effect })),
    { trusted: true },
  )
  return g
}

test('a pool whose runs all landed is nothing to report', async () => {
  let g = await pooled({ state: 'done', at: ago(90) })
  assertEquals((await checkup(g, pooledBlog)).level, undefined)
})

test('a run that spent its attempts is a fail', async () => {
  let g = await pooled({ state: 'failed', at: ago(90) })
  let said = await checkup(g, pooledBlog)
  assertEquals(said.level, 'fail')
  assert(said.body.includes('left for a person'), said.body)
})

test('a run pending past the cutoff is a warn, a fresh one is not', async () => {
  let g = await pooled({ handler: 'post_note', state: 'pending', at: ago(90) })
  let said = await checkup(g, pooledBlog)
  assertEquals(said.level, 'warn')
  assertEquals(
    (await checkup(
      await pooled({ handler: 'post_note', state: 'pending', at: ago(1) }),
      pooledBlog,
    ))
      .level,
    undefined,
  )
})

test('a graph that keeps no pool has nothing to be behind on', async () => {
  let said = await checkup(blogGraph(), blog)
  assertEquals(said.level, undefined)
  assert(said.body.endsWith('— nothing to report'), said.body)
})

let poolTools = runs({ vocab: pooledBlog })
let door = async (
  g: Graph,
  name: 'effect_retry' | 'effect_drop',
  of: string,
) => {
  let [said] = await poolTools[name](
    { entity: { eid: 'c1' }, call: { args: { of } } },
    g,
  ) as Bundle[]
  return String((said.content as Comp).body)
}
let row = async (g: Graph, eid: string) =>
  (await g.get([eid]))[0]?.effect as Comp | undefined

let mixed = () =>
  pooled(
    { handler: 'post_note', state: 'failed', attempts: 3, at: ago(90) },
    { handler: 'post_note', state: 'pending', attempts: 0, at: ago(1) },
    { handler: 'post_note', state: 'done', attempts: 1, at: ago(90) },
    // Waiting for a handler no plugin declares.
    { handler: 'gone', state: 'pending', attempts: 0, at: ago(90) },
  )

// A pool holding one failed run, built once: the test is the retry and the
// pass, not the graph.
// Pool transitions need their ordinary vocabulary; blog provenance stamps
// and storage-assigned numbers are unrelated to retrying a run.
let retryVocab = loadVocab([effectDoc, owes, {
  $defs: {
    post: { component: true, properties: { title: { type: 'string' } } },
  },
}])
let landed = 0
let fx = effects(retryVocab, { report: () => {} })
// The run is already owed: commit hooks for discovering new effects,
// provenance stamps and storage-assigned numbers are unrelated to retrying it.
let worked = graph({
  storage: ram(retryVocab),
  vocab: retryVocab,
})
// The worker is already joined; this test measures retrying and completing.
await fx.work(worked, undefined, 1)
await worked.apply([
  { entity: { eid: 'p1' }, post: { title: 'One' } },
  {
    entity: { eid: 'r0' },
    effect: {
      handler: 'post_note',
      target: 'p1',
      comp: 'post',
      kind: 'created',
      state: 'failed',
      attempts: 2,
      error: 'no',
      at: ago(90),
      generation: 0,
    },
  },
], { trusted: true })
// Only the retried run is worked.
fx.handle({ post_note: () => void landed++ })

test('retry puts a failed run back to the pool, which then finishes it', async () => {
  assert(
    (await door(worked, 'effect_retry', 'post_note')).startsWith('retried 1'),
  )
  await fx.work(worked, undefined, 1)
  assertEquals(landed, 1)
})

test('drop deletes a failed run and an orphan, and the check stops naming them', async () => {
  let g = await mixed()
  assert((await checkup(g, pooledBlog)).body.includes('no plugin declares'))
  assert((await door(g, 'effect_drop', 'r0')).startsWith('dropped 1'))
  assert((await door(g, 'effect_drop', 'gone')).startsWith('dropped 1'))
  assertEquals((await checkup(g, pooledBlog)).level, undefined)
})

test('a door touches only the runs it settles, and refuses a name matching none', async () => {
  let g = await mixed()
  let refused = [
    ...['r1', 'r2', 'nope'].flatMap((id) => [
      ['effect_retry', id] as const,
      ['effect_drop', id] as const,
    ]),
    // An orphan retried would only wait again.
    ['effect_retry', 'r3'] as const,
  ]
  for (let [name, id] of refused) {
    await door(g, name, id).then(
      () => assert(false, `${name} ${id}`),
      (e) => assert(String(e.message).includes('names no effect run')),
    )
  }
  assertEquals(
    [(await row(g, 'r1'))?.attempts, (await row(g, 'r2'))?.state],
    [0, 'done'],
  )
})
