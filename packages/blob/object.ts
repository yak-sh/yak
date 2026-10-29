// The byte store that is a bucket: one object per address, in an S3-shaped
// object store. It is the store for content that outgrows the database —
// images, attachments, anything measured in megabytes — and for a deployment
// where the database is small and the content is not.
//
// The bucket is passed in as an argument and its type is structural: the
// methods this package calls, and nothing else. Cloudflare's `R2Bucket`
// satisfies it as it stands (conform.ts type-checks that against the runtime's
// own types), and so does any wrapper offering the same — which is why this
// package depends on no cloud SDK and still runs inside one.
//
// Two stores are built on it. `objectBlobs` is content-addressed: the object's
// key is its address, so a write is idempotent and a stored object can never
// be the wrong one for its key, and it needs only `head`, `get` and `put`.
// `bucketObjects` is keyed by name, the way a host keeps an app's files: the
// caller chooses the key, and it also deletes and lists, since files are
// replaced and swept where content-addressed bytes are not.

import { sleep } from '@yaks/fp'
import type { Blobs } from './store.ts'

/**
 * The bucket these stores call, keyed by string. Cloudflare R2's `R2Bucket` is
 * one of these; so is any object store wrapped to match.
 */
export type Bucket = {
  /** whether an object exists under this key (its metadata, or null) */
  head: (key: string) => Promise<{ size: number; etag: string } | null>
  /** the object under this key, or null */
  get: (
    key: string,
    options?: { range: { offset: number; length: number } },
  ) => Promise<
    {
      etag: string
      body: ReadableStream<Uint8Array>
      arrayBuffer: () => Promise<ArrayBuffer>
    } | null
  >
  /** write an object under this key */
  put: (
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | ReadableStream<Uint8Array>,
  ) => Promise<unknown>
  /** remove the object under this key, or under each of these keys: at most
   * {@link DELETES} of them in one call */
  delete: (keys: string | string[]) => Promise<unknown>
  /** one page of the objects whose keys start with `prefix`, each with the
   * moment it landed and its size in bytes; `cursor` continues a truncated
   * page */
  list: (opts: { prefix: string; cursor?: string }) => Promise<{
    objects: { key: string; uploaded: Date; size: number }[]
    truncated: boolean
    cursor?: string
  }>
}

/** The most keys one bucket delete takes: R2's own limit. */
export let DELETES = 1000

// R2's answers that say "not now" rather than "no", each of which its error
// codes page says to retry: an internal error (10001), the service unavailable
// (10043), and too many requests at once for one key or prefix (10058).
let BUSY = [10001, 10043, 10058]

/** R2's code, whether carried as a property or in the Workers binding's message. */
export let bucketCode = (e: unknown): number | undefined => {
  let { code, message } = Object(e)
  if (code != null && Number.isFinite(Number(code))) return Number(code)
  let match = typeof message == 'string' ? /\((\d+)\)\s*$/.exec(message) : null
  return match ? Number(match[1]) : undefined
}

/** Whether the bucket failed on its own side, including the Workers binding
 * which carries R2's code in its message rather than on the Error. */
export let busy = (e: unknown): boolean => {
  let { status, statusCode, message } = Object(e)
  let http = Number(status ?? statusCode)
  return BUSY.includes(bucketCode(e) ?? 0) ||
    http >= 500 && http < 600 ||
    typeof message == 'string' &&
      /\b(?:HTTP|status(?: code)?)[: =]+5\d\d\b/i.test(message)
}

/** A bucket that kept failing on its own side through every attempt. */
export class BucketUnavailable extends Error {
  override name = 'BucketUnavailable'
  constructor(cause: unknown) {
    super(
      typeof Object(cause).message == 'string'
        ? Object(cause).message
        : String(cause),
      { cause },
    )
  }
}

