// The private release's path-to-byte index. Its key sits beside the release
// prefix, leaving every path inside that prefix available to the app. A file
// a first view reads may carry its `text` (release.ts `packed`), so a reader
// holding no index reads one object for it, not the index and then the bytes.

import type { Asset } from '@yaks/platform/fingerprint'

export let META = '.json'
export type File = {
  key: string
  sha: string
  text?: string
  asset?: Asset & { path: string }
}
export type Index = Record<string, File>

export let encode = (index: Index): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(JSON.stringify(index))

export let decode = (bytes: Uint8Array): Index =>
  JSON.parse(new TextDecoder().decode(bytes))

// The internal cache key includes the complete release source, including its
// space handle and app identity. The binding has no public route.
let KEY = /^[a-z0-9][a-z0-9.-]*\/\.releases\/[a-z0-9-]+\/[a-z0-9-]+\.json$/
let HOST = 'release-index.invalid'

/** The address of the immutable index, through the release index cache. */
export let indexAddress = (key: string): string =>
  `https://${HOST}/${encodeURIComponent(key)}`

/** Translate an internal cache request to an index key. */
export let indexKey = (req: Request): string | null => {
  let { hostname, pathname, search } = new URL(req.url)
  if (req.method != 'GET' || hostname != HOST || search) return null
  let key
  try {
    key = decodeURIComponent(pathname.slice(1))
  } catch {
    return null
  }
  return KEY.test(key) && req.url == indexAddress(key) ? key : null
}
