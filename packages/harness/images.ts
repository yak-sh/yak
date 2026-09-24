/** Host composition for native generated images. No image bytes enter graph prose. */
import { artifactBytes, artifactStore, type Blobs, fileBlobs } from '@yaks/blob'
import type { ImageGeneration, Images } from '@yaks/openai'
import { home } from './paths.ts'

export type ImageOptions = {
  directory?: string
  tool?: ImageGeneration
  maxBytes?: number
}

/** Where artifacts are kept on this machine: the options' directory, else
 * `$HARNESS_IMAGE_DIR`, else `images` in the harness's home. */
export let imageDir = (options?: ImageOptions | false): string =>
  (options && options.directory) || Deno.env.get('HARNESS_IMAGE_DIR') ||
  `${home()}/images`

/** The store those artifacts' bytes are kept in. */
export let imageBlobs = (options?: ImageOptions | false): Blobs =>
  fileBlobs(imageDir(options))

export let images = (options: ImageOptions): Images => {
  let directory = imageDir(options)
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
  let bytes: Uint8Array | undefined
  try {
    bytes = await artifactBytes(imageBlobs(options), {
      address: artifact.address,
      media_type: 'image/png',
      size: artifact.size,
    })
  } catch {
    throw new Error('Image artifact verification failed')
  }
  if (!bytes) throw new Error('Image artifact unavailable')
  return bytes
}
