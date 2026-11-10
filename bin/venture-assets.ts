// Copy bytes through supplied storage doors. Source paths remain private in the
// importer; the result maps them to content-addressed destination blobs.
import { sha256 } from '@yaks/graph'

export type Asset = { key: string; bytes?: number; hash?: string }
export type Assets = {
  read: (key: string) => Promise<Uint8Array>
  get: (hash: string) => Promise<Uint8Array | undefined>
  put: (hash: string, bytes: Uint8Array) => Promise<void>
}

/** Both ends are checked; a successful write alone is not migration evidence. */
export let copyAssets = async (
  objects: Asset[],
  store: Assets,
): Promise<Record<string, string>> => {
  let result: Record<string, string> = {}
  for (let object of objects) {
    let bytes = await store.read(object.key)
    let hash = sha256(bytes)
    if (object.bytes !== undefined && object.bytes !== bytes.byteLength) {
      throw Error('Source asset size mismatch')
    }
    if (object.hash !== undefined && object.hash !== hash) {
      throw Error('Source asset digest mismatch')
    }
    let existing = await store.get(hash)
    if (!existing || sha256(existing) !== hash) await store.put(hash, bytes)
    let copied = await store.get(hash)
    if (!copied || sha256(copied) !== hash) {
      throw Error('Destination asset digest mismatch')
    }
    result[object.key] = hash
  }
  return result
}
