import { equal, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import {
  addressOf,
  type Bucket,
  bucketObjects,
  fold,
  Gone,
  memoryMultipart,
  parts,
  START,
  Wrong,
} from './mod.ts'

// A bucket in memory, its multipart held beside it, and an upload of `file`
// into it in parts of one block, 64 bytes.
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
  let up = parts(objects, multipart, { key, sha, ledger: 'ledger/', part: 64 })
  // Part n as a sender sends it: its bytes, and the hash state the bytes
  // before it leave.
  let send = (n: number, bytes = file) => {
    let part = bytes.slice((n - 1) * 64, n * 64)
    let from = fold(START, bytes.slice(0, (n - 1) * 64))
    return up.put(n, new Response(part).body!, part.length, from)
  }
  let ledger = () => [...held.keys()].filter((k) => k.startsWith('ledger/'))
  return { up, send, held, key, ledger, multipart, begun }
}

let file = new Uint8Array(150).map((_, i) => (i * 7) & 0xff)
let all = [1, 2, 3]

test('an interrupted upload sends only the parts it lacks', async () => {
  let { up, send, held, key, ledger } = await setup(file)
  equal(await up.post(file.length), { part: 64, need: all })
  await send(1)
  await send(3)
  equal(await up.post(file.length), { part: 64, need: [2] })
  await send(2)
  equal(await up.post(file.length), {
    part: 64,
    need: [],
    whole: { bytes: 150, head: file, made: true },
  })
  equal(held.get(key), file)
  equal(ledger(), [])
})

test('a part sent twice is kept once', async () => {
  let { up, send } = await setup(file)
  await up.post(file.length)
  for (let n of [1, 2, 3, 2]) await send(n)
  equal((await up.post(file.length)).whole?.bytes, 150)
})

test('bytes already kept need no parts', async () => {
  let { up, held, key } = await setup(file)
  held.set(key, file)
  equal((await up.post(file.length)).whole, { bytes: 150, head: file })
})

test('parts that do not hash to their name are not kept', async () => {
  let { up, send, held, key, ledger } = await setup(file, 'f'.repeat(64))
  await up.post(file.length)
  for (let n of all) await send(n)
  await assertRejects(() => up.post(file.length), Wrong)
  equal(held.has(key), false)
  equal(ledger(), [])
})

test('a part sent from a state its bytes before it do not leave breaks the chain', async () => {
  let { up, send } = await setup(file)
  await up.post(file.length)
  let other = file.map((b) => b ^ 1)
  for (let n of all) await send(n, n == 2 ? other : file)
  await assertRejects(() => up.post(file.length), Wrong)
})

test('a part of the wrong size, or past the last, is refused', async () => {
  let { up } = await setup(file)
  await up.post(file.length)
  let body = (n: number) => new Response(new Uint8Array(n)).body!
  await assertRejects(() => up.put(1, body(63), 63), Wrong)
  await assertRejects(() => up.put(3, body(64), 64), Wrong)
  await assertRejects(() => up.put(4, body(22), 22), Wrong)
})

test('an upload the bucket forgot begins again', async () => {
  let { up, send, multipart, key, begun } = await setup(file)
  await up.post(file.length)
  await send(1)
  await multipart.resumeMultipartUpload(key, begun[0]).abort()
  await assertRejects(() => send(2), Gone)
  equal((await up.post(file.length)).need, all)
  for (let n of all) await send(n)
  equal((await up.post(file.length)).whole?.bytes, 150)
})
