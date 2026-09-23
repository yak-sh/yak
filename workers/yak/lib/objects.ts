// The platform's bucket, as the kernel reaches it: @yaks/blob's store keyed by
// name over the `BLOBS` binding, with every trip counted on the request's
// tally (hops.ts), which the request reports as `r2;dur=<n>`.
import { type Bucket, bucketObjects, type Objects } from '@yaks/blob'
import { hop, type Tally } from './hops.ts'

/**
 * The same store, with every verb counted as one round trip on the request's
 * tally: a deploy spends most of its time in the bucket, and how many times it
 * went there is what says whether a slow one is a slow bucket or one file too
 * many asked about one at a time.
 *
 * It wraps the contract rather than the bucket so the counting is the same
 * counting a test sees against an in-memory store (versions_test.ts): one
 * call is one trip either way, paging inside `uploaded` included, because a
 * caller pays for the call it made.
 *
 * `tally` is for a caller holding the map: a test counts what a deploy costs
 * with no request around it. The platform leaves it out and the request's own
 * is used.
 */
export let counted = (objects: Objects, tally?: Tally): Objects => {
  let trip = (verb: string) => hop(`r2.${verb}`, 1, tally)
  return {
    has: (key) => {
      trip('has')
      return objects.has(key)
    },
    put: (key, bytes) => {
      trip('put')
      return objects.put(key, bytes)
    },
    read: (key) => {
      trip('read')
      return objects.read(key)
    },
    get: (key) => {
      trip('get')
      return objects.get(key)
    },
    delete: (key) => {
      trip('delete')
      return objects.delete(key)
    },
    list: (prefix) => {
      trip('list')
      return objects.list(prefix)
    },
    uploaded: (prefix) => {
      trip('list')
      return objects.uploaded(prefix)
    },
  }
}

/** The bucket, keyed by name and counted. */
export let r2Objects = (bucket: Bucket): Objects =>
  counted(bucketObjects(bucket))
