import { assert, assertEquals, assertRejects } from '@std/assert'
import { open } from './store.ts'
import { artifactTools, imageContext } from './artifact_tools.ts'
import { input } from '@yaks/openai'
import type { Bundle } from '@yaks/graph'

const png = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0)

Deno.test('file import snapshots bytes; attach is user-only; explicit view projects bounded image bytes', async () => {
  let dir = await Deno.makeTempDir()
  let h = open(':memory:')
  try {
    await Deno.writeFile(dir + '/source.png', png)
    let call: Bundle = {
      entity: { eid: 'call' },
      entry: { session: 's', seq: 1 },
      call: { id: 'provider-call' },
    }
    await h.g.apply([{ entity: { eid: 's' }, session: {} }, call])
    let ctx = { session: 's', call, entries: [call] }
    let tools = artifactTools(h.g, {
      cwd: dir,
      images: { directory: dir + '/blobs' },
    })
    let invoke = async (name: string, args: Record<string, unknown>) =>
      await tools.find((t) => t.name == name)!.run(args, ctx)
    let imported = JSON.parse(
      String(await invoke('artifact_import', { path: 'source.png' })),
    )
    assertEquals(
      JSON.parse(
        String(await invoke('artifact_import', { path: 'source.png' })),
      ).artifact,
      imported.artifact,
    )
    await Deno.writeTextFile(dir + '/source.png', 'changed')
    await invoke('artifact_attach', { artifact: imported.artifact })
    let result: Bundle = {
      entity: { eid: 'result' },
      result: { call: 'call' },
      content: { body: 'attached' },
    }
    let rows = await h.g.read('.entry')
    assertEquals(
      await imageContext(h.g, [result], rows, { directory: dir + '/blobs' }),
      [],
    )
    await invoke('image_view', { artifact: imported.artifact })
    rows = await h.g.read('.entry')
    let items = await imageContext(h.g, [result], rows, {
      directory: dir + '/blobs',
    })
    assertEquals(items.length, 1)
    assertEquals(items[0].kind, 'image')
    if (items[0].kind == 'image') assertEquals(items[0].bytes, png)
    let wire = input([
      { kind: 'result', id: 'provider-call', output: 'viewed' },
      ...items,
    ]) as Record<string, unknown>[]
    assertEquals(wire[0].type, 'function_call_output')
    assertEquals(wire[1].role, 'user')
    assert(JSON.stringify(wire[1]).includes('data:image/png;base64,'))
    assert(!JSON.stringify(rows).includes('base64'))
    // Explicit image exposure only follows its result, not unrelated subsequent windows.
    assertEquals(
      await imageContext(h.g, [], rows, { directory: dir + '/blobs' }),
      [],
    )
    await assertRejects(() => invoke('image_view', { artifact: 'missing' }))
    await Deno.writeTextFile(dir + '/blobs/' + imported.address, 'corrupt')
    await assertRejects(() =>
      imageContext(h.g, [result], rows, { directory: dir + '/blobs' })
    )
  } finally {
    h.close()
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('tool-driven vision reaches the next model request and survives database reopen', async () => {
  const { agent } = await import('./run.ts')
  let dir = await Deno.makeTempDir()
  const { images } = await import('./images.ts')
  let record = await images({ directory: dir + '/blobs' }).store(
    png,
    'image/png',
  )
  let h = open(dir + '/test.db')
  await h.g.apply([{ entity: { eid: 'picture' }, artifact: record }])
  let turn = 0
  let a = agent({
    h,
    cwd: dir,
    images: { directory: dir + '/blobs' },
    name: 'fake',
    model: (req) => {
      turn++
      if (turn == 1) {
        return Promise.resolve({
          id: 'one',
          model: 'fake',
          items: [
            {
              kind: 'call',
              id: 'view-call',
              name: 'image_view',
              args: '{"artifact":"picture"}',
            },
            {
              kind: 'call',
              id: 'attach-call',
              name: 'artifact_attach',
              args: '{"artifact":"picture"}',
            },
          ],
        })
      }
      assertEquals(req.items.filter((i) => i.kind == 'image').length, 1)
      assertEquals(req.items.filter((i) => i.kind == 'result').length, 2)
      return Promise.resolve({
        id: 'two',
        model: 'fake',
        items: [{ kind: 'assistant', text: 'seen' }],
      })
    },
  })
  try {
    let session = await a.start('inspect and attach')
    await a.idle(session)
    assertEquals(turn, 2)
    let entries = await a.transcript(session)
    assertEquals(entries.filter((e) => e.attachment).length, 2)
    assertEquals(entries.filter((e) => e.exception).length, 0)
    await a.close()
    h = open(dir + '/test.db')
    let restored = await imageContext(h.g, entries, entries, {
      directory: dir + '/blobs',
    })
    assertEquals(restored.length, 1)
    h.close()
  } finally {
    await a.close()
    await Deno.remove(dir, { recursive: true })
  }
})
