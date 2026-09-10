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
