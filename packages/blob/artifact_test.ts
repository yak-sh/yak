// An artifact read back is the bytes its row names or nothing: a store that
// holds other bytes under the address is an error, never a silent substitute.
import { assertEquals, assertRejects } from '@std/assert'
import { artifactBytes, artifactStore } from './artifact.ts'
import type { Blobs } from './store.ts'

let memory = (): Blobs & { map: Map<string, Uint8Array> } => {
  let map = new Map<string, Uint8Array>()
  return {
    map,
    has: (sha) => map.has(sha),
    get: (sha) => map.get(sha),
    put: (sha, bytes) => void map.set(sha, bytes),
  }
}

Deno.test('an artifact reads back as the bytes its row names', async () => {
  let blobs = memory()
  let a = await artifactStore(blobs)(new Uint8Array([1, 2, 3]), 'x/y')
  assertEquals(await artifactBytes(blobs, a), new Uint8Array([1, 2, 3]))
  assertEquals(
    await artifactBytes(blobs, { ...a, address: '0'.repeat(64) }),
    undefined,
  )
  blobs.map.set(a.address, new Uint8Array([1, 2, 4]))
  await assertRejects(() => artifactBytes(blobs, a), Error, 'not the ones')
  blobs.map.set(a.address, new Uint8Array([1, 2]))
  await assertRejects(() => artifactBytes(blobs, a), Error, 'not the ones')
})
