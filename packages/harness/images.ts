/** Host composition for native generated images: @yaks/blob artifacts in the
 * graph's own byte store. No image bytes enter graph prose. */
import { artifactStore, type Blobs } from '@yaks/blob'
import type { ImageGeneration, Images } from '@yaks/openai'

export type ImageOptions = {
  tool?: ImageGeneration
  maxBytes?: number
}

export let images = (blobs: Blobs, options: ImageOptions = {}): Images => ({
  tool: options.tool,
  maxBytes: options.maxBytes,
  store: artifactStore(blobs),
})

/** Explicit options override the environment; otherwise enable on every Responses endpoint. */
export let configuredImages = (
  blobs: Blobs,
  options: ImageOptions | false | undefined,
  setting = Deno.env.get('HARNESS_IMAGES'),
): Images | undefined => {
  if (options === false) return undefined
  if (options) return images(blobs, options)
  if (setting == '0') return undefined
  if (setting != null && setting != '' && setting != '1') {
    throw new Error('HARNESS_IMAGES must be 0 (disabled) or 1 (enabled)')
  }
  return images(blobs)
}
