// yaks.app's map door (@yaks/maps/tiles): `/maps/` on the apex serves the
// tiles, TileJSON and label fonts of the provider every app's maps are drawn
// from, out of the MAPS bucket, kept in the zone's cache. The apex is ours, so
// the Cache API keeps answers there (docs.protomaps.com/deploy/cloudflare).
import { serve } from '@yaks/maps/tiles'
import { TILES_DEFAULT } from '@yaks/maps/providers'
import { background, caught } from './defects.ts'
import type { Env } from './env.ts'

/** Where the door is mounted on the apex. */
export let MAPS = '/maps'

export let fetch = async (req: Request, env: Env): Promise<Response> => {
  if (!env.MAPS) {
    caught(new Error('maps: the MAPS bucket is not bound'), { request: 'maps' })
    return new Response('Maps are not set up here.\n', { status: 503 })
  }
  let url = new URL(req.url)
  return await serve(req, url.pathname.slice(MAPS.length), {
    provider: TILES_DEFAULT,
    bucket: env.MAPS,
    base: `${url.origin}${MAPS}`,
    cache: (globalThis.caches as { default?: Cache } | undefined)?.default,
    retain: (work) =>
      background(
        work.then(() => {}, (e) => caught(e, { request: 'maps cache' })),
      ),
  })
}
