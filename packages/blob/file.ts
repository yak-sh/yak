// The byte store that is a directory: one file per object, named by its
// address. It is the oldest form of content-addressed storage there is, and it
// is the right one for large or binary content — nothing reads it but this
// package, and a filesystem is very good at handing back a big file.
//
// The filesystem boundary loads only when a caller uses this store, so the
// module can load with the other byte stores on runtimes without files.
//
// No part of the name comes from a caller: the file is named by the address,
// which this package computes, so no path can escape the directory.

import type { Blobs } from './store.ts'

// Loaded only when a caller chooses a filesystem-backed store.
let fs = async () => {
  let { mkdir, readFile, writeFile } = await import('@yaks/file/io')
  return { mkdir, read: readFile, write: writeFile }
}

/**
 * A {@link Blobs} over a directory: `<dir>/<sha>` holds the bytes stored under
 * `sha`. The directory is created on the first write.
 *
 * ```ts
 * import { fileBlobs } from '@yaks/blob'
 * import { env } from '@yaks/process/system'
 *
 * let store = fileBlobs(`${env.get('HOME')}/.blobs`)
 * ```
 *
 * Asynchronous, so a graph writing through it applies asynchronously.
 */
export let fileBlobs = (dir: string): Blobs => {
  let at = (sha: string) => `${dir}/${sha}`
  let get = async (sha: string): Promise<Uint8Array | undefined> => {
    try {
      return await (await fs()).read(at(sha))
    } catch {
      return undefined
    }
  }
  return {
    get,
    has: async (sha) => (await get(sha)) != null,
    put: async (sha, bytes) => {
      let it = await fs()
      await it.mkdir(dir, { recursive: true })
      await it.write(at(sha), bytes)
    },
  }
}
