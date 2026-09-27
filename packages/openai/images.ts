/** Native Responses image-generation output. Binary persistence is injected. */
import { ModelError, type Reply } from '@yaks/model'
import type { ArtifactStore } from '@yaks/blob'
import { generatedMedia } from './media.ts'

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
    let format = item.output_format ?? options.tool?.output_format ?? 'png'
    if (!['png', 'jpeg', 'webp'].includes(String(format))) {
      throw new ModelError('image_format', 'Unsupported image format')
    }
    if (typeof item.id != 'string' || !item.id) {
      throw new ModelError('image_call', 'Image output has no call ID')
    }
    let artifact = await generatedMedia(
      item.result,
      'image/' + format,
      item.id,
      { store: options.store, maxBytes: options.maxBytes ?? 32 * 1024 * 1024 },
    )
    artifacts.push({
      ...artifact,
      ...(typeof item.revised_prompt == 'string' &&
          item.revised_prompt.length <= 32768
        ? { revised_prompt: item.revised_prompt }
        : {}),
    })
  }
  return artifacts
}
