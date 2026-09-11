import { assertEquals, assertRejects } from '@std/assert'
import { openDrafts } from './draft_vault.ts'

Deno.test('host profiles isolate frontends, lock concurrent writers and recover across reopen', async () => {
  const directory = await Deno.makeTempDir()
  const keys = ['HARNESS_DRAFT_DIR', 'HARNESS_FRONTEND', 'HARNESS_DB']
  const before = keys.map((k) => Deno.env.get(k))
  try {
    Deno.env.set('HARNESS_DRAFT_DIR', directory)
    Deno.env.set('HARNESS_DB', directory + '/candidate.db')
    Deno.env.set('HARNESS_FRONTEND', 'one')
    let first = await openDrafts()
    try {
      first.ui.edit({ text: 'one private draft', at: 4 })
      await first.ui.flush()
      await assertRejects(() => openDrafts(), Error, 'already open')
      Deno.env.set('HARNESS_FRONTEND', 'two')
      const second = await openDrafts()
      assertEquals(second.ui.draft.value[0].draft, { text: '', at: 0 })
      second.ui.edit({ text: 'two private draft', at: 9 })
      await second.close()
    } finally {
      await first.close()
    }
    Deno.env.set('HARNESS_FRONTEND', 'one')
    first = await openDrafts()
    assertEquals(first.ui.draft.value[0].draft, {
      text: 'one private draft',
      at: 4,
    })
    await first.close()
  } finally {
    keys.forEach((key, i) =>
      before[i] == null ? Deno.env.delete(key) : Deno.env.set(key, before[i]!)
    )
    await Deno.remove(directory, { recursive: true })
  }
})
