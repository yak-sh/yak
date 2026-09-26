// Where each creature of a level lives: for every kind (beasts.ts) and every
// place of the kind it haunts, homes picked around the place from the level's
// own numbers, where a creature can stand: dry, level, clear of trunks and
// rocks, and nearer that place than any place of another kind. Picked on the
// level's smooth ground (terrain.ts `rise`), so the homes are the same at
// every voxel size. The same list on every page, and each creature's eid is
// named by where it lives, so no page has to be told what another grew.
import { BEASTS } from './beasts.ts'
import { hashOf, rand, uuidOf } from './rand.ts'
import { wallsNear } from './sim.ts'
import { rise, SHORE, SIZE, type Spot, steep, type Vale } from './terrain.ts'

export type Home = {
  eid: string
  kind: string
  /** where it wanders from, in metres */
  home: Spot
  /** how far it wanders, in metres */
  roam: number
  /** what its wandering is salted with */
  seed: number
}

let listed = new WeakMap<Vale, Home[]>()

/** Every creature a level grows, and where. */
export let homesOf = (v: Vale): Home[] => {
  let got = listed.get(v)
  if (got) return got
  let height = rise(v.level)
  let blocked = (x: number, z: number) =>
    wallsNear(v, x, z).some((w) => Math.hypot(w.x - x, w.z - z) < w.r + 1.5)
  let places = Object.entries(v.level.places)
  let out: Home[] = []
  for (let [kind, beast] of Object.entries(BEASTS)) {
    let mine: Spot[] = []
    for (let haunt of beast.haunts) {
      for (let [name, place] of places) {
        if (place.kind != haunt.near) continue
        let key = `${v.level.id}/${kind}/${name}`
        let salt = hashOf(key)
        let own = (x: number, z: number) => {
          let d = Math.hypot(x - place.at[0], z - place.at[1])
          return d <= haunt.within && d >= (haunt.beyond ?? 0) &&
            places.every(([, p]) =>
              p.kind == place.kind ||
              Math.hypot(x - p.at[0], z - p.at[1]) > d
            )
        }
        let n = 0
        let r = haunt.within
        for (let tries = 0; n < haunt.count && tries < 4000; tries++) {
          let x = place.at[0] + (rand(tries, salt, 1) * 2 - 1) * r
          let z = place.at[1] + (rand(tries, salt, 2) * 2 - 1) * r
          if (x < 4 || z < 4 || x > SIZE - 4 || z > SIZE - 4 || !own(x, z)) {
            continue
          }
          if (height(x, z) <= SHORE || steep(height, x, z) > 1) continue
          if (blocked(x, z)) continue
          if (mine.some(([a, b]) => Math.hypot(a - x, b - z) < haunt.apart)) {
            continue
          }
          mine.push([x, z])
          let eid = uuidOf(`${key}/${n++}`)
          out.push({
            eid,
            kind,
            home: [x, z],
            roam: haunt.roam,
            seed: hashOf(eid),
          })
        }
      }
    }
  }
  listed.set(v, out)
  return out
}
