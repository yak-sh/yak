// Where each creature of a level lives: for every den (beasts.ts) of a
// creature that suits the level's danger, and every place of the den's kind,
// or the share of them its odds pick (`dens`), homes picked around the place
// from the level's own numbers, where a creature can stand: in the level's
// region, dry, level, clear of trunks and rocks, and nearer that place than
// any place of another kind. A home on a traveled path moves into nearby open
// country. Picked on the smooth ground (terrain.ts `rise`), the homes are the
// same at every voxel size. The same list on every page, and each creature's
// eid is named by its den and its generated slot, so no page has to be told
// what another grew.
import { type Beast, BEASTS, type Den } from './beasts.ts'
import { PLANS } from './buildings.ts'
import { isA } from './features.ts'
import { hopsOf, type Level, levelOf, type Place } from './levels.ts'
import { hashOf, rand, uuidOf } from './rand.ts'
import { nearby, originOf, regionOf } from './regions.ts'
import { RADIUS, sheltered } from './sim.ts'
import { onFoot } from './solid.ts'
import { rise, SHORE, type Spot, steep, vale, wallsNear } from './terrain.ts'

/** A den at one place of a level: the place, by its name. */
export type DenAt = Den & { name: string; place: Place }

/** Whether a creature belongs in a land `hops` roads from home. A creature's
 * native level selects a habitat here; danger.ts gives each encounter its
 * level. A creature that can't be fought suits every land.
 *
 * ```ts
 * import { seedDesigns } from './designs_fixture.ts'
 * seedDesigns()
 * import { assertEquals } from '@std/assert'
 * import { beastOf } from './beasts.ts'
 * let at = (name: string, hops: number) => suits(beastOf(name)!, hops)
 * assertEquals(
 *   [at('beast:slime', 0), at('beast:slime', 6), at('beast:thornback', 0)],
 *   [true, false, true],
 * )
 * ```
 */
export let suits = (b: Beast, hops: number): boolean =>
  !b.combat || b.combat.lvl >= 2 * hops - 1 &&
    b.combat.lvl <= 2 * hops + 5 + (b.combat.boss ? 4 : 0)

/**
 * Every place of a level each creature lives around: for each den of a
 * creature that suits the level, each place of its kind, or the share of
 * them its odds pick, each by its own name. Only the level's rows are read,
 * so asking is cheap.
 *
 * ```ts
 * import { seedDesigns } from './designs_fixture.ts'
 * seedDesigns()
 * import { assertEquals } from '@std/assert'
 * import { beastId } from './beasts.ts'
 * import { LEVELS } from './levels.ts'
 * let where = (name: string) =>
 *   dens(LEVELS.mossvale).filter((d) => d.beast == beastId(name))
 *     .map((d) => d.name)
 * assertEquals(where('beast:thornback'), ['ridge'])
 * assertEquals(dens(LEVELS.mossvale), dens(LEVELS.mossvale))
 * ```
 */
export let dens = (lv: Level): DenAt[] =>
  Object.values(BEASTS).flatMap((beast) =>
    !suits(beast, lv.habitat ?? hopsOf(lv.id))
      ? []
      : beast.dens.flatMap((den) =>
        Object.entries(lv.places).flatMap(([name, place]) =>
          isA(place.kind, den.near) &&
            rand(hashOf(`${lv.id}/${den.eid}/${name}`), 7) < (den.odds ?? 1)
            ? [{ ...den, name, place }]
            : []
        )
      )
  )

export type Home = {
  eid: string
  /** the creature it is (beasts.ts) */
  beast: string
  /** the level it belongs to */
  level: string
  /** where it wanders from, in world metres */
  home: Spot
  /** how far it wanders, in metres */
  roam: number
  /** what its wandering is salted with */
  seed: number
  /** seconds from a fall until it is up again; never, without */
  respawn?: number
  /** the level it fights at, where its land does not decide it: a spawned
   * creature fights at its spawner's (spawn.ts) */
  lvl?: number
}

let listed = new Map<string, Home[]>()
let from = BEASTS
let buildings = PLANS

// Both caches are views of the creature index, so a new store answer gives
// each land fresh homes, including the levels already visited.
let refresh = () => {
  if (from == BEASTS && buildings == PLANS) return
  listed.clear()
  near = nearby(homesOf)
  from = BEASTS
  buildings = PLANS
}

