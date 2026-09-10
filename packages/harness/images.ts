/** Host composition for native generated images. No image bytes enter graph prose. */
import { artifactStore, fileBlobs } from '@yaks/blob'
import type { ImageGeneration, Images } from '@yaks/openai'

export type ImageOptions = {
  directory?: string
  tool?: ImageGeneration
  maxBytes?: number
}

export let images = (options: ImageOptions): Images => {
  let directory = options.directory ?? Deno.env.get('HARNESS_IMAGE_DIR') ??
    Deno.env.get('HOME') + '/.harness/images'
  let store = artifactStore(fileBlobs(directory))
  return {
    tool: options.tool,
    maxBytes: options.maxBytes,
    store: async (bytes, type) => {
      // Private directory protects files even when the process umask is permissive.
      await Deno.mkdir(directory, { recursive: true, mode: 0o700 })
      await Deno.chmod(directory, 0o700)
      return await store(bytes, type)
    },
  }
}
