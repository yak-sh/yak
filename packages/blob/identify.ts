// Host-side byte identification. The detector's declarations include Node
// streams; portable graphs use ArtifactStore, lent by their host.
import { mediaTypeOf } from './image.ts'
import { matchesMediaType, mediaType, utf8 } from './content_type.ts'
import { addressOf, type ArtifactStore, keep } from './artifact.ts'
import type { Blobs } from './store.ts'

const SAMPLE = 4100
const UNKNOWN = 'application/octet-stream'
let textual = (mime: string) =>
  mime.startsWith('text/') || mime.endsWith('+json') ||
  mime.endsWith('+xml') || [
    'application/json',
    'application/javascript',
    'application/xml',
    'application/vnd.apple.mpegurl',
  ].includes(mime)

/** A stable media type chosen from bytes and, for text, a valid declaration.
 * `whole` false says the bytes are only a file's first ones. */
export let contentType = async (
  bytes: Uint8Array,
  declared = '',
  whole = true,
): Promise<string> => {
  let image = mediaTypeOf(bytes)
  if (image) return image
  let { fileTypeFromBuffer } = await import('file-type/core')
  let found = await fileTypeFromBuffer(bytes.subarray(0, SAMPLE))
  let mime = mediaType(declared)
  if (found && (mime == 'audio/pcm' || !found.mime.startsWith('audio/'))) {
    return found.mime
  }
  if (matchesMediaType(bytes, mime)) return mime
  if (found) return found.mime
  return textual(mime) && utf8(bytes, whole) ? mime : UNKNOWN
}

/** Store bytes and their media type, and return the {@link Artifact} a row
 * records. */
export let artifactStore =
  (blobs: Blobs): ArtifactStore => async (bytes, mediaType) => {
    let address = await addressOf(bytes)
    await keep(blobs, address, bytes)
    return {
      address,
      media_type: await contentType(bytes, mediaType),
      size: bytes.byteLength,
    }
  }
