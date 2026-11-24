// A space keeps the original and its display sizes under the same digest.
import {
  broken,
  mediaTypeOf,
  type Objects,
  type Opened,
  prefixed,
  stage,
  type Streamed,
} from '@yaks/blob'

export let LOGO_TYPES = 'image/png,image/jpeg,image/webp,image/gif'

export let logoSizes = {
  avatar: { width: 128, format: 'image/webp', suffix: '.avatar.webp' },
  icon: { width: 512, format: 'image/png', suffix: '.icon.png' },
} as const

export type LogoSize = keyof typeof logoSizes
export type Logo = { sha: string; type: string }
export type LogoInput = Streamed & { sha?: string }
export type LogoSource = {
  size: number
  read: () => Promise<ReadableStream<Uint8Array>>
}
export type ResizeLogo = (
  source: LogoSource,
  size: LogoSize,
) => Promise<Streamed | 'invalid' | undefined>

let prefix = (store: string) => `${store}/.logo/`
let keyOf = (store: string, sha: string, size?: LogoSize) =>
  prefix(store) + sha + (size ? logoSizes[size].suffix : '')

let resized = async (
  objects: Objects,
  key: string,
  source: LogoSource,
  size: LogoSize,
  resize: ResizeLogo,
) => {
  let image = await resize(source, size)
  if (!image || image == 'invalid') return image
  await objects.put(key, image)
  return 'kept'
}

/** Stage, check and resize the upload before publishing its address. */
export let keepLogo = async (
  objects: Objects,
  store: string,
  input: LogoInput,
  resize: ResizeLogo,
  admit: (object: { key: string; bytes: number }) => Promise<void>,
): Promise<Logo | string> => {
  let staged = await stage(prefixed(objects, prefix(store)), input)
  try {
    let { sha, head, size } = staged
    if (input.sha && input.sha != sha) {
      throw new Error(`Attachment bytes do not match ${input.sha}`)
    }
    let type = mediaTypeOf(head)
    if (!type) return 'a logo is a PNG, JPEG, WebP or GIF picture'
    if (head.length == size) {
      let why = await broken(head, type)
      if (why) return `that picture does not open: ${why}`
    }
    await admit({ key: keyOf(store, sha), bytes: size })
    for (let size of ['avatar', 'icon'] as const) {
      let key = keyOf(store, sha, size)
      if (await objects.has(key)) continue
      if (await resized(objects, key, staged, size, resize) == 'invalid') {
        return 'that picture does not open'
      }
    }
    await staged.keep()
    return { sha, type }
  } finally {
    await staged.drop()
  }
}

/** Open the original or a display size. Older logos acquire missing sizes on
 * their first read, from the same stored original and through the same resize. */
export let openLogo = async (
  objects: Objects,
  store: string,
  logo: Logo,
  resize: ResizeLogo,
  size?: LogoSize,
): Promise<(Opened & { type: string }) | null> => {
  let original = keyOf(store, logo.sha)
  if (!size) {
    let image = await objects.open(original)
    return image && { ...image, type: logo.type }
  }
  let key = keyOf(store, logo.sha, size)
  let image = await objects.open(key)
  if (!image) {
    let source = await objects.open(original)
    if (
      !source || await resized(objects, key, source, size, resize) != 'kept'
    ) {
      return null
    }
    image = await objects.open(key)
  }
  return image && { ...image, type: logoSizes[size].format }
}
