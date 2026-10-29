import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { decode, encode } from './store.ts'
import {
  type Bucket,
  bucketObjects,
  BucketUnavailable,
  objectBlobs,
  patient,
} from './object.ts'

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
    head: (key) => {
      let bytes = held.get(key)
      return Promise.resolve(
        bytes
          ? { size: bytes.byteLength, etag: String(bytes.byteLength) }
          : null,
      )
    },
    get: (key, options) => {
      let bytes = held.get(key)
      let at = options?.range.offset ?? 0
      let end = at + (options?.range.length ?? bytes?.byteLength ?? 0)
      let part = bytes?.slice(at, end)
      return Promise.resolve(
        part
          ? {
            etag: String(bytes!.byteLength),
            body: new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(part)
                controller.close()
              },
            }),
            arrayBuffer: () => Promise.resolve(part.buffer as ArrayBuffer),
          }
          : null,
      )
    },
    put: (key, value) => {
      held.set(key, new Uint8Array(value as ArrayBuffer))
      return Promise.resolve(null)
    },
    delete: (keys) => {
      for (let key of [keys].flat()) held.delete(key)
      return Promise.resolve()
    },
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

test('the object backend stores and reads by address', async () => {
  let bucket = fake()
  let store = objectBlobs(bucket)
  assertEquals(await store.has('abc'), false)
  assertEquals(await store.get('abc'), undefined)
  await store.put('abc', encode('a long essay'))
  assertEquals(await store.has('abc'), true)
  assertEquals(decode((await store.get('abc')) as Uint8Array), 'a long essay')
})

test('a prefix namespaces the keys without changing the address', async () => {
  let bucket = fake()
  let store = objectBlobs(bucket, 'bodies/')
  await store.put('abc', encode('hello'))
  assertEquals(bucket.keys(), ['bodies/abc'])
  assertEquals(decode((await store.get('abc')) as Uint8Array), 'hello')
})

test('an object-store read fetches only the requested byte span', async () => {
  let bucket = fake()
  let calls: { offset: number; length: number }[] = []
  let get = bucket.get
  bucket.get = (key, options) => {
    if (options) calls.push(options.range)
    return get(key, options)
  }
  let store = objectBlobs(bucket)
  await store.put('abc', encode('a long essay'))
  let object = await store.open?.('abc')
  assertEquals(object?.size, 12)
  assertEquals(
    await new Response(await object!.read({ from: 2, to: 5 })).text(),
    'long',
  )
  assertEquals(calls, [{ offset: 2, length: 4 }])
})

test('a store keyed by name reads, deletes and lists every page', async () => {
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
  await files.delete(['a/x', 'a/zz'])
  assertEquals(await files.list('a/'), [])
})

test('a store keyed by name deletes a thousand keys in one call', async () => {
  // The keys '0' to '2000': more than two calls' worth.
  let keys = Object.keys(Array(2001).fill(0)), calls: string[][] = []
  let bucket = fake()
  bucket.delete = (batch) => Promise.resolve(void calls.push(batch as string[]))
  await bucketObjects(bucket).delete(keys)
  assertEquals(calls.map((call) => [call[0], call.at(-1), call.length]), [
    ['0', '999', 1000],
    ['1000', '1999', 1000],
    ['2000', '2000', 1],
  ])
})

test('a busy bucket is asked again, and only while busy', async () => {
  let waits: number[] = []
  let asked = (answers: unknown[]) => {
    let n = 0
    let call = () =>
      n < answers.length ? Promise.reject(answers[n++]) : Promise.resolve(n)
    return () =>
      patient(call, 3, 100, (ms) => Promise.resolve(void waits.push(ms)))
  }
  assertEquals(await asked([{ code: 10058 }, { code: 10001 }])(), 2)
  // Each wait doubles from `wait`, jittered by up to half either way.
  let scaled = waits.map((ms, i) => ms / 100 / 2 ** i)
  assertEquals(scaled.map((x) => x >= 0.5 && x < 1.5), [true, true])
  await assertRejects(
    asked([{ code: 10058 }, { code: 10058 }, 'third']),
    'third',
  )
  let wrong = Object.assign(Error('list: no such bucket'), { code: 10006 })
  await assertRejects(asked([wrong, { code: 10058 }]), Error, 'no such bucket')
})

