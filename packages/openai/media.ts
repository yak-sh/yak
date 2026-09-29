/** Decode provider media at the artifact boundary, before bytes enter a store. */
import { type ArtifactStore, matchesMediaType } from '@yaks/blob'
import { ModelError, type Reply } from '@yaks/model'

export type MediaStore = {
  store: ArtifactStore
  maxBytes?: number
}

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
  if (!matchesMediaType(bytes, mediaType)) {
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
