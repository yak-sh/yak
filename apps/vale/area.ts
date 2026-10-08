// A world row's region and chunk, and the rectangle of rows a page watches.
// A chunk has one numeric key (terrain.ts): a tile's few chunks are one short
// indexed list of keys, and its two indices make the whole rectangle one
// query for the page's own graph.
import { levelsNear, regionOf } from './regions.ts'
import { CHUNK, chunkKey, chunkOf } from './terrain.ts'

/** How far from a hero the page reads world rows, including gatherings. */
export let REACH = 120

/** The region and chunk a world point belongs to. */
export let placeOf = (x: number, z: number) => {
  let ci = chunkOf(x), ck = chunkOf(z)
  return { level: regionOf(x, z), chunk: chunkKey(ci, ck), ci, ck }
}

/** Chunks on a side of a tile: the square of stored world rows one watch
 * holds. */
export let TILE = 4

/** A rectangle of whole tiles that contains every chunk within `r` of any
 * chunk in the page's tile, so it moves only when the page enters another
 * tile. Stored world rows are watched a tile at a time (`tiles`), so a page
 * walking on asks only for the tiles it enters, never again for the ones it
 * keeps; its `query` says the same rectangle in one, for the page's own graph.
 * Players and creatures enter by their relayed positions (`moving`). @yaks/api
 * moves them into and out of the result as they move, even when a creature
 * has no stored row.
 */
export let areaOf = (x: number, z: number, r: number) => {
  let ti = tileOf(chunkOf(x)), tk = tileOf(chunkOf(z))
  let m = Math.ceil(Math.ceil(r / CHUNK) / TILE)
  let [i, j] = [(ti - m) * TILE, (ti + m + 1) * TILE - 1]
  let [k, l] = [(tk - m) * TILE, (tk + m + 1) * TILE - 1]
  let half = (j + 1 - i) * CHUNK / 2
  let levels = levelsNear(i * CHUNK + half, k * CHUNK + half, half + 64)
  if (!levels.length) levels = [regionOf(x, z)]
  let region = `.place.level=${levels.join(',')}`
  let stored = `${region}&.place.ci=${i}..${j}&.place.ck=${k}..${l}`
  let moving = (path: string) =>
    `${path}.x=${i * CHUNK}...${(j + 1) * CHUNK}` +
    `&${path}.z=${k * CHUNK}...${(l + 1) * CHUNK}`
  let tiles = []
  for (let a = ti - m; a <= ti + m; a++) {
    for (let b = tk - m; b <= tk + m; b++) {
      let chunks = []
      for (let c = a * TILE; c < (a + 1) * TILE; c++) {
        for (let d = b * TILE; d < (b + 1) * TILE; d++) {
          chunks.push(chunkKey(c, d))
        }
      }
      tiles.push({ key: chunkKey(a, b), query: `.place.chunk=${chunks}&*` })
    }
  }
  return {
    key: chunkKey(ti, tk),
    query: `(${stored}|${moving('.position')})&*`,
    tiles,
    moving: `${moving('.position')}&*`,
    looks: moving('.look.player.position'),
  }
}

let tileOf = (chunk: number) => Math.floor(chunk / TILE)

/** Look rows for the heroes whose positions reach this area, plus this tab's
 * hero even before its first position is relayed. */
export let looksOf = (area: ReturnType<typeof areaOf>, hero?: string) =>
  `(${area.looks}${
    hero ? `|.look.player=${JSON.stringify(hero)}` : ''
  })&.look&*`