/**
 * A bucket call, sent again while the bucket answers that it is busy: a burst
 * of uploads to one space is enough for R2 to refuse some of them. Each wait
 * doubles from `wait` milliseconds, jittered so calls that collided once do not
 * collide again, and after `tries` throws {@link BucketUnavailable} with the
 * last answer as its cause. Other failures are thrown at once. `pause` spends each wait, a timer unless the
 * caller brings its own. Every call the stores below make to a bucket goes
 * through it; a stream is read once, so a caller putting one cannot.
 *
 * ```ts
 * import { patient } from '@yaks/blob'
 * import { equal } from '@yaks/testing'
 *
 * let calls = 0, waits: number[] = []
 * let list = () =>
 *   ++calls < 3 ? Promise.reject({ code: 10058 }) : Promise.resolve(['a/x'])
 * let pause = (ms: number) => Promise.resolve(void waits.push(ms))
 * equal(await patient(list, 5, 100, pause), ['a/x'])
 * equal(waits.length, 2)
 * ```
 */
export let patient = async <T>(
  call: () => Promise<T>,
  tries = 5,
  wait = 100,
  pause: (ms: number) => Promise<void> = sleep,
): Promise<T> => {
  for (let i = 1;; i++) {
    try {
      return await call()
    } catch (e) {
      if (!busy(e)) throw e
      if (i >= tries) throw new BucketUnavailable(e)
      await pause(wait * 2 ** (i - 1) * (0.5 + Math.random()))
    }
  }
}

/** A stored object's length and validator, with its body read on demand. */
export type Opened = {
  size: number
  version: string
  read: (
    range?: { from: number; to: number },
  ) => Promise<ReadableStream<Uint8Array>>
}

export type Loaded = { bytes: Uint8Array<ArrayBuffer>; version: string }

type Pause = (ms: number) => Promise<void>

// Consume a buffered read inside the retry: an R2 body can fail after GET
// has answered, and sending GET again gives that read a fresh body.
let load = (bucket: Pick<Bucket, 'get'>, key: string, pause: Pause) =>
  patient(
    async (): Promise<Loaded | null> => {
      let object = await bucket.get(key)
      return object
        ? {
          bytes: new Uint8Array(await object.arrayBuffer()),
          version: object.etag.replace(/^"|"$/g, ''),
        }
        : null
    },
    5,
    100,
    pause,
  )

// A stream can fail after GET answered. Resume at the first byte not yet
// delivered, and require the same validator so two versions never mix. Read
// its first chunk before answering, while a failure can still become HTTP 500.
let reading = async (
  bucket: Pick<Bucket, 'get'>,
  key: string,
  head: { size: number; etag: string },
  range: { from: number; to: number } | undefined,
  pause: Pause,
) => {
  let offset = range?.from ?? 0, end = range?.to ?? head.size - 1
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let next = () =>
    patient(
      async () => {
        try {
          if (!reader) {
            let object = await bucket.get(
              key,
              range || offset
                ? { range: { offset, length: end - offset + 1 } }
                : undefined,
            )
            if (!object) throw new Error(`no object at ${key}`)
            if (object.etag != head.etag) {
              await object.body.cancel().catch(() => {})
              throw new Error(`object at ${key} changed while reading`)
            }
            reader = object.body.getReader()
          }
          return await reader.read()
        } catch (error) {
          await reader?.cancel().catch(() => {})
          reader = undefined
          throw error
        }
      },
      5,
      100,
      pause,
    )
  let first = await next()
  let send = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    chunk: ReadableStreamReadResult<Uint8Array>,
  ) => {
    if (chunk.done) return controller.close()
    offset += chunk.value.byteLength
    controller.enqueue(chunk.value)
    if (offset > end) {
      controller.close()
      void reader?.cancel().catch(() => {})
    }
  }
  return new ReadableStream<Uint8Array>({
    start: (controller) => send(controller, first),
    pull: async (controller) => send(controller, await next()),
    cancel: (reason) => reader?.cancel(reason),
  })
}

let open = async (
  bucket: Pick<Bucket, 'head' | 'get'>,
  key: string,
  pause: Pause,
) => {
  let head = await patient(() => bucket.head(key), 5, 100, pause)
  if (!head) return null
  return {
    size: head.size,
    version: head.etag.replace(/^"|"$/g, ''),
    read: (range?: { from: number; to: number }) =>
      reading(bucket, key, head, range, pause),
  }
}

/**
 * A {@link Blobs} over an object store. `prefix` namespaces the keys, for a
 * bucket that holds more than these objects.
 *
 * ```ts
 * import { objectBlobs } from '@yaks/blob'
 *
 * // in a Worker, where `env.BLOBS` is an R2 binding
 * // let store = objectBlobs(env.BLOBS, 'bodies/')
 * ```
 *
 * Asynchronous, so a graph writing through it applies asynchronously.
 */
