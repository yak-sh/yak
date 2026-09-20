// The byte-store contract is independent of its adapters. R2 and a local
// directory both satisfy it, so a Worker's type graph must be able to name
// these methods without importing the Deno filesystem implementation.
import { hop, type Tally } from '../hops.ts'

export interface Blobs {
  has(key: string): Promise<boolean>
  put(key: string, bytes: Uint8Array): Promise<void>
  // A miss is one round trip, like a hit; `has` followed by `get` is two.
  read(key: string): Promise<Uint8Array<ArrayBuffer> | null>
  // For a caller that knows the key is there, a miss is an error.
  get(key: string): Promise<Uint8Array<ArrayBuffer>>
  delete(key: string): Promise<void>
  list(prefix: string): Promise<string[]>
  // The same listing with each object's age: key to the moment it landed, in
  // epoch milliseconds. A retention sweep needs it (versions.ts `pruned`) —
  // bytes written a minute ago may be a deploy whose row has not landed yet,
  // and deleting those would take a version's files out from under it.
  uploaded(prefix: string): Promise<Record<string, number>>
}

/**
 * The same store, with every verb counted as one round trip on the request's
 * tally (hops.ts): a deploy spends most of its time in the bucket, and how
 * many times it went there is what says whether a slow one is a slow bucket
 * or one file too many asked about one at a time.
 *
 * It wraps the CONTRACT rather than the R2 adapter so the counting is the same
 * counting a test sees against an in-memory store (versions_test.ts) — one
 * seam call is one trip either way, paging inside `uploaded` included, because
 * a caller pays for the call it made.
 *
 * `tally` is for a caller holding the map: a test counts what a deploy costs
 * with no request around it. The platform leaves it out and the request's own
 * is used.
 */
export let counted = (blobs: Blobs, tally?: Tally): Blobs => {
  let trip = (verb: string) => hop(`r2.${verb}`, 1, tally)
  return {
    has: (key) => {
      trip('has')
      return blobs.has(key)
    },
    put: (key, bytes) => {
      trip('put')
      return blobs.put(key, bytes)
    },
    read: (key) => {
      trip('read')
      return blobs.read(key)
    },
    get: (key) => {
      trip('get')
      return blobs.get(key)
    },
    delete: (key) => {
      trip('delete')
      return blobs.delete(key)
    },
    list: (prefix) => {
      trip('list')
      return blobs.list(prefix)
    },
    uploaded: (prefix) => {
      trip('list')
      return blobs.uploaded(prefix)
    },
  }
}
