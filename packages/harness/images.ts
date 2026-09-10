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

/** Explicit options override the environment; otherwise enable on every Responses endpoint. */
export let configuredImages = (
  options: ImageOptions | false | undefined,
  setting = Deno.env.get('HARNESS_IMAGES'),
): Images | undefined => {
  if (options === false) return undefined
  if (options) return images(options)
  if (setting == '0') return undefined
  if (setting != null && setting != '' && setting != '1') {
    throw new Error('HARNESS_IMAGES must be 0 (disabled) or 1 (enabled)')
  }
  return images({})
}

/** Resolve only registered PNG artifacts, never arbitrary caller paths or hashes. */
export let readImage = async (
  g: import('@yaks/graph').Graph,
  eid: string,
  options?: ImageOptions | false,
): Promise<Uint8Array> => {
  let [row] = await g.storage.tx((tx) => tx.get([eid]))
  let artifact = row?.artifact as Record<string, unknown> | undefined
  if (
    !artifact || artifact.media_type != 'image/png' ||
    typeof artifact.address != 'string' ||
    !/^[a-f0-9]{64}$/.test(artifact.address) ||
    typeof artifact.size != 'number' || artifact.size > 4 * 1024 * 1024
  ) {
    throw new Error('Not a displayable PNG artifact')
  }
  let directory = (options && options.directory) ||
    Deno.env.get('HARNESS_IMAGE_DIR') ||
    Deno.env.get('HOME') + '/.harness/images'
  let bytes = await fileBlobs(directory).get(artifact.address)
  if (!bytes || bytes.length != artifact.size) {
    throw new Error('Image artifact unavailable')
  }
  let digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>),
  )
  let hash = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
  if (hash != artifact.address) {
    throw new Error('Image artifact verification failed')
  }
  return bytes
}
