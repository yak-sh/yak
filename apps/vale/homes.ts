// Where each creature of a level lives: for every kind (beasts.ts) that suits
// the level's danger, and every place of the kind it haunts, or the share of
// them its odds pick (`dens`), homes picked around the place from the level's
// own numbers, where a creature can stand: in the level's region, dry, level,
// clear of trunks and rocks, and nearer that place than any place of another
// kind. A home on a traveled path moves into nearby open country. Picked on
// the smooth ground (terrain.ts `rise`), the homes are the same at every voxel
// size. The same list on every page, and each creature's eid is named by its
// generated slot, so no page has to be told what another grew.
import { type Beast, BEASTS, type Haunt } from './beasts.ts'
import { isA } from './features.ts'
import { hopsOf, type Level, levelOf, type Place } from './levels.ts'
import { hashOf, rand, uuidOf } from './rand.ts'
import { nearby, originOf, regionOf } from './regions.ts'
import { RADIUS, sheltered } from './sim.ts'
import { onFoot } from './solid.ts'
import { rise, SHORE, type Spot, steep, vale, wallsNear } from './terrain.ts'

/** A place of a level a kind of creature lives around, by one of its
 * haunts. */
export type Den = { kind: string; haunt: Haunt; name: string; place: Place }

/** Whether a species belongs in a land `hops` roads from home. Its native
 * level selects a habitat here; danger.ts gives each encounter its level.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { BEASTS } from './beasts.ts'
 * let at = (kind: string, hops: number) => suits(BEASTS[kind], hops)
 * assertEquals([at('slime', 0), at('slime', 6), at('thornback', 0)], [
 *   true,
 *   false,
 *   true,
 * ])
 * ```
 */
export let suits = (b: Beast, hops: number): boolean =>
  b.lvl >= 2 * hops - 1 && b.lvl <= 2 * hops + 5 + (b.boss ? 4 : 0)

/**
 * Every place of a level each kind of creature lives around: for each kind
 * that suits the level, each place of a kind it haunts, or the share of them
 * its odds pick, each by its own name. Only the level's rows are read, so
 * asking is cheap.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { LEVELS } from './levels.ts'
 * let where = (kind: string) =>
 *   dens(LEVELS.mossvale).filter((d) => d.kind == kind).map((d) => d.name)
 * assertEquals(where('thornback'), ['ridge'])
 * assertEquals(dens(LEVELS.mossvale), dens(LEVELS.mossvale))
 * ```
 */
export let dens = (lv: Level): Den[] =>
  Object.entries(BEASTS).flatMap(([kind, beast]) =>
    !suits(beast, lv.habitat ?? hopsOf(lv.id))
      ? []
      : beast.haunts.flatMap((haunt) =>
        Object.entries(lv.places).flatMap(([name, place]) =>
          isA(place.kind, haunt.near) &&
            rand(hashOf(`${lv.id}/${kind}/${name}`), 7) < (haunt.odds ?? 1)
            ? [{ kind, haunt, name, place }]
            : []
        )
      )
  )

export type Home = {
  eid: string
  kind: string
  /** the level it belongs to */
  level: string
  /** where it wanders from, in world metres */
  home: Spot
  /** how far it wanders, in metres */
  roam: number
  /** what its wandering is salted with */
  seed: number
}

let listed = new Map<string, Home[]>()

/** Every creature a level grows, and where. */
export let homesOf = (id: string): Home[] => {
  let got = listed.get(id)
  if (got) return got
  let lv = levelOf(id)!, v = vale(), [ox, oz] = originOf(id)
  let blocked = (x: number, z: number) =>
    wallsNear(v, x, z).some((w) => Math.hypot(w.x - x, w.z - z) < w.r + 1.5)
  let places = Object.values(lv.places).map((p) => ({
    kind: p.kind,
    at: [ox + p.at[0], oz + p.at[1]],
  }))
  let belongs = (den: Den, x: number, z: number, extra = 0) => {
    let [px, pz] = [ox + den.place.at[0], oz + den.place.at[1]]
    let d = Math.hypot(x - px, z - pz)
    return d <= den.haunt.within + extra && d >= (den.haunt.beyond ?? 0) &&
      places.every((p) =>
        p.kind == den.place.kind || Math.hypot(x - p.at[0], z - p.at[1]) > d
      )
  }
  let out: Home[] = []
  let origin = new Map<string, Den>()
  let taken = new Map<string, Spot[]>()
  for (let den of dens(lv)) {
    let { kind, haunt, name, place } = den
    let mine = taken.get(kind) ?? []
    taken.set(kind, mine)
    let key = `${id}/${kind}/${name}`
    let salt = hashOf(key)
    let [px, pz] = [ox + place.at[0], oz + place.at[1]]
    let n = 0
    let r = haunt.within
    for (let tries = 0; n < haunt.count && tries < 4000; tries++) {
      let x = px + (rand(tries, salt, 1) * 2 - 1) * r
      let z = pz + (rand(tries, salt, 2) * 2 - 1) * r
      if (!belongs(den, x, z) || regionOf(x, z) != id) continue
      if (rise(x, z) <= SHORE || steep(rise, x, z) > 1) continue
      if (blocked(x, z)) continue
      if (mine.some(([a, b]) => Math.hypot(a - x, b - z) < haunt.apart)) {
        continue
      }
      mine.push([x, z])
      let eid = uuidOf(`${key}/${n++}`)
      origin.set(eid, den)
      out.push({
        eid,
        kind,
        level: id,
        home: [x, z],
        roam: haunt.roam,
        seed: hashOf(eid),
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
          d > den.haunt.within + 24 || d < (den.haunt.beyond ?? 0) ||
          regionOf(x, z) != id
        ) continue
        if (sheltered(v, x, z) || rise(x, z) <= SHORE) continue
        if (steep(rise, x, z) > 1 || blocked(x, z)) continue
        if (onFoot(v, x, z, RADIUS * 2)) continue
        if (
          clear.some((c) =>
            c.kind == h.kind &&
            Math.hypot(c.home[0] - x, c.home[1] - z) < den.haunt.apart
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
export let homesNear = (x: number, z: number, r: number): Home[] =>
  near(x, z, r + PAST).filter((h) =>
    Math.hypot(h.home[0] - x, h.home[1] - z) < r
  )
