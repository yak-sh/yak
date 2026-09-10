import { assertEquals } from '@std/assert'
import { promptEntry, snapshot } from './mod.ts'
Deno.test('snapshots retain immutable text and source identity separately', async () => {
  let a = await snapshot('old', 'graph:rules')
  let b = await snapshot('new', a.source)
  assertEquals(a.source, b.source)
  assertEquals(a.revision == b.revision, false)
  assertEquals(a, await snapshot('old', a.source))
  let entry = promptEntry('s', 1, a.body, a.source, 'shared', a.revision)
  assertEquals(entry.content, { body: 'old' })
  assertEquals(entry.prompt, {
    source: a.source,
    scope: 'shared',
    revision: a.revision,
  })
})
