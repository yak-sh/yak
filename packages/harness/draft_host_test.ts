import { assertEquals, assertRejects } from '@std/assert'
import { openDrafts } from './draft_vault.ts'

Deno.test('host profiles isolate frontends, lock concurrent writers and recover across reopen', async () => {
  const directory = await Deno.makeTempDir()
  // Each frontend reads its own environment; the test process's is untouched.
  const at = (frontend: string) => (name: string) =>
    new Map([
      ['HARNESS_DRAFT_DIR', directory],
      ['HARNESS_DB', directory + '/candidate.db'],
      ['HARNESS_FRONTEND', frontend],
    ]).get(name)
  try {
    let first = await openDrafts(at('one'))
    try {
      first.ui.edit({ text: 'one private draft', at: 4 })
      await first.ui.flush()
      await assertRejects(() => openDrafts(at('one')), Error, 'already open')
      const second = await openDrafts(at('two'))
      assertEquals(second.ui.draft.value[0].draft, { text: '', at: 0 })
      second.ui.edit({ text: 'two private draft', at: 9 })
      await second.close()
    } finally {
      await first.close()
    }
    first = await openDrafts(at('one'))
    assertEquals(first.ui.draft.value[0].draft, {
      text: 'one private draft',
      at: 4,
    })
    await first.close()
  } finally {
    await Deno.remove(directory, { recursive: true })
  }
})
