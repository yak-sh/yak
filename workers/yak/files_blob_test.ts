// The Files entrypoint's blob door caches only tenant-keyed bytes. In a
// runtime without Workers Caching, the same door streams bounded R2 ranges.
import { assertEquals, assertStringIncludes } from '@std/assert'
import { blobAt } from './cache.ts'
import { fetch, PREFIX } from './files.ts'
import { platform } from './serving-probe.ts'

Deno.test('the cached blob door streams bytes and bounds uncached seeks', async () => {
  using scenario = platform()
  let { env, files } = scenario
  let eid = '11111111-1111-4111-8111-111111111111'
  let sha = 'a'.repeat(64)
  let prefix = 'ada/cookbook/blobs/'
  let bytes = new Uint8Array([0, 1, 2, 3, 4, 5])
  files.held.set(prefix + sha, bytes)
  let get = (method = 'GET', headers: Record<string, string> = {}) =>
    fetch(
      new Request(blobAt(eid, sha), {
        method,
        headers: { [PREFIX]: prefix, ...headers },
      }),
      env,
    )

  let full = await get()
  assertEquals(full.status, 200)
  assertEquals(full.headers.get('content-type'), 'application/octet-stream')
  assertStringIncludes(full.headers.get('cache-control')!, 'max-age=31536000')
  assertEquals(new Uint8Array(await full.arrayBuffer()), bytes)

  let part = await get('GET', { range: 'bytes=2-4' })
  assertEquals(part.status, 206)
  assertEquals(part.headers.get('content-range'), 'bytes 2-4/6')
  assertEquals(new Uint8Array(await part.arrayBuffer()), bytes.slice(2, 5))
  assertEquals(files.gets.at(-1)?.range, { offset: 2, length: 3 })

  let before = files.gets.length
  let head = await get('HEAD')
  assertEquals(head.status, 200)
  assertEquals(head.headers.get('content-length'), '6')
  assertEquals(files.gets.length, before)
  await head.body?.cancel()

  files.held.delete(prefix + sha)
  let absent = await get()
  assertEquals(absent.status, 404)
  assertEquals(absent.headers.get('cache-control'), 'private, no-store')
})
