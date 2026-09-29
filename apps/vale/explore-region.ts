// Map the old twenty-metre cell discoveries onto whole world regions.
import type { Spot } from './levels.ts'
import { regionOf } from './regions.ts'

// The old map covered a circle around each cell. Sampling its edge keeps
// border ground discovered when those circles become whole regions.
export let regionsFromCells = (cells: Iterable<Spot>): Set<string> => {
  let ids = new Set<string>()
  for (let [x, z] of cells) {
    let cx = (x + 0.5) * 20, cz = (z + 0.5) * 20
    ids.add(regionOf(cx, cz))
    for (let i = 0; i < 16; i++) {
      let a = i * Math.PI / 8
      ids.add(regionOf(cx + 26 * Math.cos(a), cz + 26 * Math.sin(a)))
    }
  }
  return ids
}
