/** Native Responses image-generation output. Binary persistence is injected. */
import { ModelError, type Reply } from '@yaks/model'
import type { ArtifactStore } from '@yaks/blob'

export type ImageGeneration = {
  type?: 'image_generation'
  output_format?: 'png' | 'jpeg' | 'webp'
  quality?: 'auto' | 'low' | 'medium' | 'high'
  size?: 'auto' | '1024x1024' | '1536x1024' | '1024x1536'
  background?: 'auto' | 'opaque' | 'transparent'
}
export type Images = {
  /** @deprecated Ignored. Configured image tools are offered on every endpoint. */
  auto?: boolean
  tool?: ImageGeneration
  store: ArtifactStore
  /** Maximum decoded image bytes, default 32 MiB. */
  maxBytes?: number
}

export let generatedImages = async (
  items: Record<string, unknown>[],
  options?: Images,
): Promise<NonNullable<Reply['artifacts']>> => {
  let artifacts: NonNullable<Reply['artifacts']> = []
  for (let item of items) {
    if (item.type != 'image_generation_call') continue
    if (!options) {
      throw new ModelError(
        'image_storage',
        'Image output requires configured artifact storage',
      )
    }
    if (item.status != 'completed') {
      throw new ModelError(
        'image_incomplete',
        'Image generation did not complete',
      )
    }
    let max = options.maxBytes ?? 32 * 1024 * 1024
    if (!Number.isSafeInteger(max) || max < 1) {
      throw new ModelError('image_limit', 'Invalid image size limit')
    }
    let value = item.result
    if (
      typeof value != 'string' || !value.length ||
      value.length > Math.ceil(max / 3) * 4 ||
      (value.length % 4 != 0 || /[^A-Za-z0-9+/=]/.test(value) ||
        /=/.test(value.slice(0, -2)) ||
        (value.at(-2) == '=' && value.at(-1) != '='))
    ) {
      throw new ModelError(
        'image_payload',
        'Invalid or oversized image payload',
      )
    }
    let raw: string
    try {
      raw = atob(value)
    } catch {
      throw new ModelError('image_payload', 'Invalid image encoding')
    }
    let bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0))
    if (bytes.length > max) {
      throw new ModelError(
        'image_payload',
        'Image exceeds configured size limit',
      )
    }
    let format = item.output_format ?? options.tool?.output_format ?? 'png'
    if (!['png', 'jpeg', 'webp'].includes(String(format))) {
      throw new ModelError('image_format', 'Unsupported image format')
    }
    // Do not accept mislabeled arbitrary data as an image.
    let valid = format == 'png'
      ? bytes.length >= 8 &&
        [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] == b)
      : format == 'jpeg'
      ? bytes[0] == 255 && bytes[1] == 216 && bytes[2] == 255
      : bytes.length >= 12 &&
        String.fromCharCode(...bytes.slice(0, 4)) == 'RIFF' &&
        String.fromCharCode(...bytes.slice(8, 12)) == 'WEBP'
    if (!valid) {
      throw new ModelError(
        'image_format',
        'Image signature does not match output format',
      )
    }
    if (typeof item.id != 'string' || !item.id) {
      throw new ModelError('image_call', 'Image output has no call ID')
    }
    let artifact
    try {
      artifact = await options.store(bytes, 'image/' + format)
    } catch {
      throw new ModelError('image_storage', 'Could not persist generated image')
    }
    artifacts.push({
      ...artifact,
      call: item.id,
      ...(typeof item.revised_prompt == 'string' &&
          item.revised_prompt.length <= 32768
        ? { revised_prompt: item.revised_prompt }
        : {}),
    })
  }
  return artifacts
}
