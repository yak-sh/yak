import { assertEquals } from '@std/assert'
import { type Kept, serve } from './tiles.ts'
import { archive, bucket, unique } from './testing.ts'
import type { Tiles } from './providers.ts'

let kept = (): Kept & { size: () => number } => {
  let held = new Map<string, Response>()
  return {
    size: () => held.size,
    match: (req) => Promise.resolve(held.get(req.url)?.clone()),
    put: (req, res) => Promise.resolve(void held.set(req.url, res)),
  }
}

let provider: Tiles = {
  name: 'test',
  title: 'Test',
  glyphs: 'fonts',
  attribution: '© OpenStreetMap',
  max_zoom: 15,
}
let BASE = 'https://yaks.app/maps'
let ask = (path: string, door: Parameters<typeof serve>[2], method = 'GET') =>
  serve(new Request(`${BASE}${path}`, { method }), path, door)

// Each test its own archive key: the door keeps an archive's directories by
// key and etag for the isolate.
let setup = (tiles: Record<string, string>) => {
  let b = bucket({
    'fonts/Noto Sans Regular/0-255.pbf': new Uint8Array([1, 2, 3]),
  })
  let key = unique('planet')
  b.put(key, archive(tiles))
  let cache = kept()
  let door = {
    provider: { ...provider, archive: key },
    bucket: b,
    base: BASE,
    cache,
  }
  return { b, key, cache, door }
}

Deno.test('a tile is read from the archive once, then from the cache', async () => {
  let { b, cache, door } = setup({ '14/9748/8172': 'kampala', '0/0/0': 'all' })
  let res = await ask('/14/9748/8172.mvt', door)
  assertEquals(res.status, 200)
  assertEquals(await res.text(), 'kampala')
  assertEquals(res.headers.get('access-control-allow-origin'), '*')
  let reads = b.reads
  assertEquals(await (await ask('/14/9748/8172.mvt', door)).text(), 'kampala')
  assertEquals(b.reads, reads)
  assertEquals(cache.size(), 1)
})

Deno.test('a tile the archive lacks is empty', async () => {
  let { door } = setup({ '0/0/0': 'all' })
  assertEquals((await ask('/3/1/1.mvt', door)).status, 204)
})

Deno.test('TileJSON names the door and the provider', async () => {
  let { door } = setup({ '0/0/0': 'all' })
  let json = await (await ask('/tiles.json', door)).json()
  assertEquals(json.tiles, [`${BASE}/{z}/{x}/{y}.mvt`])
  assertEquals(json.attribution, '© OpenStreetMap')
  assertEquals(json.vector_layers, [{ id: 'earth' }])
  assertEquals([json.minzoom, json.maxzoom], [0, 15])
})

Deno.test('a font range is read from the glyphs', async () => {
  let { door } = setup({ '0/0/0': 'all' })
  let res = await ask('/fonts/Noto%20Sans%20Regular/0-255.pbf', door)
  assertEquals(
    new Uint8Array(await res.arrayBuffer()),
    new Uint8Array([1, 2, 3]),
  )
  assertEquals(
    (await ask('/fonts/Noto%20Sans%20Bold/0-255.pbf', door)).status,
    404,
  )
})

Deno.test('a refreshed archive is read again', async () => {
  let { b, key, door } = setup({ '1/0/0': 'old' })
  assertEquals(await (await ask('/1/0/0.mvt', door)).text(), 'old')
  b.put(key, archive({ '0/0/0': 'pad', '1/1/1': 'x', '1/0/0': 'new' }))
  let fresh = { ...door, cache: kept() }
  assertEquals(await (await ask('/1/0/0.mvt', fresh)).text(), 'new')
})

Deno.test('anything else is refused', async () => {
  let { door } = setup({ '0/0/0': 'all' })
  assertEquals((await ask('/style.json', door)).status, 404)
  assertEquals((await ask('/1/5/0.mvt', door)).status, 404)
  assertEquals((await ask('/0/0/0.mvt', door, 'POST')).status, 405)
})

Deno.test('an archive not copied in yet answers 503, kept by nobody', async () => {
  let { cache, door } = setup({ '0/0/0': 'all' })
  let none = {
    ...door,
    provider: { ...door.provider, archive: 'later.pmtiles' },
  }
  for (let path of ['/tiles.json', '/0/0/0.mvt']) {
    assertEquals((await ask(path, none)).status, 503)
  }
  assertEquals(cache.size(), 0)
})
