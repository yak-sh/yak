// Where a villager lives and works. Each standing point comes from furniture
// in a building the land placed, so moving a plot moves its people with it.
import { PLANS } from './buildings.ts'
import type { Vec } from './mesh.ts'
import { type Giver, GIVERS } from './quests.ts'
import { spotOf } from './regions.ts'
import type { Building } from './solid.ts'
import { buildingOf, builtOf, groundAt, type Vale } from './terrain.ts'

export type Life = { home: Vec; work?: Vec; inn?: Vec }

let houses = new Set(['cottage', 'house', 'farmhouse'])
let kindOf = (b: Building) => b.kind.split('.')[0]
let at = (b: Building, use: string) => b.uses.find((u) => u.for == use)?.at
let kept = new WeakMap<Vale, Map<string, Life>>()

/** The places a villager has in their own village. A person living beyond a
 * village stays at their story's place until that place has buildings. */
export let lifeOf = (g: Giver, v: Vale): Life => {
  let cache = kept.get(v)
  if (!cache) kept.set(v, cache = new Map())
  let found = cache.get(g.id)
  if (found) return found
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
  let work = workshop?.uses.find((u) =>
    u.for == 'work' || u.for == 'trade' || u.for == 'meet'
  )?.at
  let resident = GIVERS.filter((n) => n.level == g.level && n.place == g.place)
    .findIndex((n) => n.id == g.id)
  let home = (workshop && at(workshop, 'sleep')) ?? beds[resident % beds.length]
  let fallback: Vec = [
    cx + g.offset[0],
    groundAt(v, cx + g.offset[0], cz + g.offset[1]),
    cz + g.offset[1],
  ]
  let inn = near.find((b) => kindOf(b) == 'inn')
  let seat = inn && at(inn, 'sit')
  let life: Life = {
    home: home ?? fallback,
    ...work ? { work } : {},
    ...seat ? { inn: seat } : {},
  }
  cache.set(g.id, life)
  return life
}
