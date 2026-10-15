// A host's half of an npm package's home (./home.ts): one file out of the
// registry's tarball as it streams in, and the proof that it is the tarball
// the home names. A module of its own, so a host loads the hashing it needs
// only when it fills a home, never on start.
import { sha256 } from '@noble/hashes/sha2.js'
import { hex } from './home.ts'
import { rooted, untar } from './tar.ts'

/** What a tarball holds: its SHA-256, every file's path from the package's
 * root, and the bytes of the one asked for, or null when it holds no such
 * file. */
export type Unpacked = {
  sha256: string
  paths: string[]
  bytes: Uint8Array | null
}

/**
 * Read a gzipped npm tarball as it streams in, keeping only the file at
 * `want`, a path from the package's root. The whole tarball is read, since
 * its SHA-256 is what says it is the one a home names; a host checks that
 * before it serves the bytes.
 */
export let unpacked = async (
  tgz: ReadableStream<Uint8Array<ArrayBuffer>>,
  want: string,
): Promise<Unpacked> => {
  let hash = sha256.create()
  let paths: string[] = []
  // The two entries `want` could be until the root is known: under the first
  // entry's directory, where npm packs every file, or under none.
  let first: string | undefined
  let found = new Map<string, Uint8Array>()
  let push = untar(
    (path, _, file) => {
      if (!file || !path) return false
      paths.push(path)
      first ??= path.slice(0, path.indexOf('/') + 1)
      return path == want || path == first + want
    },
    (path, bytes) => void found.set(path, bytes),
  )
  let inflated = tgz
    .pipeThrough(
      new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({
        transform: (chunk, out) => {
          hash.update(chunk)
          out.enqueue(chunk)
        },
      }),
    )
    .pipeThrough(new DecompressionStream('gzip'))
  for await (let chunk of inflated) push(chunk)
  let root = rooted(paths)
  return {
    sha256: hex(hash.digest()),
    paths: paths.map((path) => path.slice(root.length)),
    bytes: found.get(root + want) ?? null,
  }
}
