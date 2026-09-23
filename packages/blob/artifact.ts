// Bytes that are not text: a picture, a PDF, anything a property would only get
// in the way of. They are stored the same way a body property is — under the
// SHA-256 of the bytes themselves — so an artifact has one identity wherever it
// came from, and a row that names it names that exact object.
//
// The address is computed here rather than taken on trust, and the store is
// read back and compared before the caller is told the bytes are kept: a store
// that cannot hold what it was given (a text table handed a PNG) reports it at
// the write, not at the next read.
//
// `crypto.subtle` is the web platform's own, so this loads anywhere the package
// does — which is why the digest here returns a promise, and why ./store.ts
// keeps a separate synchronous one for text properties.

import type { Blobs } from './store.ts'
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

export type Artifact = {
  address: string
  media_type: string
  size: number
}
export type ArtifactStore = (
  bytes: Uint8Array,
  mediaType: string,
) => Promise<Artifact>

/** What these bytes are called: their SHA-256, lowercase hex. It is both the
 * key in the store and the eid of the row, so there is no second name for the
 * two sides to agree on. */
export let addressOf = async (bytes: Uint8Array): Promise<string> => {
  let digest = await crypto.subtle.digest(
    'SHA-256',
    bytes as Uint8Array<ArrayBuffer>,
  )
  return Array.from(
    new Uint8Array(digest),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('')
}

/** Put bytes under their address, once, and verify the store kept them. Writing
 * the same pair twice is a no-op — the second copy is the first one — and a
 * store that hands back anything else has not kept this object, which throws
 * here rather than returning corrupt bytes later. */
export let keep = async (
  blobs: Blobs,
  address: string,
  bytes: Uint8Array,
): Promise<void> => {
  let equal = (stored: Uint8Array | undefined) =>
    stored?.length == bytes.length && stored.every((b, i) => b == bytes[i])
  if (!equal(await blobs.get(address))) await blobs.put(address, bytes)
  if (!equal(await blobs.get(address))) {
    throw new Error(`@yaks/blob: the store did not keep ${address}`)
  }
}

/** Store bytes and their media type, and return the {@link Artifact} a row
 * records. */
export let artifactStore =
  (blobs: Blobs): ArtifactStore => async (bytes, mediaType) => {
    let address = await addressOf(bytes)
    await keep(blobs, address, bytes)
    return { address, media_type: mediaType, size: bytes.byteLength }
  }

export let artifactDoc: VocabDoc = doc
