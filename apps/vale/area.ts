// A world row's region and chunk, and the small rectangle of rows a page
// watches. A chunk has one numeric key (terrain.ts); its two indices make a
// rectangle a short indexed query instead of a long list of chunk keys.
import { levelsNear, regionOf } from './regions.ts'
import { CHUNK, chunkKey, chunkOf } from './terrain.ts'

/** How far from a hero the page reads world rows, including gatherings. */
export let REACH = 120

/** The region and chunk a world point belongs to. */
export let placeOf = (x: number, z: number) => {
  let ci = chunkOf(x), ck = chunkOf(z)
  return { level: regionOf(x, z), chunk: chunkKey(ci, ck), ci, ck }
}

/** A rectangle that contains every chunk within `r` of the page's chunk.
 * The player branch follows relayed positions; the stored-row branch uses
 * indexed places. @yaks/api moves a player into and out of the result as its
 * relayed position moves.
 */
export let areaOf = (x: number, z: number, r: number) => {
  let ci = chunkOf(x), ck = chunkOf(z), n = Math.ceil(r / CHUNK)
  let [i, j] = [ci - n, ci + n], [k, l] = [ck - n, ck + n]
  let levels = levelsNear((ci + 0.5) * CHUNK, (ck + 0.5) * CHUNK, r + 64)
  if (!levels.length) levels = [regionOf(x, z)]
  let region = `.place.level=${levels.join(',')}`
  let stored = `${region}&.place.ci=${i}..${j}&.place.ck=${k}..${l}`
  let players = `.player&.position.x=${i * CHUNK}...${(j + 1) * CHUNK}` +
    `&.position.z=${k * CHUNK}...${(l + 1) * CHUNK}`
  return { key: chunkKey(ci, ck), query: `(${stored}|${players})&*` }
}
