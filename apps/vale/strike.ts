// How a blow finds its foe. A blow is aimed as it is asked for: the hero
// turns toward the nearest creature before them, forgivingly, or, with a
// weapon that shoots, toward the one they are fighting while it is in range.
// It lands a moment into the swing (`LAND`) on the nearest creature then in
// its reach and arc (gear.ts `Kit`); a shot is loosed then at the creature it
// was aimed at, and lands when it gets there (`FLIGHT`). An ability is aimed
// the same way, and takes what its shape covers (`takenBy`).
import type { Ability } from './abilities.ts'
import { BEASTS } from './beasts.ts'
import type { Kit } from './gear.ts'

/** A creature, as far as a blow cares: where it is, and how near. */
export type Mark = {
  eid: string
  kind: string
  down: boolean
  /** metres, middle to middle */
  near: number
  body: { x: number; z: number }
}

type Me = { x: number; z: number; yaw: number }

/** How far through a swing it lands, or is loosed. */
export let LAND = 0.33

/** How fast a shot flies, in metres a second. */
export let FLIGHT = { arrow: 30, bolt: 18 }

// How far either side of ahead a blow is still aimed: the hero turns this far
// to face it.
let TURN = 1.9
// How far a sweep reaches with a weapon that shoots: the arm's length.
let HAND = 1.4

let size = (m: Mark) => BEASTS[m.kind]?.size ?? 1
let off = (me: Me, m: Mark) => {
  let a = Math.atan2(m.body.x - me.x, m.body.z - me.z)
  return Math.abs(Math.atan2(Math.sin(a - me.yaw), Math.cos(a - me.yaw)))
}
let nearest = (ms: Mark[]) =>
  ms.reduce<Mark | null>((b, m) => !b || m.near < b.near ? m : b, null)

/** The creature a blow is aimed at as it is asked for, or none: for a weapon
 * that shoots, the one being fought, while in range. `far` reaches further,
 * for an ability that does.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { HANDLES } from './arms.ts'
 * let at = (eid: string, x: number, z: number) =>
 *   ({ eid, kind: 'slime', down: false, near: Math.hypot(x, z), body: { x, z } })
 * let me = { x: 0, z: 0, yaw: 0 }
 * let mobs = [at('near', 0, 2), at('far', 0, 9), at('behind', 0, -1.5)]
 * let kit = (family: string) => ({ ...HANDLES[family], family } as never)
 * assertEquals(aimOf(mobs, me, kit('sword'))?.eid, 'near')
 * assertEquals(aimOf(mobs, me, kit('bow'), 'far')?.eid, 'far')
 * assertEquals(aimOf(mobs.slice(1, 2), me, kit('sword')), null)
 * assertEquals(aimOf(mobs.slice(1, 2), me, kit('sword'), '', 6)?.eid, 'far')
 * ```
 */
export let aimOf = <M extends Mark>(
  mobs: M[],
  me: Me,
  kit: Kit,
  foe = '',
  far = 0,
): M | null => {
  let reach = (m: Mark) =>
    far + (kit.shot ? kit.reach + size(m) : 0.7 + kit.reach + size(m))
  let live = mobs.filter((m) =>
    !m.down && m.near <= reach(m) && off(me, m) <= TURN
  )
  return (kit.shot && live.find((m) => m.eid == foe)) ||
    nearest(live) as M | null
}

/** The creature a blow lands on, or none: the nearest in its reach and
 * arc, or one close enough to touch; a shot flies at the one it was aimed
 * at, while it is still up and about in range. */
export let landOf = <M extends Mark>(
  mobs: M[],
  me: Me,
  kit: Kit,
  aimed = '',
): M | null => {
  if (kit.shot) {
    let m = mobs.find((m) => m.eid == aimed)
    if (m && !m.down && m.near <= kit.reach + size(m) + 1) return m
  }
  let reach = (m: Mark) =>
    kit.shot ? kit.reach + size(m) : kit.reach + size(m) * 0.5
  return nearest(
    mobs.filter((m) =>
      !m.down && m.near <= reach(m) && (off(me, m) <= kit.arc || m.near <= 1)
    ),
  ) as M | null
}

/** What an ability takes as it lands: for `one`, the creature it was aimed
 * at, while it is still in reach; for an `arc`, everything in reach before
 * the hero; for a `ring`, everything about them; for a `burst`, the creature
 * aimed at and everything about it; for `self`, nothing.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { ABILITIES } from './abilities.ts'
 * import { HANDLES } from './arms.ts'
 * let at = (eid: string, x: number, z: number) =>
 *   ({ eid, kind: 'slime', down: false, near: Math.hypot(x, z), body: { x, z } })
 * let me = { x: 0, z: 0, yaw: 0 }
 * let mobs = [at('ahead', 0, 2), at('left', 2, 0.5), at('behind', 0, -2), at('far', 0, 9)]
 * let kit = (family: string) => ({ ...HANDLES[family], family } as never)
 * let takes = (id: string, family: string, aimed = mobs[0]) =>
 *   takenBy(ABILITIES[id], mobs, me, kit(family), aimed).map((m) => m.eid)
 * assertEquals(takes('cleave', 'sword'), ['ahead', 'left'])
 * assertEquals(takes('whirl', 'axe'), ['ahead', 'left', 'behind'])
 * assertEquals(takes('crush', 'hammer'), ['ahead'])
 * assertEquals(takes('crush', 'hammer', mobs[3]), [])
 * assertEquals(takes('volley', 'bow', mobs[3]), ['far'])
 * assertEquals(takes('ward', 'staff'), [])
 * ```
 */
export let takenBy = <M extends Mark>(
  a: Ability,
  mobs: M[],
  me: Me,
  kit: Kit,
  aimed: M | null,
): M[] => {
  let live = mobs.filter((m) => !m.down)
  let far = a.far ?? 0
  let reach = (m: Mark) =>
    (kit.shot && a.shape == 'arc' ? HAND : kit.reach) + far + size(m) * 0.5
  if (a.shape == 'one') {
    let m = aimed && live.find((m) => m.eid == aimed.eid)
    let slack = kit.shot ? size(m ?? aimed!) + 1 : 0.8
    return m && m.near <= reach(m) + slack ? [m] : []
  }
  if (a.shape == 'arc') {
    return live.filter((m) =>
      m.near <= reach(m) && (off(me, m) <= (a.arc ?? kit.arc) || m.near <= 1)
    )
  }
  if (a.shape == 'ring') {
    return live.filter((m) => m.near <= far + size(m) * 0.5)
  }
  if (a.shape == 'burst' && aimed) {
    let c = aimed.body
    return live.filter((m) =>
      Math.hypot(m.body.x - c.x, m.body.z - c.z) <= far + size(m) * 0.5
    )
  }
  return []
}
