// Where a villager lives and works. Each standing point comes from furniture
// in a building the land placed, so moving a plot moves its people with it.
import { PLANS } from './buildings.ts'
import { STATIONS } from './craft.ts'
import type { Vec } from './mesh.ts'
import { type Giver, GIVERS } from './quests.ts'
import { spotOf } from './regions.ts'
import type { Building } from './solid.ts'
import { buildingOf, builtOf, groundAt, type Vale } from './terrain.ts'
import { fits, floorAt } from './sim.ts'

export type Life = { home: Vec; work?: Vec; inn?: Vec }

let houses = new Set(['cottage', 'house', 'farmhouse'])
let kindOf = (b: Building) => b.kind.split('.')[0]
let at = (b: Building, use: string) => b.uses.find((u) => u.for == use)?.at
let kept = new WeakMap<Vale, Map<string, Life>>()
let apart = (p: Vec, used: Vec[]) =>
  used.every((q) => Math.hypot(p[0] - q[0], p[2] - q[2]) >= 1.1)

// Try furnished places first, then a few nearby spots on the same floor.
let room = (v: Vale, places: Vec[], used: Vec[]): Vec | undefined => {
  let choices = [...places]
  for (let [x, y, z] of places) {
    for (let r of [0.5, 1, 1.5, 2.5, 3.5, 5, 7, 9, 11]) {
      for (let n = 0; n < 16; n++) {
        let a = n * Math.PI / 8
        let px = x + r * Math.cos(a), pz = z + r * Math.sin(a)
        choices.push([px, floorAt(v, px, pz, y), pz])
      }
    }
  }
  return choices.find((p) => apart(p, used) && fits(v, p[0], p[2], p[1]))
}

/** The places a villager has in their own village. A person living beyond a
 * village stays at their story's place until that place has buildings. */
export let lifeOf = (g: Giver, v: Vale): Life => {
  let cache = kept.get(v)
  if (!cache) kept.set(v, cache = new Map())
  let found = cache.get(g.id)
  if (found) return found
  let prior = GIVERS.slice(0, GIVERS.indexOf(g))
    .filter((n) => n.level == g.level).map((n) => lifeOf(n, v))
  let [cx, cz] = spotOf(g.level, g.place) ?? [0, 0]
  let near = builtOf(g.level).flatMap((p) => {
    let b = buildingOf(v, p)
    return b && Math.hypot(b.x - cx, b.z - cz) < 42 ? [b] : []
  })
  let beds = near.filter((b) => houses.has(kindOf(b)))
    .flatMap((b) => b.uses.filter((u) => u.for == 'sleep').map((u) => u.at))
  let workshop = g.work
    ? near.find((b) => PLANS[kindOf(b)]?.works == g.work)
    : undefined
  let use = workshop?.uses.find((u) =>
    u.for == 'work' || u.for == 'trade' || u.for == 'meet'
  )
  let work = use?.at
  if (work && workshop && g.work) {
    let station = workshop.stations.find((s) =>
      Math.hypot(s.x - work![0], s.z - work![2]) < 2 &&
      Math.abs(s.y - work![1]) < 2
    )
    if (station) {
      // Stand to one side of the place where a hero uses the station.
      let dx = work[0] - station.x, dz = work[2] - station.z
      let span = Math.hypot(dx, dz)
      if (span) {
        for (let side of [1, -1]) {
          let x = work[0] + side * dz / span * 1.4
          let z = work[2] - side * dx / span * 1.4
          if (
            fits(v, x, z, work[1]) &&
            Math.hypot(x - station.x, z - station.z) <
              STATIONS[station.craft].reach
          ) {
            work = [x, work[1], z]
            break
          }
        }
      }
    }
  }
  let resident = GIVERS.filter((n) => n.level == g.level && n.place == g.place)
    .findIndex((n) => n.id == g.id)
  let ownBed = workshop && at(workshop, 'sleep')
  let ordered = beds.length
    ? [
      ...beds.slice(resident % beds.length),
      ...beds.slice(0, resident % beds.length),
    ]
    : []
  let fallback: Vec = [
    cx + g.offset[0],
    groundAt(v, cx + g.offset[0], cz + g.offset[1]),
    cz + g.offset[1],
  ]
  let inn = near.find((b) => kindOf(b) == 'inn')
  let seats = inn?.uses.filter((u) => u.for == 'sit').map((u) => u.at) ?? []
  let seat = room(v, seats, prior.flatMap((p) => p.inn ? [p.inn] : []))
  let life: Life = {
    home: room(
      v,
      [...ownBed ? [ownBed] : [], ...ordered, fallback],
      prior.map((p) => p.home),
    ) ?? fallback,
    ...work ? { work } : {},
    ...seat ? { inn: seat } : {},
  }
  cache.set(g.id, life)
  return life
}
