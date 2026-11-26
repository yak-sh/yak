// The private release's path-to-byte index. Its key sits beside the release
// prefix, leaving every path inside that prefix available to the app. A file
// a first view reads may carry its `text` (release.ts `packed`), so a reader
// holding no index reads one object for it, not the index and then the bytes.

import type { Asset } from './fingerprint.ts'
import { inside, rootOf, type Serving, WORKER } from './files.ts'
import { holding } from '@yaks/blob'
import { fromBase64, toBase64 } from '@yaks/fp'

export let META = '.json'
export type File = {
  key: string
  sha: string
  text?: string
  asset?: Asset & { path: string }
}
export type Index = Record<string, File>

export let encode = (index: Index) =>
  new TextEncoder().encode(JSON.stringify(index))

export let decode = (bytes: Uint8Array): Index =>
  JSON.parse(new TextDecoder().decode(bytes))

export type ReleaseView = { source: string; body: string }
export type ServingIndex = { config: Serving; index: Index }

// Two views can ride along with a route, for the app and the space's home.
// Bound the compressed payload so there is room for the rest of the route
// in the directory's serving copy. Large releases still have their R2 index.
let VIEW_BYTES = 16 * 1024
let INDEX_BYTES = 96 * 1024
export let releaseView = async (
  source: string,
  index: Index,
  { main, assets }: Serving,
): Promise<ReleaseView | null> => {
  let config = { main, assets }
  let root = rootOf('', config).slice(1)
  let prefix = root ? root + '/' : ''
  let files = Object.fromEntries(
    Object.entries(index).map(([name, { text, ...file }]) => [
      name,
      text != null && name.startsWith(prefix) && name != (main ?? WORKER) &&
        !inside('/' + name.slice(prefix.length))
        ? { ...file, text }
        : file,
    ]),
  )
  let body = new Blob([
    JSON.stringify({ config, index: files } satisfies ServingIndex),
  ])
  if (body.size > INDEX_BYTES) return null
  let stream = body.stream().pipeThrough(new CompressionStream('gzip'))
  let bytes = await holding({ stream }, VIEW_BYTES * 3 / 4)
  if (bytes instanceof Uint8Array) return { source, body: toBase64(bytes) }
  await bytes.stream.cancel()
  return null
}

export let readView = async ({ body }: ReleaseView): Promise<ServingIndex> => {
  let stream = new Blob([fromBase64(body)]).stream()
    .pipeThrough(new DecompressionStream('gzip'))
  let bytes = await holding({ stream }, INDEX_BYTES)
  if (bytes instanceof Uint8Array) {
    return JSON.parse(new TextDecoder().decode(bytes))
  }
  await bytes.stream.cancel()
  throw new Error('release view exceeds its uncompressed size limit')
}
