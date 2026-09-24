import { assertEquals, assertRejects } from '@std/assert'
import { registered } from './artifact_tools.ts'
import { open } from './store.ts'
import { artifactStore } from '@yaks/blob'
Deno.test('image reads resolve registered artifacts and verify bytes; no arbitrary address access', async () => {
  let h = open(':memory:')
  try {
    let bytes = new Uint8Array([1, 2, 3])
    let record = await artifactStore(h.artifacts)(bytes, 'image/png')
    await h.g.apply([{ entity: { eid: 'picture' }, artifact: record }])
    assertEquals((await registered(h.g, 'picture', h.artifacts)).bytes, bytes)
    await assertRejects(() => registered(h.g, 'elsewhere', h.artifacts))
    await h.g.apply([{
      entity: { eid: 'picture' },
      artifact: { size: 40000000 },
    }])
    await assertRejects(() => registered(h.g, 'picture', h.artifacts))
  } finally {
    h.close()
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
  let record = await artifactStore(h.artifacts)(bytes, 'image/png')
  await h.g.apply([{ entity: { eid: 'image' }, artifact: record }])
  h.close()
  let r = await remote({
    db: directory + '/db',
    cwd: directory,
    fake: true,
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
