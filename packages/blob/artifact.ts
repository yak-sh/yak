/** Binary artifacts stored outside text columns, using any existing Blobs backend. */
import type { Blobs } from './store.ts'
import type { VocabDoc } from '@yaks/vocab'

export type Artifact = {
  address: string
  media_type: string
  size: number
}
export type ArtifactStore = (
  bytes: Uint8Array,
  mediaType: string,
) => Promise<Artifact>

export let artifactStore =
  (blobs: Blobs): ArtifactStore => async (bytes, mediaType) => {
    let digest = await crypto.subtle.digest(
      'SHA-256',
      bytes as Uint8Array<ArrayBuffer>,
    )
    let address = Array.from(
      new Uint8Array(digest),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('')
    let equal = (stored: Uint8Array | undefined) =>
      stored?.length == bytes.length && stored.every((b, i) => b == bytes[i])
    if (!equal(await blobs.get(address))) await blobs.put(address, bytes)
    if (!equal(await blobs.get(address))) {
      throw new Error('Artifact storage verification failed')
    }
    return { address, media_type: mediaType, size: bytes.byteLength }
  }

export let artifactDoc: VocabDoc = {
  title: 'artifact',
  $defs: {
    artifact: {
      description: 'A binary object in the configured external blob store.',
      properties: {
        address: { type: 'string' },
        media_type: { type: 'string' },
        size: { type: 'number' },
      },
    },
    attachment: {
      description:
        'An artifact produced by a model response; the entry belongs to its session.',
      properties: {
        artifact: { type: 'string', ref: 'artifact', death: 'keep' },
        audience: { type: 'string', enum: ['user', 'model'] },
        revision: { type: 'string' },
        call: { type: 'string' },
        revised_prompt: { type: 'string' },
      },
    },
  },
}
