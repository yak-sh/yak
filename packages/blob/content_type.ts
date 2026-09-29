// The media type of content-addressed bytes. Binary signatures win over an
// upload's declared type; text formats cannot be identified from their bytes,
// so their first validated declaration is kept beside the object.

import { mediaTypeOf } from './image.ts'

const SAMPLE = 4100
const UNKNOWN = 'application/octet-stream'

/** A declared media type with no parameters or header control characters. */
export let mediaType = (declared = ''): string => {
  let mime = declared.split(';')[0].trim().toLowerCase()
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime) ? mime : UNKNOWN
}

let textual = (mime: string) =>
  mime.startsWith('text/') || mime.endsWith('+json') ||
  mime.endsWith('+xml') || [
    'application/json',
    'application/javascript',
    'application/xml',
    'application/vnd.apple.mpegurl',
  ].includes(mime)

let utf8 = (bytes: Uint8Array) => {
  try {
    let text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    // deno-lint-ignore no-control-regex
    return !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)
  } catch {
    return false
  }
}

let at = (bytes: Uint8Array, offset: number, value: string) =>
  bytes.length >= offset + value.length &&
  [...value].every((c, i) => bytes[offset + i] == c.charCodeAt(0))

/** Formats whose declaration can be checked without a file-type guess. */
export let matchesMediaType = (bytes: Uint8Array, mime: string): boolean =>
  mediaTypeOf(bytes) == mime ||
  (mime == 'audio/mpeg' &&
    (at(bytes, 0, 'ID3') ||
      (bytes.length >= 3 && bytes[0] == 255 &&
        (bytes[1] & 224) == 224))) ||
  (mime == 'audio/wav' && at(bytes, 0, 'RIFF') && at(bytes, 8, 'WAVE')) ||
  (mime == 'audio/flac' && at(bytes, 0, 'fLaC')) ||
  (mime == 'audio/opus' &&
    (at(bytes, 0, 'OggS') || at(bytes, 0, 'OpusHead'))) ||
  (mime == 'audio/pcm' && bytes.length > 0 && bytes.length % 2 == 0)

/** A stable media type chosen from bytes and, for text, a valid declaration. */
export let contentType = async (
  bytes: Uint8Array,
  declared = '',
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
  return textual(mime) && utf8(bytes) ? mime : UNKNOWN
}
