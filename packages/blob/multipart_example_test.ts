import { equal, test } from '@yaks/testing'
import { type Bucket, bucketObjects, fold, START } from '@yaks/blob'
import { memoryMultipart, parts } from '@yaks/blob'

// One chunk is enough for these tiny parts; no HTTP response is needed.
let stream = (bytes: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
// Fresh independent bucket state for each protocol transition.
let fixture = () => {
  let held = new Map<string, Uint8Array>()
  let now = <T>(v: T) => Promise.resolve(v)
  let bucket: Bucket = {
    head: (k) =>
      now(held.has(k) ? { size: held.get(k)!.length, etag: '' } : null),
    get: (k) => {
      let b = held.get(k)
      return now(
        b
          ? {
            etag: '',
            body: stream(b),
            arrayBuffer: () => now(b.slice().buffer),
          }
          : null,
      )
    },
    put: (k, v) => now(void held.set(k, v as Uint8Array)),
    delete: (ks) => now([ks].flat().forEach((k) => held.delete(k))),
    list: ({ prefix }) =>
      now({
        truncated: false,
        objects: [...held].filter(([k]) => k.startsWith(prefix))
          .map(([key, b]) => ({ key, size: b.length, uploaded: new Date(0) })),
      }),
  }
  let file = new Uint8Array(150).fill(7)
  let sha = fold(START, file, file.length)
  let objects = bucketObjects(bucket)
  let multipart = memoryMultipart(bucket.put)
  let at = {
    key: sha,
    sha,
    ledger: 'uploads/',
    part: 64,
  }
  let up = parts(objects, multipart, at)
  let send = (n: number) => {
    let bytes = file.slice((n - 1) * 64, n * 64)
    let from = fold(START, file.slice(0, (n - 1) * 64))
    return up.put(n, stream(bytes), bytes.length, from)
  }
  return {
    file,
    sha,
    objects,
    held,
    send,
    get up() {
      return up
    },
    reopen: () => up = parts(objects, multipart, at),
  }
}
let first = fixture()
let interrupted = fixture()
await interrupted.up.post(150)
let finishing = fixture()
await finishing.up.post(150)
await finishing.send(3)
finishing.reopen()

test('the bucket example initially asks for all three parts', async () => {
  equal((await first.up.post(150)).need, [1, 2, 3])
})

test('the bucket example reopens its ledger after the third part lands', async () => {
  await interrupted.send(3)
  interrupted.reopen()
  equal((await interrupted.up.post(150)).need, [1, 2])
})

test('the bucket example sends missing parts and leaves exact bytes without a ledger', async () => {
  let { send, up, objects, sha, held, file } = finishing
  await Promise.all([send(1), send(2)])
  equal(await up.post(150), {
    part: 64,
    need: [],
    whole: { bytes: 150, head: file, made: true },
  })
  equal(await objects.list('uploads/'), [])
  equal(await objects.list(''), [sha])
  equal(held.get(sha), file)
})
