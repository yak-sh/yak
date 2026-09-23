import { assertEquals, assertRejects } from '@std/assert'
import { decode, encode } from './store.ts'
import { type Bucket, bucketObjects, objectBlobs } from './object.ts'

// That a real `R2Bucket` satisfies `Bucket` is checked by the compiler, in
// conform.ts — it has to live outside this compile, because
// @cloudflare/workers-types brings ambient globals with it.
//
// The stand-in a test runs against: the same methods over a Map, because no
// test should need a network or a cloud account to prove the wiring. A listing
// pages two keys at a time, so a store that stopped at the first page shows.
let fake = (): Bucket & { keys: () => string[] } => {
  let held = new Map<string, Uint8Array>()
  return {
    keys: () => [...held.keys()],
    head: (key) => Promise.resolve(held.get(key) ?? null),
    get: (key) => {
      let bytes = held.get(key)
      return Promise.resolve(
        bytes
          ? {
            arrayBuffer: () =>
              Promise.resolve(bytes.slice().buffer as ArrayBuffer),
          }
          : null,
      )
    },
    put: (key, value) => {
      held.set(key, new Uint8Array(value as ArrayBuffer))
      return Promise.resolve(null)
    },
    delete: (key) => Promise.resolve(held.delete(key)),
    list: ({ prefix, cursor }) => {
      let keys = [...held.keys()].filter((k) => k.startsWith(prefix)).sort()
      let from = Number(cursor ?? 0)
      let objects = keys.slice(from, from + 2)
        .map((key) => ({
          key,
          uploaded: new Date(key.length),
          size: held.get(key)!.byteLength,
        }))
      let truncated = from + 2 < keys.length
      return Promise.resolve({
        objects,
        truncated,
        cursor: truncated ? String(from + 2) : undefined,
      })
    },
  }
}

Deno.test('the object backend stores and reads by address', async () => {
  let bucket = fake()
  let store = objectBlobs(bucket)
  assertEquals(await store.has('abc'), false)
  assertEquals(await store.get('abc'), undefined)
  await store.put('abc', encode('a long essay'))
  assertEquals(await store.has('abc'), true)
  assertEquals(decode((await store.get('abc')) as Uint8Array), 'a long essay')
})

Deno.test('a prefix namespaces the keys without changing the address', async () => {
  let bucket = fake()
  let store = objectBlobs(bucket, 'bodies/')
  await store.put('abc', encode('hello'))
  assertEquals(bucket.keys(), ['bodies/abc'])
  assertEquals(decode((await store.get('abc')) as Uint8Array), 'hello')
})

Deno.test('a store keyed by name reads, deletes and lists every page', async () => {
  let files = bucketObjects(fake())
  assertEquals(await files.read('a/x'), null)
  await assertRejects(() => files.get('a/x'), Error, 'no object at a/x')
  for (let key of ['a/x', 'a/y', 'a/zz', 'b/x']) {
    await files.put(key, encode(key))
  }
  assertEquals(await files.has('a/y'), true)
  assertEquals(decode(await files.get('a/zz')), 'a/zz')
  assertEquals(await files.list('a/'), ['a/x', 'a/y', 'a/zz'])
  assertEquals(await files.uploaded('a/'), { 'a/x': 3, 'a/y': 3, 'a/zz': 4 })
  await files.delete('a/y')
  assertEquals(await files.list('a/'), ['a/x', 'a/zz'])
})
