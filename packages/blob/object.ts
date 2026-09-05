// The backend that is a bucket: one object per address, in an S3-shaped object
// store. It is the backend for content that outgrows the database — images,
// attachments, anything measured in megabytes — and for a deployment where the
// database is small and the content is not.
//
// The bucket arrives as an argument and its type is STRUCTURAL: the three
// methods this package calls, and nothing else. Cloudflare's `R2Bucket`
// satisfies it as it stands (conform.ts holds that against the runtime's own
// types), and so does any wrapper offering the same three — which is why this
// package depends on no cloud SDK and still runs in one.
//
// The object's key is its address, so a write is idempotent and a stored object
// can never be the wrong one for its key. Nothing here needs a lifecycle rule,
// a version, or a content type: the bytes are the whole story.

import type { Blobs } from './store.ts'

/**
 * The bucket this backend speaks to: three methods, keyed by string. Cloudflare
 * R2's `R2Bucket` is one of these; so is any object store wrapped to match.
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
export let objectBlobs = (bucket: Bucket, prefix = ''): Blobs => ({
  has: async (sha) => (await bucket.head(prefix + sha)) != null,
  get: async (sha) => {
    let found = await bucket.get(prefix + sha)
    return found ? new Uint8Array(await found.arrayBuffer()) : undefined
  },
  put: async (sha, bytes) => {
    await bucket.put(prefix + sha, bytes)
  },
})
