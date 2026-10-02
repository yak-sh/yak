// Exploration follows irregular regions, independent of map scale. Keep the
// region names under each chart so panning only checks the explored set.
import { SIZE, type Spot } from './levels.ts'
import { CHUNK } from './terrain.ts'
import { pairKey, regionCandidates, regionOf } from './regions.ts'

let overlaps = (ids: ReadonlySet<string>, known: ReadonlySet<string>) => {
  for (let id of ids) if (known.has(id)) return true
  return false
}

export let coverage = (sample = regionOf) => {
  let kept = new Map<number, { regions: Set<string>; next: number }>()
  let sheets = new Map<number, Set<string>>()
  let chunks = new Map<number, Set<string>>()
  let visible = ([ci, ck]: Spot, known: ReadonlySet<string>) => {
    if (!known.size) return false
    let key = pairKey(ci, ck), got = kept.get(key)
    if (got && overlaps(got.regions, known)) return true
    if (got?.next == CHUNK * CHUNK) return false
    let gx = Math.floor(ci * CHUNK / SIZE), gz = Math.floor(ck * CHUNK / SIZE)
    let sheet = pairKey(gx, gz), candidates = sheets.get(sheet)
    if (!candidates) {
      candidates = regionCandidates(gx * SIZE, gz * SIZE, SIZE)
      sheets.set(sheet, candidates)
    }
    if (!overlaps(candidates, known)) return false
    if (!got) {
      let possible = chunks.get(key)
      if (!possible) {
        possible = regionCandidates(ci * CHUNK, ck * CHUNK, CHUNK)
        chunks.set(key, possible)
      }
      if (!overlaps(possible, known)) return false
      got = { regions: new Set<string>(), next: 0 }
      kept.set(key, got)
    }
    // One explored point is enough to request the chunk. If a different
    // region is explored later, resume the scan without sampling twice.
    while (got.next < CHUNK * CHUNK) {
      let at = got.next++
      let id = sample(
        ci * CHUNK + at % CHUNK + 0.5,
        ck * CHUNK + Math.floor(at / CHUNK) + 0.5,
      )
      got.regions.add(id)
      if (known.has(id)) return true
    }
    return false
  }
  return Object.assign(visible, {
    keep: (cell: Spot, ids: Iterable<string>) => {
      kept.set(pairKey(...cell), {
        regions: new Set(ids),
        next: CHUNK * CHUNK,
      })
    },
    clear: () => {
      kept.clear()
      sheets.clear()
      chunks.clear()
    },
  })
}
