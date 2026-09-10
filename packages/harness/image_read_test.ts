import { assertEquals, assertRejects } from '@std/assert'
import { readImage } from './images.ts'
import { open } from './store.ts'
import { artifactStore, fileBlobs } from '@yaks/blob'
Deno.test('image reads resolve registered blobs and verify bytes; no arbitrary address access', async () => {
  let directory = await Deno.makeTempDir()
  let h = open(':memory:')
  try {
    let bytes = new Uint8Array([1, 2, 3])
    let record = await artifactStore(fileBlobs(directory))(bytes, 'image/png')
    await h.g.apply([{ entity: { eid: 'picture' }, artifact: record }])
    assertEquals(await readImage(h.g, 'picture', { directory }), bytes)
    await assertRejects(() => readImage(h.g, record.address, { directory }))
    await h.g.apply([{
      entity: { eid: 'picture' },
      artifact: { size: 40000000 },
    }])
    await assertRejects(() => readImage(h.g, 'picture', { directory }))
  } finally {
    h.close()
    await Deno.remove(directory, { recursive: true })
  }
})

Deno.test('worker retrieves registered image bytes for the lazy attachment renderer', async () => {
  const { remote } = await import('./remote.ts')
  const { install, onPaint } = await import('../tui/dom.ts')
  const { ansiBackend } = await import('../tui/paint.ts')
  const { render } = await import('preact')
  let directory = await Deno.makeTempDir()
  let before = Deno.env.get('HARNESS_GRAPHICS')
  Deno.env.set('HARNESS_GRAPHICS', 'kitty')
  let h = open(directory + '/db')
  let bytes = new Uint8Array(24)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  new DataView(bytes.buffer).setUint32(16, 1)
  new DataView(bytes.buffer).setUint32(20, 1)
  let record = await artifactStore(fileBlobs(directory))(bytes, 'image/png')
  await h.g.apply([{ entity: { eid: 'image' }, artifact: record }])
  h.close()
  let r = await remote({
    db: directory + '/db',
    cwd: directory,
    fake: true,
    images: { directory },
  })
  let screen = install(), output: string[] = []
  onPaint(() => {})
  let backend = ansiBackend({
    graphics: 'kitty',
    size: () => ({ columns: 40, rows: 12 }),
    write: (s) => output.push(s),
  })
  try {
    let node = r.agent.entry({
      entity: { eid: 'attachment' },
      entry: { session: 's', seq: 1 },
      attachment: { artifact: 'image' },
      content: { body: 'Image image' },
    })
    render(node, screen.root as unknown as Element)
    for (let i = 0; i < 100 && !output.join('').includes('a=t,f=100'); i++) {
      backend.draw(screen.root)
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assertEquals(output.join('').includes('a=t,f=100'), true)
  } finally {
    backend.stop()
    render(null, screen.root as unknown as Element)
    screen.free()
    await r.close()
    if (before == null) Deno.env.delete('HARNESS_GRAPHICS')
    else Deno.env.set('HARNESS_GRAPHICS', before)
    await Deno.remove(directory, { recursive: true })
  }
})
