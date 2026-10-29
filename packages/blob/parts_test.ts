import { fixed } from './fixed.ts'
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

// These doors pass bytes, not HTTP metadata.
let stream = (bytes: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })

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
        body: stream(part),
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
  let open = () =>
    parts(
      objects,
      multipart,
      { key, sha, ledger: 'ledger/', part: 64 },
      () => Promise.resolve(),
    )
  let up = open()
  let reopen = () => up = open()
  // Part n as a sender sends it: its bytes, and the hash state the bytes
  // before it leave.
  let send = (n: number, bytes = file) => {
    let part = bytes.slice((n - 1) * 64, n * 64)
    let from = fold(START, bytes.slice(0, (n - 1) * 64))
    return up.put(n, stream(part), part.length, from)
  }
  let ledger = () => [...held.keys()].filter((k) => k.startsWith('ledger/'))
  return { up, reopen, send, held, key, ledger, multipart, begun, bucket }
}

let file = new Uint8Array(150).map((_, i) => (i * 7) & 0xff)
let all = [1, 2, 3]

let starting = await setup(file)
let interrupted = async () => {
  let upload = await setup(file)
  await upload.up.post(file.length)
  await upload.send(1)
  await upload.send(3)
  upload.up = upload.reopen()
  return upload
}
let resuming = await interrupted()
let completing = await interrupted()
await completing.up.post(file.length)
await completing.send(2)

test('a new upload asks for every part', async () => {
  equal(await starting.up.post(file.length), { part: 64, need: all })
})

test('an interrupted upload sends only the parts it lacks', async () => {
  equal(await resuming.up.post(file.length), { part: 64, need: [2] })
})

test('sending the missing part completes the upload and clears its ledger', async () => {
  let { up, held, key, ledger } = completing
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

let r2Failure = new Error(
  'complete: We encountered an internal error. Please try again. (10001)',
)
let completingAfter = async (lostAck = false, lasting = false) => {
  let fixture = await setup(file)
  await fixture.up.post(file.length)
  for (let n of all) await fixture.send(n)
  let calls = 0
  let resume = fixture.multipart.resumeMultipartUpload
  fixture.multipart.resumeMultipartUpload = (key, id) => {
    let upload = resume(key, id)
    return {
      ...upload,
      complete: async (parts) => {
        calls++
        if (calls == 1 || lasting) {
          if (lostAck) await upload.complete(parts)
          throw r2Failure
        }
        return upload.complete(parts)
      },
    }
  }
  return { ...fixture, calls: () => calls }
}
let retriedCompletion = await completingAfter()
let acknowledgedCompletion = await completingAfter(true)
let unavailableCompletion = await completingAfter(false, true)

for (
  let [name, fixture, attempts] of [
    ['a failed completion', retriedCompletion, 2],
    ['a completion whose acknowledgment failed', acknowledgedCompletion, 1],
  ] as const
) {
  test(`${name} keeps the assembled bytes and clears the ledger`, async () => {
    equal((await fixture.up.post(file.length)).whole?.bytes, file.length)
    equal(fixture.held.get(fixture.key), file)
    equal(fixture.ledger(), [])
    equal(fixture.calls(), attempts)
  })
}

test('a lasting R2 failure keeps uploaded parts for a later completion', async () => {
  let fixture = unavailableCompletion
  await assertRejects(
    () => fixture.up.post(file.length),
    Error,
    r2Failure.message,
  )
  equal(fixture.calls(), 5)
  equal(fixture.ledger().length, 4)
})

let abortingAfter = await (async () => {
  let fixture = await setup(file, 'f'.repeat(64))
  await fixture.up.post(file.length)
  for (let n of all) await fixture.send(n)
  let calls = 0
  let resume = fixture.multipart.resumeMultipartUpload
  fixture.multipart.resumeMultipartUpload = (key, id) => ({
    ...resume(key, id),
    abort: async () => {
      if (++calls == 1) {
        await resume(key, id).abort()
        throw new Error(
          'abort: We encountered an internal error. Please try again. (10001)',
        )
      }
      throw new Error(
        'abort: The specified multipart upload does not exist. (10024)',
      )
    },
  })
  return { ...fixture, calls: () => calls }
})()

test('an abort whose acknowledgment failed accepts the binding saying already absent', async () => {
  let fixture = abortingAfter
  await assertRejects(() => fixture.up.post(file.length), Wrong)
  equal(fixture.calls(), 2)
  equal(fixture.ledger(), [])
})

let completionDefect = await (async () => {
  let fixture = await setup(file)
  await fixture.up.post(file.length)
  for (let n of all) await fixture.send(n)
  let error = new TypeError('completion adapter broke')
  void error.stack
  let calls = 0, reconciled = 0
  let head = fixture.bucket.head
  fixture.bucket.head = (key) => {
    if (calls) {
      reconciled++
      return Promise.reject(r2Failure)
    }
    return head(key)
  }
  let resume = fixture.multipart.resumeMultipartUpload
  fixture.multipart.resumeMultipartUpload = (key, id) => ({
    ...resume(key, id),
    complete: () => (calls++, Promise.reject(error)),
  })
  return { ...fixture, error, counts: () => [calls, reconciled] }
})()

test('an unrelated completion defect escapes immediately without reconciliation or losing parts', async () => {
  let fixture = completionDefect
  let got = await assertRejects(() => fixture.up.post(file.length), TypeError)
  equal(got === fixture.error, true)
  equal(fixture.counts(), [1, 0])
  equal(fixture.ledger().length, 4)
})

let rejectedPart = await (async () => {
  let fixture = await setup(file)
  await fixture.up.post(file.length)
  let resume = fixture.multipart.resumeMultipartUpload
  let error = new TypeError('part adapter rejected before reading')
  void error.stack
  fixture.multipart.resumeMultipartUpload = (key, id) => ({
    ...resume(key, id),
    uploadPart: () => Promise.reject(error),
  })
  let cancelled = false
  let incoming = new ReadableStream<Uint8Array>({
    start: (controller) => controller.enqueue(file.slice(0, 16)),
    cancel: () => {
      cancelled = true
    },
  })
  return { ...fixture, incoming, error, cancelled: () => cancelled }
})()

test('a part rejected before its body is consumed cancels both tee branches and preserves the cause', async () => {
  let fixture = rejectedPart
  let got = await assertRejects(
    () => fixture.up.put(1, fixture.incoming, 64),
    TypeError,
  )
  equal(got === fixture.error, true)
  equal(fixture.cancelled(), true)
  equal(fixture.ledger().length, 1)
})

test('fixed-length upload cleanup stops both owned branches before its output is consumed', async () => {
  let cancelled = false
  let incoming = new ReadableStream<Uint8Array>({
    start: (controller) => controller.enqueue(new Uint8Array(16)),
    cancel: () => {
      cancelled = true
    },
  })
  let [kept, hashed] = incoming.tee()
  let hash = hashed.getReader()
  let upload = fixed(
    kept,
    64,
    () => new TransformStream<Uint8Array, Uint8Array>(),
  )
  await Promise.all([hash.cancel(), upload.cancel()])
  equal(cancelled, true)
})
