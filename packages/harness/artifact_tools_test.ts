import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { artifactTools, imageContext } from './artifact_tools.ts'
import { local } from './local.ts'
import { input } from '@yaks/openai'
import type { Bundle } from '@yaks/graph'
import type { Item } from '@yaks/model'
import {
  artifactBytes,
  artifactStore,
  fileBlobs,
  memoryBlobs,
} from '@yaks/blob'
import { harness } from './testing.ts'

const png = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG7cAAAAASUVORK5CYII=',
  ),
  (c) => c.charCodeAt(0),
)

test('file import snapshots bytes; attach is user-only; explicit view projects bounded image bytes', async () => {
  let dir = await Deno.makeTempDir()
  let h = await harness()
  let blobs = fileBlobs(dir + '/blobs')
  try {
    let source = png
    let machines = {
      files: async function* (session: string, paths: string[]) {
        assertEquals(session, 's')
        assertEquals(paths, ['source.png'])
        yield { path: paths[0], bytes: source.slice() }
      },
    }
    let call: Bundle = {
      entity: { eid: 'call' },
      entry: { session: 's', seq: 1 },
      call: { id: 'provider-call' },
    }
    await h.g.apply([{ entity: { eid: 's' }, session: {} }, call])
    let ctx = { session: 's', call, entries: [call] }
    let tools = artifactTools(h.g, { machines, artifacts: blobs })
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
    source = new TextEncoder().encode('changed')
    await invoke('artifact_attach', { artifact: imported.artifact })
    let result: Bundle = {
      entity: { eid: 'result' },
      result: { call: 'call' },
      content: { body: 'attached' },
    }
    let rows = await h.g.read('.entry&*')
    assertEquals(
      await imageContext(h.g, [result], rows, blobs),
      new Map(),
    )
    await invoke('image_view', { artifact: imported.artifact })
    rows = await h.g.read('.entry&*')
    let items = (await imageContext(h.g, [result], rows, blobs)).get(
      result.entity.eid,
    )!
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
      await imageContext(h.g, [], rows, blobs),
      new Map(),
    )
    await assertRejects(() => invoke('image_view', { artifact: 'missing' }))
    await Deno.writeTextFile(dir + '/blobs/' + imported.address, 'corrupt')
    await assertRejects(() => imageContext(h.g, [result], rows, blobs))
  } finally {
    h.close()
    await Deno.remove(dir, { recursive: true })
  }
})

test('tool-driven vision reaches the next model request and survives database reopen', async () => {
  let dir = await Deno.makeTempDir()
  let h = await harness(dir + '/test.db')
  let record = await artifactStore(h.artifacts)(png, 'image/png')
  await h.g.apply([{ entity: { eid: 'picture' }, artifact: record }])
  let turn = 0
  let prefix: Item[] = []
  let a = local({
    h,
    cwd: dir,
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
      if (turn == 2) prefix = req.items.slice()
      else assertEquals(req.items.slice(0, prefix.length), prefix)
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
    await a.send(session, 'What did you see?')
    await a.idle(session)
    assertEquals(turn, 3)
    let entries = await a.transcript(session)
    assertEquals(entries.filter((e) => e.attachment).length, 2)
    assertEquals(entries.filter((e) => e.exception).length, 0)
    await a.close()
    h = await harness(dir + '/test.db')
    let restored = [...(await imageContext(
      h.g,
      entries,
      entries,
      h.artifacts,
    )).values()].flat()
    assertEquals(restored.length, 1)
    h.close()
  } finally {
    await a.close()
    await Deno.remove(dir, { recursive: true })
  }
})

test('vision admission rejects unsupported files and changed artifact revisions', async () => {
  let dir = await Deno.makeTempDir()
  let h = await harness()
  let blobs = fileBlobs(dir)
  try {
    let store = artifactStore(blobs)
    let record = await store(png, 'image/png')
    let call: Bundle = {
      entity: { eid: 'inspect' },
      entry: { session: 's', seq: 1 },
      call: { id: 'ig' },
    }
    await h.g.apply([{ entity: { eid: 's' }, session: {} }, call, {
      entity: { eid: 'a' },
      artifact: record,
    }, {
      entity: { eid: 'truncated' },
      artifact: await store(png.slice(0, 12), 'image/png'),
    }, {
      entity: { eid: 'svg' },
      artifact: await store(
        new TextEncoder().encode('<svg/>'),
        'image/svg+xml',
      ),
    }])
    let view = artifactTools(h.g, { artifacts: blobs }).find((t) =>
      t.name == 'image_view'
    )!
    let ctx = { session: 's', call, entries: [call] }
    await assertRejects(async () => await view.run({ artifact: 'svg' }, ctx))
    await assertRejects(async () =>
      await view.run({ artifact: 'truncated' }, ctx)
    )
    await view.run({ artifact: 'a' }, ctx)
    let rows = await h.g.read('.entry&*')
    // Authorized graph mutation cannot silently substitute pixels for an admitted image.
    let changed = await store(new Uint8Array([...png, 1]), 'image/png')
    await h.g.apply([{ entity: { eid: 'a' }, artifact: changed }])
    await assertRejects(() =>
      imageContext(
        h.g,
        [{ entity: { eid: 'r' }, result: { call: 'inspect' } }],
        rows,
        blobs,
      )
    )
  } finally {
    h.close()
    await Deno.remove(dir, { recursive: true })
  }
})

test('machine file export preserves arbitrary binary bytes and refuses oversize before storage', async () => {
  let h = await harness()
  let blobs = memoryBlobs()
  let puts = 0
  let originalPut = blobs.put
  blobs.put = (address, bytes) => {
    puts++
    return originalPut(address, bytes)
  }
  let binary = new Uint8Array([0, 255, 128, 192, 32, 0, 254])
  let source = binary
  let requests: { session: string; paths: string[] }[] = []
  let machines = {
    files: async function* (session: string, paths: string[]) {
      requests.push({ session, paths })
      yield { path: paths[0], bytes: source }
    },
  }
  let call: Bundle = {
    entity: { eid: 'import-binary' },
    entry: { session: 'remote', seq: 1 },
  }
  let ctx = { session: 'remote', call, entries: [call] }
  try {
    await h.g.apply([{ entity: { eid: 'remote' }, session: {} }, call])
    let tool = artifactTools(h.g, { machines, artifacts: blobs })
      .find((t) => t.name == 'artifact_import')!
    let result = JSON.parse(
      String(await tool.run({ path: '/machine/binary' }, ctx)),
    )
    assertEquals(requests, [{ session: 'remote', paths: ['/machine/binary'] }])
    assertEquals(await artifactBytes(blobs, result), binary)
    assertEquals(result.media_type, 'application/octet-stream')
    assertEquals(puts, 1)
    source = new Uint8Array(20 * 1024 * 1024 + 1)
    await assertRejects(
      async () => await tool.run({ path: 'too-big' }, ctx),
      Error,
      'up to 20 MiB',
    )
    assertEquals(puts, 1)
    assertEquals((await h.g.read('.artifact')).length, 1)
  } finally {
    h.close()
  }
})
