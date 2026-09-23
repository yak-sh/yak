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

import type { Blobs } from './store.ts'

/**
 * The bucket these stores call, keyed by string. Cloudflare R2's `R2Bucket` is
 * one of these; so is any object store wrapped to match.
 */
export type Bucket = {
  /** whether an object exists under this key (its metadata, or null) */
  head: (key: string) => Promise<unknown>
  /** the object under this key, or null */
  get: (
    key: string,
  ) => Promise<{ arrayBuffer: () => Promise<ArrayBuffer> } | null>
  /** write an object under this key */
  put: (
    key: string,
    value: ArrayBuffer | ArrayBufferView | string,
  ) => Promise<unknown>
  /** remove the object under this key */
  delete: (key: string) => Promise<unknown>
  /** one page of the objects whose keys start with `prefix`, each with the
   * moment it landed and its size in bytes; `cursor` continues a truncated
   * page */
  list: (opts: { prefix: string; cursor?: string }) => Promise<{
    objects: { key: string; uploaded: Date; size: number }[]
    truncated: boolean
    cursor?: string
  }>
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
): Blobs => ({
  has: async (sha) => (await bucket.head(prefix + sha)) != null,
  get: async (sha) => {
    let found = await bucket.get(prefix + sha)
    return found ? new Uint8Array(await found.arrayBuffer()) : undefined
  },
  put: async (sha, bytes) => {
    await bucket.put(prefix + sha, bytes)
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
  /** the bytes under a key the caller knows is there; a miss throws */
  get(key: string): Promise<Uint8Array<ArrayBuffer>>
  /** remove the object under this key */
  delete(key: string): Promise<void>
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
let walk = async (bucket: Bucket, prefix: string) => {
  let at: Record<string, number> = {}
  let cursor: string | undefined
  do {
    let page = await bucket.list({ prefix, cursor })
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
export let bucketObjects = (bucket: Bucket): Objects => ({
  has: async (key) => (await bucket.head(key)) != null,
  put: async (key, bytes) => {
    await bucket.put(key, bytes)
  },
  read: async (key) => {
    let object = await bucket.get(key)
    return object ? new Uint8Array(await object.arrayBuffer()) : null
  },
  get: async (key) => {
    let object = await bucket.get(key)
    if (!object) throw new Error(`no object at ${key}`)
    return new Uint8Array(await object.arrayBuffer())
  },
  delete: async (key) => {
    await bucket.delete(key)
  },
  list: async (prefix) => Object.keys(await walk(bucket, prefix)).sort(),
  uploaded: (prefix) => walk(bucket, prefix),
})
