/** Decode provider media at the artifact boundary, before bytes enter a store. */
import type { ArtifactStore } from '@yaks/blob'
import { ModelError, type Reply } from '@yaks/model'

export type MediaStore = {
  store: ArtifactStore
  maxBytes?: number
}

let signature = (bytes: Uint8Array, type: string) =>
  type == 'image/png'
    ? bytes.length >= 8 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] == b)
    : type == 'image/jpeg'
    ? bytes[0] == 255 && bytes[1] == 216 && bytes[2] == 255
    : type == 'image/webp'
    ? bytes.length >= 12 &&
      String.fromCharCode(...bytes.slice(0, 4)) == 'RIFF' &&
      String.fromCharCode(...bytes.slice(8, 12)) == 'WEBP'
    : type == 'audio/wav'
    ? bytes.length >= 12 &&
      String.fromCharCode(...bytes.slice(0, 4)) == 'RIFF' &&
      String.fromCharCode(...bytes.slice(8, 12)) == 'WAVE'
    : type == 'audio/mpeg'
    ? bytes.length >= 3 &&
      (String.fromCharCode(...bytes.slice(0, 3)) == 'ID3' ||
        (bytes[0] == 255 && (bytes[1] & 224) == 224))
    : type == 'audio/flac'
    ? String.fromCharCode(...bytes.slice(0, 4)) == 'fLaC'
    : type == 'audio/opus'
    ? String.fromCharCode(...bytes.slice(0, 4)) == 'OggS' ||
      String.fromCharCode(...bytes.slice(0, 8)) == 'OpusHead'
    : type == 'audio/pcm'
    ? bytes.length > 0 && bytes.length % 2 == 0
    : false

/** Store one complete base64 media value, returning only its address and type. */
export let generatedMedia = async (
  data: unknown,
  mediaType: string,
  call: string,
  options?: MediaStore,
): Promise<NonNullable<Reply['artifacts']>[number]> => {
  if (!options) {
    throw new ModelError(
      'media_storage',
      'Media output requires artifact storage',
    )
  }
  let max = options.maxBytes ?? 64 * 1024 * 1024
  if (!Number.isSafeInteger(max) || max < 1) {
    throw new ModelError('media_limit', 'Invalid media size limit')
  }
  if (
    typeof data != 'string' || !data.length ||
    data.length > Math.ceil(max / 3) * 4 ||
    data.length % 4 != 0 || /[^A-Za-z0-9+/=]/.test(data) ||
    /=/.test(data.slice(0, -2)) ||
    (data.at(-2) == '=' && data.at(-1) != '=')
  ) {
    throw new ModelError('media_payload', 'Invalid or oversized media payload')
  }
  let raw: string
  try {
    raw = atob(data)
  } catch {
    throw new ModelError('media_payload', 'Invalid media encoding')
  }
  let bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0))
  return await generatedBytes(bytes, mediaType, call, options)
}

/** Store bytes from a provider that answers with a binary body. */
export let generatedBytes = async (
  bytes: Uint8Array,
  mediaType: string,
  call: string,
  options?: MediaStore,
): Promise<NonNullable<Reply['artifacts']>[number]> => {
  if (!options) {
    throw new ModelError(
      'media_storage',
      'Media output requires artifact storage',
    )
  }
  let max = options.maxBytes ?? 64 * 1024 * 1024
  if (!Number.isSafeInteger(max) || max < 1) {
    throw new ModelError('media_limit', 'Invalid media size limit')
  }
  if (bytes.length > max) {
    throw new ModelError('media_payload', 'Media exceeds configured size limit')
  }
  if (!signature(bytes, mediaType)) {
    throw new ModelError(
      'media_format',
      'Media signature does not match format',
    )
  }
  if (!call) throw new ModelError('media_call', 'Media output has no call ID')
  try {
    return { ...await options.store(bytes, mediaType), call }
  } catch {
    throw new ModelError('media_storage', 'Could not persist generated media')
  }
}
