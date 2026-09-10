import { assertEquals } from '@std/assert'
import type { Comp } from '@yaks/graph'
import { team, teamGraph } from './harness.ts'

Deno.test('completion uses by, never a second actor spelling', () => {
  assertEquals(team.column('completed', 'actor'), undefined)
  assertEquals(team.comp('completed')!.writable, ['at', 'by'])
})

Deno.test('completion fills an author gap but preserves a named author and later edits', async () => {
  let { g } = teamGraph()
  await g.apply([
    { entity: { eid: 'writer' }, person: {} },
    { entity: { eid: 'named' }, person: {} },
    { entity: { eid: 'inferred' }, task: {}, completed: {} },
    { entity: { eid: 'explicit' }, task: {}, completed: { by: 'named' } },
    { entity: { eid: 'voice' }, $actor: { by: 'writer' } },
  ])
  let authors = async () =>
    (await g.read('.task')).map((b) => (b.completed as Comp).by).sort()
  assertEquals(await authors(), ['named', 'writer'])
  await g.apply([
    { entity: { eid: 'inferred' }, completed: { at: '2026-01-01T00:00:00Z' } },
    { entity: { eid: 'explicit' }, completed: { by: 'writer' } },
    { entity: { eid: 'voice' }, $actor: { by: 'named' } },
  ])
  assertEquals(await authors(), ['named', 'writer'])
})
