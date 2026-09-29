// The media type of content-addressed bytes. Binary signatures win over an
// upload's declared type; text formats cannot be identified from their bytes,
// so their first validated declaration is kept beside the object.

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

/** A stable media type chosen from bytes and, for text, a valid declaration. */
export let contentType = async (
  bytes: Uint8Array,
  declared = '',
): Promise<string> => {
  let { fileTypeFromBuffer } = await import('file-type/core')
  let found = await fileTypeFromBuffer(bytes.subarray(0, SAMPLE))
  if (found) return found.mime
  let mime = mediaType(declared)
  return textual(mime) && utf8(bytes) ? mime : UNKNOWN
}
