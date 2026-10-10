// The Files entrypoint's blob door caches only tenant-keyed bytes. In a
// runtime without Workers Caching, the same door streams bounded R2 ranges.
import { test } from '@yaks/testing'
import {
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from '@std/assert'
import { blobAt } from './cache.ts'
import { blobBytes, fetch } from './files.ts'
import { platform } from './serving-probe.ts'

test('the cached blob door streams bytes and bounds uncached seeks', async () => {
  using scenario = platform()
  let { env, files } = scenario
  let eid = '11111111-1111-4111-8111-111111111111'
  let sha = 'a'.repeat(64)
  let prefix = 'ada/cookbook/blobs/'
  let bytes = new Uint8Array([0, 1, 2, 3, 4, 5])
  files.held.set(prefix + sha, bytes)
  let calls: Request[] = []
  env.FILES = {
    fetch: (req) => {
      calls.push(req)
      return fetch(req, env)
    },
  }
  let get = (method = 'GET', headers: Record<string, string> = {}) =>
    blobBytes(env, { eid }, prefix, sha, headers.range, method)

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
  assertEquals(calls[0].url, blobAt(eid, sha))
  assertEquals(calls[1].url, calls[0].url)
  assertEquals(calls[1].headers.get('range'), 'bytes=2-4')

  let before = files.gets.length
  let head = await get('HEAD')
  assertEquals(head.status, 200)
  assertEquals(head.headers.get('content-length'), '6')
  assertEquals(files.gets.length, before)
  await head.body?.cancel()

  let key = prefix + sha
  let tag = (await files.r2.head(key))!.etag
  let [again, seek, metadata] = await Promise.all([
    files.r2.get(key),
    files.r2.get(key, { range: { offset: 2, length: 3 } }),
    files.r2.head(key),
  ])
  assertEquals([again!.etag, seek!.etag, metadata!.etag], [tag, tag, tag])
  assertEquals(metadata!.size, bytes.length)
  assertEquals(new Uint8Array(await seek!.arrayBuffer()), bytes.slice(2, 5))
  assertEquals(
    new Uint8Array(await new Response(again!.body).arrayBuffer()),
    bytes,
  )

  // A held buffer may change while its earlier reads are still hashing.
  let original = bytes.slice()
  bytes[0] = 7
  let snapshot = bytes.slice()
  let pending = files.r2.get(key)
  let pendingHead = files.r2.head(key)
  bytes[0] = 9
  let changed = await files.r2.get(key)
  assertNotEquals(changed!.etag, tag)
  assertEquals(new Uint8Array(await changed!.arrayBuffer()), bytes)
  let previous = (await pending)!
  assertNotEquals(previous.etag, tag)
  assertNotEquals(changed!.etag, previous.etag)
  assertEquals((await pendingHead)!.etag, previous.etag)
  assertEquals(new Uint8Array(await previous.arrayBuffer()), snapshot)
  bytes.set(original)
  assertEquals((await files.r2.head(key))!.etag, tag)

  // R2 owns writes, including a view into a caller's larger buffer.
  for (
    let input of [
      new Uint8Array([8, 1, 2, 3, 8]).subarray(1, 4),
      new Uint8Array([4, 5, 6]).buffer,
    ]
  ) {
    let caller = input instanceof Uint8Array ? input : new Uint8Array(input)
    let written = caller.slice()
    let putting = files.r2.put(key, input)
    caller.fill(0)
    await putting
    let stored = (await files.r2.get(key))!
    assertEquals(new Uint8Array(await stored.arrayBuffer()), written)
    let returned = new Uint8Array(await stored.arrayBuffer())
    returned.fill(9)
    assertEquals((await files.r2.head(key))!.etag, stored.etag)
    assertEquals(
      new Uint8Array(await (await files.r2.get(key))!.arrayBuffer()),
      written,
    )
  }

  files.held.delete(prefix + sha)
  let absent = await get()
  assertEquals(absent.status, 404)
  assertEquals(absent.headers.get('cache-control'), 'private, no-store')
})
