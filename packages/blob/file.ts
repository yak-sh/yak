// The backend that is a directory: one file per object, named by its address.
// It is the oldest content-addressed store there is, and it is the right one
// for large or binary content — nothing reads it but this package, and a
// filesystem is very good at handing back a big file.
//
// The runtime's file API is LOOKED UP rather than imported, so this module
// loads and type-checks anywhere — in a browser bundle, in a Worker — with no
// platform types in the package's compile at all. Where there is no filesystem
// it throws when called, which is the honest answer: use a store that exists
// there.
//
// A name is never taken from a caller: the file is named by the address, which
// this package computes, so no path can escape the directory.

import type { Blobs } from './store.ts'

// The three calls this backend needs, as the runtime spells them.
type Fs = {
  mkdir: (path: string, opts: { recursive: boolean }) => Promise<unknown>
  read: (path: string) => Promise<Uint8Array>
  write: (path: string, bytes: Uint8Array) => Promise<void>
}

// This runtime's filesystem, or null where there is none.
let found = (): Fs | null => {
  let host = globalThis as { Deno?: Record<string, unknown> }
  let deno = host.Deno
  if (!deno) return null
  let { mkdir, readFile, writeFile } = deno as Record<string, unknown>
  if (
    typeof mkdir != 'function' || typeof readFile != 'function' ||
    typeof writeFile != 'function'
  ) return null
  return {
    mkdir: (path, opts) => (mkdir as Fs['mkdir'])(path, opts),
    read: (path) => (readFile as Fs['read'])(path),
    write: (path, bytes) => (writeFile as Fs['write'])(path, bytes),
  }
}

let fs = (): Fs => {
  let it = found()
  if (!it) throw new Error('@yaks/blob: no filesystem in this runtime')
  return it
}

/**
 * A {@link Blobs} over a directory: `<dir>/<sha>` holds the bytes stored under
 * `sha`. The directory is created on the first write.
 *
 * ```ts
 * import { fileBlobs } from '@yaks/blob'
 *
 * let store = fileBlobs(`${Deno.env.get('HOME')}/.blobs`)
 * ```
 *
 * Asynchronous, so a graph writing through it applies asynchronously.
 */
export let fileBlobs = (dir: string): Blobs => {
  let at = (sha: string) => `${dir}/${sha}`
  let get = async (sha: string): Promise<Uint8Array | undefined> => {
    try {
      return await fs().read(at(sha))
    } catch {
      return undefined
    }
  }
  return {
    get,
    has: async (sha) => (await get(sha)) != null,
    put: async (sha, bytes) => {
      let it = fs()
      await it.mkdir(dir, { recursive: true })
      await it.write(at(sha), bytes)
    },
  }
}
