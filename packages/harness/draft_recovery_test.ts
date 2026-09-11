import { assertEquals, assertRejects } from '@std/assert'
import { stash } from '@yaks/client'
import { frontend } from './frontend.ts'
import { draftVault } from './draft_vault.ts'

let text = (ui: ReturnType<typeof frontend>) => ui.draft.value[0].draft as { text: string; at: number }

Deno.test('local drafts recover per session, including new-session draft and yank', async () => {
  const vault = stash()
  let ui = frontend(vault)
  await ui.ready
  ui.edit({ text: 'new\nmessage', at: 3 })
  ui.patch({ selected: 'one' })
  ui.edit({ text: 'session one', at: 4 })
  ui.patch({ mode: 'task' })
  ui.select({ surface: '', text: '', anchor: 0, at: 0, yank: 'cut text' })
  await ui.flush()
  ui.close()
  ui = frontend(vault)
  await ui.ready
  assertEquals(text(ui), { text: 'session one', at: 4 })
  assertEquals(ui.composer.value[0].composer, { mode: 'task' })
  assertEquals((ui.visual.value[0].visual as { yank: string }).yank, 'cut text')
  ui.patch({ selected: null })
  assertEquals(text(ui), { text: 'new\nmessage', at: 3 })
  await ui.flush()
  ui.close()
})

Deno.test('acknowledgement clears only submitted draft, failures and newer edits stay', async () => {
  const ui = frontend(stash())
  await ui.ready
  ui.patch({ selected: 'one' })
  ui.edit({ text: 'first', at: 5 })
  const first = ui.submission()
  assertEquals(text(ui).text, 'first') // failure does not call accepted
  ui.edit({ text: 'newer', at: 5 })
  first.accepted('one')
  assertEquals(text(ui).text, 'newer')
  const next = ui.submission()
  ui.patch({ selected: 'two' })
  ui.edit({ text: 'other', at: 5 })
  next.accepted('one')
  assertEquals(text(ui).text, 'other')
  ui.patch({ selected: 'one' })
  assertEquals(text(ui).text, '')
  await ui.flush()
  ui.close()
})

Deno.test('disk vault restores private text and clear removes saved records', async () => {
  const directory = await Deno.makeTempDir()
  try {
    const vault = await draftVault(directory)
    const ui = frontend(vault)
    await ui.ready
    ui.edit({ text: 'private draft', at: 8 })
    await ui.flush()
    ui.close()
    const reopened = frontend(await draftVault(directory))
    await reopened.ready
    assertEquals(text(reopened), { text: 'private draft', at: 8 })
    reopened.close()
    for await (const file of Deno.readDir(directory)) {
      assertEquals((await Deno.stat(directory + '/' + file.name)).mode! & 0o777, 0o600)
    }
    await vault.clear()
    assertEquals(await vault.load(), [])
  } finally { await Deno.remove(directory, { recursive: true }) }
})

Deno.test('failed vault write is visible and shutdown flush rejects', async () => {
  const vault = stash()
  vault.save = () => Promise.reject(new Error('disk full'))
  const ui = frontend(vault)
  await ui.ready
  ui.edit({ text: 'keep me', at: 7 })
  await assertRejects(() => ui.flush(), Error, 'disk full')
  assertEquals(text(ui).text, 'keep me')
  ui.close()
})
