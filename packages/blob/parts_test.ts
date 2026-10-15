import { equal, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import {
  addressOf,
  type Bucket,
  bucketObjects,
  Gone,
  memoryMultipart,
  parts,
  Wrong,
} from './mod.ts'

// A bucket in memory, its multipart held beside it, and an upload of `file`
// into it in parts of four bytes.
let setup = async (file: Uint8Array, sha?: string) => {
  let held = new Map<string, Uint8Array>()
  let at = new Map<string, number>()
  let clock = 0
  let now = <T>(v: T) => Promise.resolve(v)
  let bucket: Bucket = {
    head: (key) =>
      now(held.has(key) ? { size: held.get(key)!.length, etag: 'v' } : null),
    get: (key, options) => {
      let bytes = held.get(key)
      if (!bytes) return now(null)
      let from = options?.range.offset ?? 0
      let part = bytes.slice(
        from,
        options ? from + options.range.length : undefined,
      )
      return now({
        etag: 'v',
        body: new Response(part).body!,
        arrayBuffer: () => now(part.buffer),
      })
    },
    put: (key, value) => {
      held.set(key, new Uint8Array(value as Uint8Array))
      return now(at.set(key, ++clock))
    },
    delete: (keys) => now([keys].flat().forEach((key) => held.delete(key))),
    list: ({ prefix }) =>
      now({
        truncated: false,
        objects: [...held].filter(([key]) => key.startsWith(prefix))
          .map(([key, bytes]) => ({
            key,
            size: bytes.length,
            uploaded: new Date(at.get(key)!),
          })),
      }),
  }
  let objects = bucketObjects(bucket)
  // Each upload the bucket begins, so a test can abort one behind the
  // ledger's back, as R2 does a week on.
  let begun: string[] = []
  let inMemory = memoryMultipart(bucket.put)
  let multipart = {
    ...inMemory,
    createMultipartUpload: async (key: string) => {
      let made = await inMemory.createMultipartUpload(key)
      begun.push(made.uploadId)
      return made
    },
  }
  sha ??= await addressOf(file)
  let key = `app/blobs/${sha}`
  let up = parts(objects, multipart, { key, sha, ledger: 'ledger/', part: 4 })
  let send = (n: number) => {
    let part = file.slice((n - 1) * 4, n * 4)
    return up.put(n, part, part.length)
  }
  let ledger = () => [...held.keys()].filter((k) => k.startsWith('ledger/'))
  return { up, send, held, key, ledger, multipart, begun }
}

let file = new TextEncoder().encode('a file of 22 bytes, ok')

test('an interrupted upload sends only the parts it lacks', async () => {
  let { up, send, held, key, ledger } = await setup(file)
  equal(await up.stand(file.length), {
    part: 4,
    need: [1, 2, 3, 4, 5, 6],
    stored: false,
  })
  await send(1)
  await send(4)
  await send(6)
  equal((await up.stand(file.length)).need, [2, 3, 5])
  for (let n of [2, 3, 5]) await send(n)
  equal((await up.stand(file.length)).need, [])
  equal(await up.finish(), { bytes: 22, head: file })
  equal(held.get(key), file)
  equal(ledger(), [])
})

test('a part sent twice is kept once', async () => {
  let { up, send } = await setup(file)
  await up.stand(file.length)
  for (let n of [1, 2, 3, 4, 5, 6, 2]) await send(n)
  equal((await up.finish()).bytes, 22)
})

test('bytes already kept need no parts', async () => {
  let { up, held, key } = await setup(file)
  held.set(key, file)
  equal(await up.stand(file.length), { part: 4, need: [], stored: true })
  equal(await up.finish(), { bytes: 22, head: file })
})

test('parts that do not hash to their name are not kept', async () => {
  let { up, send, held, key, ledger } = await setup(file, 'f'.repeat(64))
  await up.stand(file.length)
  for (let n of [1, 2, 3, 4, 5, 6]) await send(n)
  await assertRejects(() => up.finish(), Wrong)
  equal(held.has(key), false)
  equal(ledger(), [])
})

test('a part of the wrong size, or past the last, is refused', async () => {
  let { up } = await setup(file)
  await up.stand(file.length)
  await assertRejects(() => up.put(1, new Uint8Array(3), 3), Wrong)
  await assertRejects(() => up.put(6, new Uint8Array(4), 4), Wrong)
  await assertRejects(() => up.put(7, new Uint8Array(2), 2), Wrong)
})

test('an upload the bucket forgot begins again', async () => {
  let { up, send, multipart, key, begun } = await setup(file)
  await up.stand(file.length)
  await send(1)
  await multipart.resumeMultipartUpload(key, begun[0]).abort()
  await assertRejects(() => send(2), Gone)
  equal((await up.stand(file.length)).need, [1, 2, 3, 4, 5, 6])
  for (let n of [1, 2, 3, 4, 5, 6]) await send(n)
  equal((await up.finish()).bytes, 22)
})
