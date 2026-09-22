import { assertEquals } from '@std/assert'
import type { Comp } from '@yaks/graph'
import { team, teamGraph } from './harness.ts'

Deno.test('completion uses by, never a second actor spelling', () => {
  assertEquals(team.column('completed', 'actor'), undefined)
  // The mark is written bare and signed: when, by whom and through what are
  // the server's, so there is nothing left for a client to state.
  assertEquals(team.comp('completed')!.writable, [])
  assertEquals(team.comp('completed')!.stamped, ['at', 'by', 'via'])
})

Deno.test('completion fills an author gap but preserves a named author and later edits', async () => {
  let { g } = teamGraph()
  await g.apply([
    { entity: { eid: 'writer' }, person: {} },
    { entity: { eid: 'named' }, person: {} },
    { entity: { eid: 'inferred' }, task: {}, completed: {} },
    { entity: { eid: 'voice' }, $actor: { by: 'writer' } },
  ])
  // Server code may still name the author outright; the wire may not.
  await g.apply(
    [{ entity: { eid: 'explicit' }, task: {}, completed: { by: 'named' } }],
    { trusted: true },
  )
  let authors = async () =>
    (await g.read('.task')).map((b) => (b.completed as Comp).by).sort()
  assertEquals(await authors(), ['named', 'writer'])
  // Saying it again, in somebody else's voice, does not rewrite who finished it.
  await g.apply([
    { entity: { eid: 'inferred' }, completed: {} },
    { entity: { eid: 'explicit' }, completed: {} },
    { entity: { eid: 'voice' }, $actor: { by: 'named' } },
  ])
  assertEquals(await authors(), ['named', 'writer'])
})