export let objectBlobs = (
  bucket: Pick<Bucket, 'head' | 'get' | 'put'>,
  prefix = '',
  pause: Pause = sleep,
): Blobs => ({
  has: async (sha) =>
    (await patient(() => bucket.head(prefix + sha), 5, 100, pause)) != null,
  get: async (sha) => {
    let found = await load(bucket, prefix + sha, pause)
    return found?.bytes
  },
  open: (sha) => open(bucket, prefix + sha, pause),
  put: async (sha, bytes) => {
    await patient(() => bucket.put(prefix + sha, bytes), 5, 100, pause)
  },
})

/**
 * A byte store keyed by name: the caller chooses each key, where {@link Blobs}
 * derives it from the bytes. It is how a host keeps files that are replaced
 * and swept, an app's pages among them.
 */
export type Objects = {
  /** whether an object is stored under this key */
  has(key: string): Promise<boolean>
  /** store these bytes under this key, replacing what was there */
  put(key: string, bytes: Uint8Array): Promise<void>
  /** the bytes under this key, or null; a miss is one round trip, like a hit,
   * where `has` then `get` is two */
  read(key: string): Promise<Uint8Array<ArrayBuffer> | null>
  /** bytes and their validator in the same object-store read */
  load(key: string): Promise<Loaded | null>
  /** the bytes under a key the caller knows is there; a miss throws */
  get(key: string): Promise<Uint8Array<ArrayBuffer>>
  /** length and validator first, then stream only the bytes the caller needs */
  open(key: string): Promise<Opened | null>
  /** remove the object under this key, or under each of these keys in as few
   * round trips as the bucket allows: a sweep of a thousand objects is one
   * call, not a thousand */
  delete(keys: string | string[]): Promise<void>
  /** every key under a prefix, sorted */
  list(prefix: string): Promise<string[]>
  /** the same keys, each with the moment it landed in epoch milliseconds: a
   * sweep must not delete bytes written a minute ago for a row that has not
   * landed yet */
  uploaded(prefix: string): Promise<Record<string, number>>
}

// One walk of the prefix, every page of it, as key to when the object landed.
// `list` is this with the times dropped, so the two answers can never disagree
// about what is in the bucket.
let walk = async (bucket: Bucket, prefix: string, pause: Pause) => {
  let at: Record<string, number> = {}
  let cursor: string | undefined
  do {
    let page = await patient(
      () => bucket.list({ prefix, cursor }),
      5,
      100,
      pause,
    )
    for (let o of page.objects) at[o.key] = o.uploaded.getTime()
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return at
}

/**
 * An {@link Objects} over a bucket, key for key.
 *
 * ```ts
 * import { bucketObjects } from '@yaks/blob'
 *
 * // in a Worker, where `env.BLOBS` is an R2 binding
 * // let files = bucketObjects(env.BLOBS)
 * ```
 */
export let bucketObjects = (bucket: Bucket, pause: Pause = sleep): Objects => ({
  has: async (key) =>
    (await patient(() => bucket.head(key), 5, 100, pause)) != null,
  put: async (key, bytes) => {
    await patient(() => bucket.put(key, bytes), 5, 100, pause)
  },
  read: async (key) => (await load(bucket, key, pause))?.bytes ?? null,
  load: (key) => load(bucket, key, pause),
  get: async (key) => {
    let object = await load(bucket, key, pause)
    if (!object) throw new Error(`no object at ${key}`)
    return object.bytes
  },
  open: (key) => open(bucket, key, pause),
  delete: async (keys) => {
    if (typeof keys == 'string') {
      return void await patient(() => bucket.delete(keys), 5, 100, pause)
    }
    for (let at = 0; at < keys.length; at += DELETES) {
      await patient(
        () => bucket.delete(keys.slice(at, at + DELETES)),
        5,
        100,
        pause,
      )
    }
  },
  list: async (prefix) => Object.keys(await walk(bucket, prefix, pause)).sort(),
  uploaded: (prefix) => walk(bucket, prefix, pause),
})
