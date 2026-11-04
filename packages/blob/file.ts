// The byte store that is a directory: one file per object, named by its
// address. It is the oldest form of content-addressed storage there is, and it
// is the right one for large or binary content — nothing reads it but this
// package, and a filesystem is very good at handing back a big file.
//
// It is its own entry (`@yaks/blob/file`), so a runtime without files, a
// Worker or a browser tab, never loads the filesystem boundary.
//
// No part of the name comes from a caller: the file is named by the address,
// which this package computes, so no path can escape the directory.

import { mkdir, readFile, writeFile } from '@yaks/file/io'
import type { Blobs } from './store.ts'

/**
 * A {@link Blobs} over a directory: `<dir>/<sha>` holds the bytes stored under
 * `sha`. The directory is created on the first write.
 *
 * ```ts
 * import { fileBlobs } from '@yaks/blob/file'
 * import { env } from '@yaks/process/env'
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
      return await readFile(at(sha))
    } catch {
      return undefined
    }
  }
  return {
    get,
    has: async (sha) => (await get(sha)) != null,
    put: async (sha, bytes) => {
      await mkdir(dir, { recursive: true })
      await writeFile(at(sha), bytes)
    },
  }
}
