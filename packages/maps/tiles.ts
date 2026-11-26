// The tile door: a map's vector tiles, its TileJSON and its label fonts, read
// from a PMTiles archive in a bucket, for whichever provider row the host
// names. It knows no provider and no runtime: the host hands it a bucket and,
// where it has one, a cache and a way to finish work after the answer.
//
// Paths, under whatever the host mounts it at (yaks.app: `/maps`):
//
// - `/tiles.json`: the TileJSON MapLibre reads first;
// - `/{z}/{x}/{y}.mvt`: one tile, 204 where the archive has none;
// - `/fonts/{fontstack}/{range}.pbf`: one range of a label font's glyphs.
//
// A bucket's first byte can take 500 ms (docs.protomaps.com/deploy/
// cloudflare), so every answer is kept in the cache by its address. Every
// answer is public and allows any origin: an app's page on any host draws
// them.
import {
  type Cache as Parts,
  EtagMismatch,
  PMTiles,
  ResolvedValueCache,
  type Source,
} from 'pmtiles'
import type { Bucket as Blobs } from '@yaks/blob'
import type { Tiles } from './providers.ts'

/** The one call the door makes of a bucket: the bytes of a key, or a range
 * of them. An R2 bucket answers it. */
export type Bucket = Pick<Blobs, 'get'>

/** Where answers are kept between requests: the Cache API's shape. */
export type Kept = {
  match(req: Request): Promise<Response | undefined>
  put(req: Request, res: Response): Promise<void>
}

/** What the door is handed. `base` is the address it is mounted at, which
 * the TileJSON's tile addresses are made from; `retain` holds work on past
 * the answer (a Worker's `waitUntil`). */
export type Door = {
  provider: Tiles
  bucket: Bucket
  base: string
  cache?: Kept
  retain?: (work: Promise<unknown>) => void
}

/** How long a browser and the edge keep a tile. A refreshed archive replaces
 * tiles within this. */
export let TILE_AGE = 86_400
/** How long a font range is kept: its bytes never change. */
let FONT_AGE = 30 * 86_400

let HEADERS = {
  'access-control-allow-origin': '*',
  'timing-allow-origin': '*',
}

let answer = (
  body: BodyInit | null,
  type: string,
  age: number,
  status = 200,
) =>
  new Response(body, {
    status,
    headers: {
      ...HEADERS,
      'content-type': type,
      'cache-control': `public, max-age=${age}`,
    },
  })

let missing = () =>
  new Response('No such map part.\n', {
    status: 404,
    headers: { ...HEADERS, 'content-type': 'text/plain; charset=utf-8' },
  })

/** The archive is not in the bucket: a host that has not copied it in yet
 * (refresh.ts). The door answers 503 until it is. */
export class Absent extends Error {
  constructor(key: string) {
    super(`maps: ${key} is not in the bucket yet`)
  }
}

/** A key in a bucket read as a PMTiles source. A range whose etag differs
 * from the one the archive's header was read with means the archive was
 * replaced under it, which pmtiles answers by reading the header again. */
export let source = (bucket: Bucket, key: string): Source => ({
  getKey: () => key,
  getBytes: async (offset, length, _signal, etag) => {
    let got = await bucket.get(key, { range: { offset, length } })
    if (!got) throw new Absent(key)
    if (etag && got.etag != etag) {
      throw new EtagMismatch(`maps: ${key} changed while it was read`)
    }
    return { data: await got.arrayBuffer(), etag: got.etag }
  },
})

// The archive's header and directories, kept as values (never promises): a
// promise one request left another hangs it on Workers. A range read with a
// stale header's etag reads the header again, but a directory kept from
// before a refresh can still say a tile is missing that the new archive has,
// so they are kept for an hour at most.
let PARTS_AGE = 3_600_000
let parts: { cache: Parts; at: number } = {
  cache: new ResolvedValueCache(64),
  at: 0,
}
let fresh = (now: number): Parts => {
  if (now - parts.at > PARTS_AGE) {
    parts = { cache: new ResolvedValueCache(64), at: now }
  }
  return parts.cache
}

/** What a path under the door names, or null for none. */
export type Asked =
  | { tile: [number, number, number] }
  | { tilejson: true }
  | { font: string }

/** Read a path under the door.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { asked } from '@yaks/maps/tiles'
 * assertEquals(asked('/14/9748/8172.mvt'), { tile: [14, 9748, 8172] })
 * assertEquals(asked('/tiles.json'), { tilejson: true })
 * assertEquals(asked('/fonts/Noto%20Sans%20Regular/0-255.pbf'), {
 *   font: 'Noto Sans Regular/0-255.pbf',
 * })
 * assertEquals(asked('/14/99999/1.mvt'), null)
 * assertEquals(asked('/fonts/../secret/0-255.pbf'), null)
 * ```
 */
export let asked = (path: string): Asked | null => {
  let t = path.match(/^\/(\d{1,2})\/(\d+)\/(\d+)\.mvt$/)
  if (t) {
    let [z, x, y] = [+t[1], +t[2], +t[3]]
    return z <= 26 && x < 2 ** z && y < 2 ** z ? { tile: [z, x, y] } : null
  }
  if (path == '/tiles.json') return { tilejson: true }
  let f = path.match(/^\/fonts\/([^/]+)\/(\d+-\d+)\.pbf$/)
  if (!f) return null
  let stack = decodeURIComponent(f[1])
  return /^[\w ,-]+$/.test(stack) ? { font: `${stack}/${f[2]}.pbf` } : null
}

/** What the door answers for a path under it, the mount already taken off. */
export let serve = async (
  req: Request,
  path: string,
  door: Door,
): Promise<Response> => {
  let what = asked(path)
  if (!what) return missing()
  if (req.method != 'GET' && req.method != 'HEAD') {
    return new Response(null, {
      status: 405,
      headers: { ...HEADERS, allow: 'GET, HEAD' },
    })
  }
  let { cache, retain } = door
  let key = new Request(req.url, { method: 'GET' })
  let hit = await cache?.match(key)
  if (hit) return hit
  let made = await make(what, door)
  if (cache && (made.status == 200 || made.status == 204)) {
    let kept = cache.put(key, made.clone())
    retain ? retain(kept) : await kept
  }
  return made
}

let make = (what: Asked, door: Door): Promise<Response> =>
  made(what, door).catch((e) => {
    if (!(e instanceof Absent)) throw e
    return new Response('The map archive is not here yet.\n', {
      status: 503,
      headers: {
        ...HEADERS,
        'content-type': 'text/plain; charset=utf-8',
        'retry-after': '3600',
      },
    })
  })

let made = async (what: Asked, door: Door): Promise<Response> => {
  let { provider, bucket, base } = door
  if ('font' in what) {
    if (!provider.glyphs) return missing()
    let got = await bucket.get(`${provider.glyphs}/${what.font}`)
    return got
      ? answer(await got.arrayBuffer(), 'application/x-protobuf', FONT_AGE)
      : missing()
  }
  if (!provider.archive) return missing()
  let archive = new PMTiles(
    source(bucket, provider.archive),
    fresh(Date.now()),
  )
  if ('tilejson' in what) {
    let json = await archive.getTileJson(base) as Record<string, unknown>
    return answer(
      JSON.stringify({ ...json, attribution: provider.attribution }),
      'application/json',
      TILE_AGE,
    )
  }
  let [z, x, y] = what.tile
  let tile = await archive.getZxy(z, x, y)
  return tile
    ? answer(tile.data, 'application/x-protobuf', TILE_AGE)
    : answer(null, 'application/x-protobuf', TILE_AGE, 204)
}