/** Every creature a level grows, and where. */
export let homesOf = (id: string): Home[] => {
  refresh()
  let got = listed.get(id)
  if (got) return got
  let lv = levelOf(id)!, v = vale(), [ox, oz] = originOf(id)
  let blocked = (x: number, z: number) =>
    wallsNear(v, x, z).some((w) => Math.hypot(w.x - x, w.z - z) < w.r + 1.5)
  let places = Object.values(lv.places).map((p) => ({
    kind: p.kind,
    at: [ox + p.at[0], oz + p.at[1]],
  }))
  let belongs = (den: DenAt, x: number, z: number, extra = 0) => {
    let [px, pz] = [ox + den.place.at[0], oz + den.place.at[1]]
    let d = Math.hypot(x - px, z - pz)
    return d <= den.within + extra && d >= (den.beyond ?? 0) &&
      places.every((p) =>
        p.kind == den.place.kind || Math.hypot(x - p.at[0], z - p.at[1]) > d
      )
  }
  let out: Home[] = []
  let origin = new Map<string, DenAt>()
  let taken = new Map<string, Spot[]>()
  for (let den of dens(lv)) {
    let { beast, name, place } = den
    let mine = taken.get(beast) ?? []
    taken.set(beast, mine)
    let key = `${id}/${den.eid}/${name}`
    let salt = hashOf(key)
    let [px, pz] = [ox + place.at[0], oz + place.at[1]]
    let n = 0
    let r = den.within
    for (let tries = 0; n < den.count && tries < 4000; tries++) {
      let x = px + (rand(tries, salt, 1) * 2 - 1) * r
      let z = pz + (rand(tries, salt, 2) * 2 - 1) * r
      if (!belongs(den, x, z) || regionOf(x, z) != id) continue
      if (rise(x, z) <= SHORE || steep(rise, x, z) > 1) continue
      if (blocked(x, z)) continue
      if (mine.some(([a, b]) => Math.hypot(a - x, b - z) < den.apart)) {
        continue
      }
      mine.push([x, z])
      let eid = uuidOf(`${key}/${n++}`)
      origin.set(eid, den)
      out.push({
        eid,
        beast,
        level: id,
        home: [x, z],
        roam: den.roam,
        seed: hashOf(eid),
        respawn: den.respawn,
      })
    }
  }
  // Generate every slot before clearance, so moving one never changes
  // another creature's eid or its falls. A building still removes a home;
  // a traveled path moves it into nearby open country.
  let standing = out.filter((h) => !onFoot(v, ...h.home, RADIUS * 2))
  let clear = standing.filter((h) => !sheltered(v, ...h.home))
  let byEid = new Map(clear.map((h) => [h.eid, h]))
  for (let h of standing) {
    if (!sheltered(v, ...h.home)) continue
    let den = origin.get(h.eid)!, found: Spot | null = null
    let [px, pz] = [ox + den.place.at[0], oz + den.place.at[1]]
    for (let r = 4; r <= 24 && !found; r += 4) {
      for (let j = 0; j < 16; j++) {
        let a = (j + rand(h.seed, 9)) * Math.PI / 8
        let x = h.home[0] + Math.cos(a) * r
        let z = h.home[1] + Math.sin(a) * r
        let d = Math.hypot(x - px, z - pz)
        if (
          d > den.within + 24 || d < (den.beyond ?? 0) ||
          regionOf(x, z) != id
        ) continue
        if (sheltered(v, x, z) || rise(x, z) <= SHORE) continue
        if (steep(rise, x, z) > 1 || blocked(x, z)) continue
        if (onFoot(v, x, z, RADIUS * 2)) continue
        if (
          clear.some((c) =>
            c.beast == h.beast &&
            Math.hypot(c.home[0] - x, c.home[1] - z) < den.apart
          )
        ) continue
        found = [x, z]
        break
      }
    }
    if (found) {
      let moved = { ...h, home: found }
      clear.push(moved)
      byEid.set(h.eid, moved)
    }
  }
  let homes = standing.flatMap((h) => {
    let at = byEid.get(h.eid)
    return at ? [at] : []
  })
  if (listed.size >= 64) listed.delete(listed.keys().next().value!)
  listed.set(id, homes)
  return homes
}

// How far past its level's cell a creature may live, in metres: as far as a
// region reaches past its cell.
let PAST = 48

let near = nearby(homesOf)

/** The creatures that live within `r` metres of (x, z), as far as they are
 * found yet: the levels near are looked at one a call, nearest first. */
export let homesNear = (x: number, z: number, r: number): Home[] => {
  refresh()
  return near(x, z, r + PAST).filter((h) =>
    Math.hypot(h.home[0] - x, h.home[1] - z) < r
  )
}
