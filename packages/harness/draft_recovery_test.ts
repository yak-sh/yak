import { assertEquals, assertRejects } from '@std/assert'
import { stash } from '@yaks/client'
import { frontend } from './frontend.ts'
import { draftVault } from './draft_vault.ts'

let text = (ui: ReturnType<typeof frontend>) =>
  ui.draft.value[0].draft as { text: string; at: number }

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
  assertEquals(text(ui).text, '') // pending submission is recoverable, not resent
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
      assertEquals(
        (await Deno.stat(directory + '/' + file.name)).mode! & 0o777,
        0o600,
      )
    }
    await vault.clear()
    assertEquals(await vault.load(), [])
  } finally {
    await Deno.remove(directory, { recursive: true })
  }
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

Deno.test('restart recovers an unacknowledged submission without resending it', async () => {
  const vault = stash()
  let ui = frontend(vault)
  await ui.ready
  ui.edit({ text: 'sent but uncertain', at: 4 })
  ui.submission()
  ui.edit({ text: 'next draft', at: 4 })
  await ui.flush()
  ui.close()
  ui = frontend(vault)
  await ui.ready
  assertEquals(text(ui).text, 'sent but uncertain\nnext draft')
  await ui.flush()
  ui.close()
  ui = frontend(vault)
  await ui.ready
  assertEquals(text(ui).text, 'sent but uncertain\nnext draft')
  ui.close()
})

Deno.test('rejected submission restores text ahead of newer edits without touching another session', async () => {
  const ui = frontend(stash())
  await ui.ready
  ui.patch({ selected: 'one' })
  ui.edit({ text: 'failed text', at: 4 })
  const admission = ui.submission()
  ui.edit({ text: 'later', at: 3 })
  ui.patch({ selected: 'two' })
  ui.edit({ text: 'different', at: 4 })
  admission.failed()
  assertEquals(text(ui).text, 'different')
  ui.patch({ selected: 'one' })
  assertEquals(text(ui).text, 'failed text\nlater')
  await ui.flush()
  ui.close()
})

Deno.test('cut draft is cleared durably while yank remains recoverable', async () => {
  const vault = stash()
  let ui = frontend(vault)
  await ui.ready
  ui.edit({ text: 'cut\nme', at: 6 })
  ui.select({ surface: '', text: '', anchor: 0, at: 0, yank: 'cut\nme' })
  ui.edit({ text: '', at: 0 })
  await ui.flush()
  ui.close()
  ui = frontend(vault)
  await ui.ready
  assertEquals(text(ui).text, '')
  assertEquals((ui.visual.value[0].visual as { yank: string }).yank, 'cut\nme')
  ui.close()
})

Deno.test('new-session acknowledgement keeps newer text in the created session, not the next new draft', async () => {
  const ui = frontend(stash())
  await ui.ready
  ui.edit({ text: 'first', at: 5 })
  const first = ui.submission()
  ui.edit({ text: 'second', at: 6 })
  first.accepted('created')
  assertEquals(text(ui).text, 'second')
  ui.patch({ selected: null })
  assertEquals(text(ui).text, '')
  ui.patch({ selected: 'created' })
  assertEquals(text(ui).text, 'second')
  await ui.flush()
  ui.close()
})

Deno.test('draft vocabulary registers local and ephemeral tiers, not default wire tier', async () => {
  const { tierOf } = await import('@yaks/sync')
  const { frontendVocab } = await import('./frontend.ts')
  assertEquals(tierOf(frontendVocab, 'savedDraft'), 'local')
  assertEquals(tierOf(frontendVocab, 'pendingDraft'), 'local')
  assertEquals(tierOf(frontendVocab, 'recovery'), 'local')
  assertEquals(tierOf(frontendVocab, 'draft'), 'none')
  assertEquals(tierOf(frontendVocab, 'visual'), 'none')
})

Deno.test('independent pending new sessions keep recovery ownership separate', async () => {
  const vault = stash()
  let ui = frontend(vault)
  await ui.ready
  ui.edit({ text: 'first generation', at: 3 })
  const first = ui.submission()
  ui.patch({ selected: null, generation: 1 })
  ui.edit({ text: 'second generation', at: 3 })
  ui.submission()
  first.accepted('first-session')
  await ui.flush()
  ui.close()
  ui = frontend(vault)
  await ui.ready
  assertEquals(text(ui).text, 'second generation')
  ui.patch({ selected: 'first-session' })
  assertEquals(text(ui).text, '')
  await ui.flush()
  ui.close()
})
