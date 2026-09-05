import { assertEquals } from '@std/assert'
import { decode, encode } from './store.ts'
import { type Bucket, objectBlobs } from './object.ts'

// That a real `R2Bucket` satisfies `Bucket` is checked by the compiler, in
// conform.ts — it has to live outside this compile, because
// @cloudflare/workers-types brings ambient globals with it.
//
// The stand-in a test runs against: the same three methods over a Map, because
// no test should need a network or a cloud account to prove the wiring.
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
