// yaks.app's map door: `/maps/` on the apex serves the tiles and fonts every
// app's maps draw from, out of the MAPS bucket (maps.ts, @yaks/maps/tiles).
import { equal, test } from '@yaks/testing'
import { archive, bucket } from '@yaks/maps/testing'
import { TILES_DEFAULT } from '@yaks/maps/providers'
import { answer } from './apex.ts'
import type { Env } from './env.ts'

let MAPS = bucket()
MAPS.put(TILES_DEFAULT.archive!, archive({ '0/0/0': 'earth' }))
MAPS.put(
  `${TILES_DEFAULT.glyphs}/Noto Sans Regular/0-255.pbf`,
  new Uint8Array([7]),
)
let at = (path: string, env = { MAPS } as unknown as Env) =>
  answer(new Request(`https://yaks.app${path}`), env, path)

test('the apex serves map tiles, TileJSON and fonts from the bucket', async () => {
  let tile = await at('/maps/0/0/0.mvt')
  equal([tile.status, await tile.text()], [200, 'earth'])
  equal(tile.headers.get('access-control-allow-origin'), '*')
  let json = await (await at('/maps/tiles.json')).json()
  equal(json.tiles, ['https://yaks.app/maps/{z}/{x}/{y}.mvt'])
  let font = await at('/maps/fonts/Noto%20Sans%20Regular/0-255.pbf')
  equal(new Uint8Array(await font.arrayBuffer()), new Uint8Array([7]))
  equal((await at('/maps/nothing')).status, 404)
})
