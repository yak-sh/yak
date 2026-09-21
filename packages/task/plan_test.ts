// A plan is bundles — the claim the README makes, proven.
//
// There was a `task tree` tool here once. It was one shape too many: a tree is
// tasks under `$alias` ids, the links between them (whose ids their own
// sentences derive, @yaks/edge), and one atomic batch — and `apply({check})`
// rehearses that batch without keeping a row of it. So this is the tree the
// tool used to write, rehearsed, landed, and refused.

import { assert, assertEquals, assertRejects } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { token } from '@yaks/graph'
import { edgeEid } from '@yaks/edge'
import { teamGraph } from './harness.ts'

// The project the tree hangs from, and a graph holding it.
let rooted = async () => {
  let { g } = teamGraph()
  await g.apply([{ entity: { eid: 'p19' }, project: {}, doc: { title: 'TG' } }])
  return g
}

// Three tasks and the three sentences that place them: the outcome under the
// project, its prerequisite and its piece under the outcome.
let plan = (): Bundle[] => [
  {
    entity: { eid: '$goal' },
    task: {},
    doc: { title: 'The outcome' },
    filed: { project: 'p19' },
  },
  {
    entity: { eid: '$link~goal' },
    edge: { from: 'p19', to: '$goal' },
    contains: {},
  },
  {
    entity: { eid: '$gate' },
    task: {},
    doc: { title: 'First' },
    filed: { project: 'p19' },
  },
  {
    entity: { eid: '$link~gate' },
    edge: { from: '$goal', to: '$gate' },
    requires: {},
  },
  {
    entity: { eid: '$leaf' },
    task: {},
    doc: { title: 'A piece' },
    filed: { project: 'p19' },
  },
  {
    entity: { eid: '$link~leaf' },
    edge: { from: '$goal', to: '$leaf' },
    contains: {},
  },
]

let by = (said: Bundle[], alias: string): Bundle =>
  said.find((b) => b.$alias == alias)!

Deno.test('a dry run of a plan answers its ids and writes none of it', async () => {
  let g = await rooted()
  let said = await g.apply(plan(), { check: true })
  // Every alias was resolved —
  let goal = by(said, '$goal').entity.eid
  let gate = by(said, '$gate').entity.eid
  assert(goal && !goal.startsWith('$'))
  // — and each link is named by the sentence it states, not by its alias.
  assertEquals(
    by(said, '$link~goal').entity.eid,
    edgeEid('p19', 'contains', goal),
  )
  assertEquals(
    by(said, '$link~gate').entity.eid,
    edgeEid(goal, 'requires', gate),
  )
  // Nothing landed.
  assertEquals((await g.read('.task')).length, 0)
  assertEquals((await g.read('.edge')).length, 0)
})

Deno.test('the same batch, for real, lands the whole tree at once', async () => {
  let g = await rooted()
  await g.apply(plan())
  assertEquals((await g.read('.task')).length, 3)
  assertEquals((await g.read('.edge')).length, 3)
  let [goal] = await g.read('.doc.title="The outcome"')
  assertEquals(
    (await g.read(`.edge.from="${goal.entity.eid}"`)).length,
    2,
  )
})

Deno.test('what a real run refuses, a dry run refuses the same way', async () => {
  let g = await rooted()
  // A column the vocabulary does not declare, named in the refusal.
  let alien: Bundle[] = [
    ...plan(),
    { entity: { eid: '$goal' }, doc: { colour: 'red' } },
  ]
  for (let check of [true, false]) {
    await assertRejects(
      async () => await g.apply(alien, { check }),
      Error,
      'colour',
    )
  }
  // A precondition that moved: the title was never 'Emma'.
  await g.apply(plan())
  let [goal] = await g.read('.doc.title="The outcome"')
  let stale: Bundle[] = [{
    entity: goal.entity,
    doc: { title: 'Moved' },
    $was: { doc: { title: token('Emma') } },
  }]
  for (let check of [true, false]) {
    await assertRejects(async () => await g.apply(stale, { check }))
  }
  assertEquals((await g.read('.doc.title="Moved"')).length, 0)
})
