// Bytes that are not text: a picture, a PDF, anything a column would only be
// in the way of. They are kept the same way a body column is — under the
// SHA-256 of the bytes themselves — so an artifact has ONE identity wherever
// it came from, and a row that names it is a row naming that exact object.
//
// The address is computed here rather than taken on trust, and the store is
// read back and compared before anything is told the bytes are kept: a backend
// that cannot hold what it was given (a text table handed a PNG) says so at
// the write, not at the next read.
//
// `crypto.subtle` is the web platform's, so this loads anywhere the package
// does — which is why the digest is a promise, and why ./store.ts keeps its
// own synchronous one for text columns.

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

/** What these bytes are called: their SHA-256, lowercase hex. It is the key in
 * the store and the eid of the row, so nothing has to agree on a second name. */
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

/** Put bytes under their address, once, and prove the store kept them. Writing
 * the same pair twice is a no-op — the second copy IS the first one — and a
 * store that hands back anything else has not kept this object, which is a
 * refusal here rather than a corrupt answer later. */
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

/** Bytes and what they are, stored: the {@link Artifact} a row records. */
export let artifactStore =
  (blobs: Blobs): ArtifactStore => async (bytes, mediaType) => {
    let address = await addressOf(bytes)
    await keep(blobs, address, bytes)
    return { address, media_type: mediaType, size: bytes.byteLength }
  }

export let artifactDoc: VocabDoc = doc
