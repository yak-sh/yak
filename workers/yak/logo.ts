// The Settings form and space_set share the space's logo writer.
import { bodyOf, fromChunks } from '@yaks/blob'
import { unbase64 } from './bytes.ts'
import {
  keepLogo,
  LOGO_TYPES,
  type LogoInput,
  type LogoSize,
  logoSizes,
  openLogo,
  type ResizeLogo,
} from '@yaks/platform/space-logo'
import { caught } from './defects.ts'
import type { directory, Space } from './directory.ts'
import type { Env } from './env.ts'
import { parts } from './form.ts'
import { r2RawObjects } from './lib/objects.ts'
import { refuse } from './tool.ts'
import { fullFiles } from './usage.ts'

export { LOGO_TYPES }

// The Images binding accepts at most 20 MB. This is a limit on the display
// conversion only. Originals are still kept and can be opened at full size.
let IMAGES_INPUT = 20_000_000

let thumbnail = (env: Env): ResizeLogo => async (source, size) => {
  if (!env.IMAGES || source.size > IMAGES_INPUT) return
  let { width, format } = logoSizes[size]
  let stream = await source.read()
  try {
    let picture = await env.IMAGES.input(stream).transform({
      width,
      height: width,
      ...(size == 'icon'
        ? { fit: 'pad', background: '#ffffff' }
        : { fit: 'scale-down' }),
    }).output({
      format,
      anim: false,
      ...(size == 'avatar' ? { quality: 85 } : {}),
    })
    let response = picture.response()
    if (response.ok && response.body) return bodyOf(response)
    await response.body?.cancel()
    throw new Error(`Images answered ${response.status} for a space logo`)
  } catch (error) {
    if (!stream.locked) await stream.cancel().catch(() => {})
    let { code } = Object(error)
    if (code == 9412 || code == 9520) return 'invalid'
    if (code == 9402 || code == 9413) return
    caught(error, { request: 'resize space logo', size })
  }
}

export let logoed = async (
  env: Env,
  dir: ReturnType<typeof directory>,
  space: Space,
  input: LogoInput | null,
  headers: Record<string, string>,
): Promise<string | undefined> => {
  let logo = input && await keepLogo(
    r2RawObjects(env.BLOBS),
    space.store,
    input,
    thumbnail(env),
    async (object) => {
      let full = await fullFiles(env, space, [object])
      if (full) throw refuse('space_full', full)
    },
  )
  if (typeof logo == 'string') return logo
  await dir.badge(space, logo, headers)
}

/** The browser's file part, consumed in place while the form streams. */
export let logoPosted = async (
  req: Request,
  save: (input: LogoInput | null) => Promise<string | undefined>,
) => {
  let form = parts(req)
  let remove = false
  for await (let part of form) {
    if (part.name == 'unlogo') remove = true
    if (part.name == 'logo' && part.filename) {
      let file = (async function* () {
        yield* part.body
        while (!(await form.next()).done) continue
      })()
      return await save({ stream: fromChunks(file) })
    }
  }
  return remove ? await save(null) : 'choose a picture for the logo'
}

/** The connector carries base64 in JSON. Decode its bytes a block at a time. */
export let logoBase64 = (text: string): LogoInput => ({
  stream: fromChunks((async function* () {
    let tail = ''
    let block = 64 * 1024
    try {
      for (let i = 0; i < text.length; i += block) {
        let piece = tail + text.slice(i, i + block).replace(/[ \t\r\n\f]/g, '')
        let end = piece.indexOf('=')
        let length = end < 0 ? piece.length : end
        let aligned = length - length % 4
        tail = piece.slice(aligned)
        if (tail.length > 4) throw new Error('invalid padding')
        if (aligned) yield unbase64(piece.slice(0, aligned))
      }
      if (tail) yield unbase64(tail)
    } catch {
      throw refuse('arguments', 'logo_base64 is not base64')
    }
  })()),
})

/** The body at an HTTPS address, or why it could not be opened. */
export let logoAt = async (
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<LogoInput | string> => {
  let at: URL
  try {
    at = new URL(url)
  } catch {
    return `${url} is not an address`
  }
  if (at.protocol != 'https:') return 'a logo is read from an https address'
  let res = await fetcher(at, { headers: { accept: LOGO_TYPES } }).catch(
    (e) => e instanceof Error ? e : new Error(String(e)),
  )
  if (res instanceof Error) {
    return `${at.host} could not be reached: ${res.message}`
  }
  if (!res.ok || !res.body) {
    await res.body?.cancel()
    return `${at.host} answered ${res.status} for that picture`
  }
  return res.headers.has('content-encoding')
    ? { stream: res.body }
    : bodyOf(res)
}

export let logoImage = (env: Env, space: Space, sha: string, size?: LogoSize) =>
  space.logo?.sha == sha
    ? openLogo(
      r2RawObjects(env.BLOBS),
      space.store,
      space.logo,
      thumbnail(env),
      size,
    )
    : null
