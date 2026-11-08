// A space's logo (T-140199): the picture it wears where its letter stood, and
// the icon of each of its apps that has none of its own (T-151744). One write
// sets it, behind both doors that do: the Logo card on its Settings page
// (manage.ts) and space_set's `logo` (tools.ts).
//
// The bytes are kept in the bucket under the space's handle, content-addressed,
// so a rename moves none of them and deleting the space sweeps them with the
// rest (erase.ts `swept`); the bytes the row stops naming are deleted.
import { broken, mediaTypeOf } from '@yaks/blob'
import { base64 } from './bytes.ts'
import type { directory, Space } from './directory.ts'
import type { Env } from './env.ts'
import { r2RawObjects } from './lib/objects.ts'
import { drawn } from './raster.ts'
import { sha256 } from './versions.ts'

/** The most bytes a space's logo may be, and the kinds it may be: pictures a
 * browser draws as an image and nothing else, so no SVG with its scripts. */
export let LOGO = {
  size: 1_000_000,
  accept: 'image/png,image/jpeg,image/webp,image/gif',
}

let keyOf = (space: Pick<Space, 'store'>, sha: string) =>
  `${space.store}/.logo/${sha}`
// The logo drawn as an app's icon, beside the logo it was drawn from.
let iconOf = (space: Pick<Space, 'store'>, sha: string) =>
  `${keyOf(space, sha)}.icon.png`

/**
 * The space wearing the picture `bytes`, or none where null (Remove). Answers
 * why the bytes cannot be its logo, or nothing once they are.
 */
export let logoed = async (
  env: Env,
  dir: ReturnType<typeof directory>,
  space: Space,
  bytes: Uint8Array<ArrayBuffer> | null,
  headers: Record<string, string>,
): Promise<string | undefined> => {
  let blobs = r2RawObjects(env.BLOBS)
  let logo = null
  if (bytes) {
    if (bytes.byteLength > LOGO.size) return 'a logo can be up to 1 MB'
    let type = mediaTypeOf(bytes)
    if (!type || !LOGO.accept.split(',').includes(type)) {
      return 'a logo is a PNG, JPEG, WebP or GIF picture'
    }
    let why = await broken(bytes, type)
    if (why) return `that picture does not open: ${why}`
    logo = { sha: await sha256(bytes), type }
    await blobs.put(keyOf(space, logo.sha), bytes)
  }
  let had = space.logo?.sha
  await dir.badge(space, logo, headers)
  if (had && had != logo?.sha) {
    await blobs.delete([keyOf(space, had), iconOf(space, had)])
  }
}

/** The bytes of the logo the space wears at `sha`, or none. */
export let logoBytes = async (env: Env, space: Space, sha: string) =>
  space.logo?.sha == sha
    ? await r2RawObjects(env.BLOBS).read(keyOf(space, sha))
    : null

/**
 * The space's logo as an app's icon: drawn square at 512 on white, as an
 * icon.svg is (raster.ts), since an installer asks for a square PNG and iOS
 * fills a transparent one with black. Drawn once and kept beside the logo;
 * where no drawing can be had, the logo as it is. None for a space without
 * one.
 */
export let logoIcon = async (
  env: Env,
  space: Space,
  app: string,
): Promise<{ bytes: Uint8Array; type: string } | null> => {
  if (!space.logo) return null
  let { sha, type } = space.logo
  let blobs = r2RawObjects(env.BLOBS)
  let kept = await blobs.read(iconOf(space, sha))
  if (kept) return { bytes: kept, type: 'image/png' }
  let bytes = await logoBytes(env, space, sha)
  if (!bytes) return null
  let png = await drawn(env, framed(bytes, type), app)
  if (!(png instanceof Uint8Array)) return { bytes, type }
  await blobs.put(iconOf(space, sha), png)
  return { bytes: png, type: 'image/png' }
}

// A picture centred whole in a square, for yak-raster to draw.
let framed = (bytes: Uint8Array, type: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">` +
  `<image width="512" height="512" preserveAspectRatio="xMidYMid meet" ` +
  `href="data:${type};base64,${base64(bytes)}"/></svg>`
