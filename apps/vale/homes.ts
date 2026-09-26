// Where each creature of a level lives: for every kind (beasts.ts) and every
// place of the kind it haunts, homes picked around the place from the level's
// own numbers, where a creature can stand: dry, level, clear of trunks and
// rocks, and nearer that place than any place of another kind. The same list
// on every page, and each creature's eid is named by where it lives, so no
// page has to be told what another grew.
import { BEASTS } from './beasts.ts'
import { hashOf, rand, uuidOf } from './rand.ts'
import { wallsNear } from './sim.ts'
import { N, SEA, type Spot, spot, type Vale } from './terrain.ts'

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
  let at = (i: number, k: number) => i + k * N
  let slope = (i: number, k: number) => {
    let c = v.h[at(i, k)]
    return Math.max(
      ...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) =>
        Math.abs(v.h[at(i + a, k + b)] - c)
      ),
    )
  }
  let blocked = (i: number, k: number) => {
    let [x, z] = spot([i, k])
    return wallsNear(v, x, z).some((w) =>
      Math.hypot(w.x - x, w.z - z) < w.r + 1.5
    )
  }
  let places = Object.entries(v.level.places)
  let out: Home[] = []
  for (let [kind, beast] of Object.entries(BEASTS)) {
    let mine: Spot[] = []
    for (let haunt of beast.haunts) {
      for (let [name, place] of places) {
        if (place.kind != haunt.near) continue
        let key = `${v.level.id}/${kind}/${name}`
        let salt = hashOf(key)
        let own = (i: number, k: number) => {
          let d = Math.hypot(i - place.at[0], k - place.at[1])
          return d <= haunt.within && d >= (haunt.beyond ?? 0) &&
            places.every(([, p]) =>
              p.kind == place.kind ||
              Math.hypot(i - p.at[0], k - p.at[1]) > d
            )
        }
        let n = 0
        let r = haunt.within
        for (let tries = 0; n < haunt.count && tries < 4000; tries++) {
          let i = Math.round(place.at[0] + (rand(tries, salt, 1) * 2 - 1) * r)
          let k = Math.round(place.at[1] + (rand(tries, salt, 2) * 2 - 1) * r)
          if (i < 8 || k < 8 || i >= N - 8 || k >= N - 8 || !own(i, k)) continue
          if (v.h[at(i, k)] <= SEA + 1 || slope(i, k) > 1 || blocked(i, k)) {
            continue
          }
          if (mine.some(([a, b]) => Math.hypot(a - i, b - k) < haunt.apart)) {
            continue
          }
          mine.push([i, k])
          let eid = uuidOf(`${key}/${n++}`)
          out.push({
            eid,
            kind,
            home: spot([i, k]),
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
