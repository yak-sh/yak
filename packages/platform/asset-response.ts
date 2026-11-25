import { addressOf, type Opened } from '@yaks/blob'
import { differing } from '@yaks/blob/compare'
import { bodyOf, HEAD, holding } from '@yaks/blob/stream'
import type { Asset } from './fingerprint.ts'

export let etagOf = (version: string): string => `"${version}"`

/** Null when the response can be replaced by the release's own file. An app
 * worker can pass through its Files body with a fresh set of headers. When
 * its validator was dropped, compare the bytes before changing its address. */
export let otherThanAsset = async (
  page: Response,
  asset: Asset,
  open: () => Promise<Opened | null>,
): Promise<Response | null> => {
  if (
    /no-store/i.test(page.headers.get('cache-control') ?? '') ||
    page.headers.has('set-cookie') || page.headers.has('vary')
  ) return page

  let etag = page.headers.get('etag')
  if (etag) {
    if (etag != etagOf(asset.original.slice(0, 24))) return page
    await page.body?.cancel()
    return null
  }
  let type = page.headers.get('content-type')?.split(';')[0].trim()
  if (
    !page.body || page.headers.has('content-encoding') ||
    type != asset.type.split(';')[0].trim()
  ) {
    return page
  }
  let held = await holding(bodyOf(page), HEAD)
  if (held instanceof Uint8Array) {
    return await addressOf(held) == asset.original
      ? null
      : new Response(held, page)
  }
  let original = await open()
  if (!original) throw new Error(`Missing release file ${asset.original}`)
  let rest = held.size != null && held.size != original.size
    ? held.stream
    : await differing(held.stream, original)
  return rest ? new Response(rest, page) : null
}
