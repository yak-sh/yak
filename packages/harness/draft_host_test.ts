import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { openDrafts } from './draft_vault.ts'

test('host profiles isolate frontends, lock concurrent writers and recover across reopen', async () => {
  const directory = await Deno.makeTempDir()
  // Each frontend reads its own environment; the test process's is untouched.
  const at = (frontend: string) => (name: string) =>
    new Map([
      ['HARNESS_DRAFT_DIR', directory],
      ['HARNESS_FRONTEND', frontend],
    ]).get(name)
  try {
    let database = directory + '/candidate.db'
    let first = await openDrafts(database, at('one'))
    try {
      first.ui.edit({ text: 'one private draft', at: 4 })
      await first.ui.flush()
      await assertRejects(
        () => openDrafts(database, at('one')),
        Error,
        'already open',
      )
      const second = await openDrafts(database, at('two'))
      assertEquals(second.ui.draft.value[0].draft, { text: '', at: 0 })
      second.ui.edit({ text: 'two private draft', at: 9 })
      await second.close()
      let other = await openDrafts(directory + '/other.db', at('one'))
      assertEquals(other.ui.draft.value[0].draft, { text: '', at: 0 })
      await other.close()
    } finally {
      await first.close()
    }
    first = await openDrafts(database, at('one'))
    assertEquals(first.ui.draft.value[0].draft, {
      text: 'one private draft',
      at: 4,
    })
    await first.close()
    let env = at('one')
    first = await openDrafts(
      directory + '/other.db',
      (name) => name == 'HARNESS_DB' ? database : env(name),
    )
    assertEquals(first.ui.draft.value[0].draft, {
      text: 'one private draft',
      at: 4,
    })
    await first.close()
  } finally {
    await Deno.remove(directory, { recursive: true })
  }
})