let internal = new Error(
  'head: We encountered an internal error. Please try again. (10001)',
)
let immediate = () => Promise.resolve()

for (
  let [name, error] of [
    ['the binding message', internal],
    ['an HTTP status', Object.assign(new Error('R2 down'), { status: 503 })],
    ['a statusCode', { statusCode: 500 }],
    ['an HTTP message', new Error('get: HTTP 502')],
  ] as const
) {
  test(`a bucket retries ${name} and throws the original cause if it stays down`, async () => {
    let calls = 0
    let call = () => {
      calls++
      return Promise.reject(error)
    }
    let got = await patient(call, 3, 100, immediate).catch((e) => e)
    assertEquals([calls, got instanceof BucketUnavailable, got.cause], [
      3,
      true,
      error,
    ])
  })
}

test('bucket HEAD and range GET recover without changing the requested bytes', async () => {
  let bucket = fake()
  let head = bucket.head, get = bucket.get
  let heads = 0, gets = 0
  bucket.head = (key) => ++heads == 1 ? Promise.reject(internal) : head(key)
  bucket.get = (key, opts) =>
    ++gets == 1 ? Promise.reject(internal) : get(key, opts)
  let store = objectBlobs(bucket, '', immediate)
  await store.put('abc', encode('a long essay'))
  let object = await store.open!('abc')
  assertEquals(
    await new Response(await object!.read({ from: 2, to: 5 })).text(),
    'long',
  )
  assertEquals([heads, gets], [2, 2])
})

test('buffered bucket reads retry a body that failed after GET answered', async () => {
  let bucket = fake()
  let get = bucket.get, gets = 0
  await bucket.put('abc', encode('saved'))
  bucket.get = async (key, options) => {
    let object = (await get(key, options))!
    return ++gets == 1
      ? { ...object, arrayBuffer: () => Promise.reject(internal) }
      : object
  }
  assertEquals(
    decode((await bucketObjects(bucket, immediate).read('abc'))!),
    'saved',
  )
  assertEquals(gets, 2)
})

test('a buffered PUT whose acknowledgment failed can safely be sent twice', async () => {
  let bucket = fake()
  let put = bucket.put, puts = 0
  bucket.put = async (key, bytes) => {
    await put(key, bytes)
    if (++puts == 1) throw internal
  }
  let objects = bucketObjects(bucket, immediate)
  await objects.put('abc', encode('saved'))
  assertEquals([puts, decode(await objects.get('abc'))], [2, 'saved'])
})

test('a bucket permission failure is thrown without waiting or resending', async () => {
  let wrong = Object.assign(new Error('head: forbidden (10006)'), {
    status: 403,
  })
  let calls = 0, waits = 0
  let got = await patient(
    () => (calls++, Promise.reject(wrong)),
    5,
    100,
    () => (waits++, Promise.resolve()),
  ).catch((e) => e)
  assertEquals([calls, waits, got], [1, 0, wrong])
})

test('a resumed stream refuses bytes from a different object version', async () => {
  let bucket = fake(), gets = 0
  let get = bucket.get
  await bucket.put('abc', encode('saved'))
  bucket.get = async (key, opts) => {
    let object = (await get(key, opts))!
    if (++gets > 1) {
      return {
        ...object,
        etag: 'another version',
        body: new ReadableStream<Uint8Array>({
          start: (c) => c.enqueue(encode('ved')),
          cancel: () => Promise.reject(internal),
        }),
      }
    }
    let first = true
    return {
      ...object,
      body: new ReadableStream<Uint8Array>({
        pull: (controller) => {
          if (first) {
            first = false
            controller.enqueue(encode('sa'))
          } else controller.error(internal)
        },
      }),
    }
  }
  let opened = await bucketObjects(bucket, immediate).open('abc')
  await assertRejects(
    async () => new Response(await opened!.read()).text(),
    Error,
    'changed while reading',
  )
  assertEquals(gets, 2)
})
