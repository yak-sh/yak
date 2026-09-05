import { assertEquals } from '@std/assert'
import { address, decode, encode } from './store.ts'
import { fileBlobs } from './file.ts'

Deno.test('the file backend stores one file per address', async () => {
  let dir = await Deno.makeTempDir()
  try {
    let store = fileBlobs(`${dir}/blobs`)
    let sha = address('a long essay')
    assertEquals(await store.has(sha), false)
    assertEquals(await store.get(sha), undefined)
    await store.put(sha, encode('a long essay'))
    assertEquals(await store.has(sha), true)
    assertEquals(decode((await store.get(sha)) as Uint8Array), 'a long essay')
    // the directory it was pointed at is the whole store
    assertEquals([...Deno.readDirSync(`${dir}/blobs`)].map((e) => e.name), [
      sha,
    ])
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})
