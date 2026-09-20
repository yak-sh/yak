// The checks: a board whose query stopped routing, and work no project holds.

import { assert, assertEquals } from '@std/assert'
import type { Bundle, Comp, Graph, ToolCtx } from '@yaks/graph'
import { graph } from '@yaks/graph'
import { edges } from '@yaks/edge'
import { tasks } from '@yaks/task'
import { store, team } from './harness.ts'
import { runs } from './tools.ts'

// One check run, as a host would call it: the prose it answered and the level
// it carries.
let checkup = async (name: 'board_check' | 'project_check', g: Graph) => {
  let [said] = await runs({ vocab: team })[name]([], {
    graph: g,
    actor: null,
    read: (q) => g.read(q),
    args: {},
    call: 'c1',
  } as ToolCtx) as Bundle[]
  return {
    body: String((said.content as Comp).body),
    level: (said.error as Comp | undefined)?.code,
  }
}

// A graph WITHOUT the board guard — which is how a board stops routing in the
// first place: written by a host composing other words, or against a
// vocabulary that has since moved.
let unguarded = (): Graph =>
  graph({ storage: store(), vocab: team, plugins: [edges(team), tasks()] })

let seeded = async (...bundles: Bundle[]) => {
  let g = unguarded()
  await g.apply(bundles)
  return g
}

Deno.test('a board that still routes is nothing to report', async () => {
  let said = await checkup(
    'board_check',
    await seeded({ entity: { eid: 'b1' }, board: { query: '.status=open' } }),
  )
  assertEquals(said.level, undefined)
  assert(said.body.endsWith('— nothing to report'), said.body)
})

Deno.test('a board whose query no longer routes is a fail', async () => {
  let said = await checkup(
    'board_check',
    await seeded({ entity: { eid: 'b1' }, board: { query: '.staus=open' } }),
  )
  assertEquals(said.level, 'fail')
  assert(said.body.includes('no longer routes'), said.body)
  assert(said.body.includes('.staus=open'), said.body)
})

Deno.test('governed work under a project, directly or by containment', async () => {
  let said = await checkup(
    'project_check',
    await seeded(
      { entity: { eid: 'p1' }, project: {} },
      { entity: { eid: 't1' }, task: {}, filed: { project: 'p1' } },
      { entity: { eid: 't2' }, task: {} },
      { entity: { eid: 'e1' }, edge: { from: 't1', to: 't2' }, contains: {} },
    ),
  )
  assertEquals(said.level, undefined)
})

Deno.test('a task no project reaches is a fail', async () => {
  let said = await checkup(
    'project_check',
    await seeded(
      { entity: { eid: 'p1' }, project: {} },
      { entity: { eid: 't1' }, task: {}, filed: { project: 'p1' } },
      { entity: { eid: 't9' }, task: {} },
    ),
  )
  assertEquals(said.level, 'fail')
  assert(said.body.includes('is under no project'), said.body)
  assert(!said.body.includes('T-1 '), said.body)
})
