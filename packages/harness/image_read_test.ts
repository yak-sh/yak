import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { registered } from './artifact_tools.ts'
import { artifactStore } from '@yaks/blob'
import { harness } from './testing.ts'

test('image reads resolve registered artifacts and verify bytes; no arbitrary address access', async () => {
  let h = await harness()
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
