// How a blow finds its foe. A blow is aimed as it is asked for: the hero
// turns toward the nearest creature before them, forgivingly, or, with a
// weapon that shoots, toward the one they are fighting while it is in range.
// It lands a moment into the swing (`LAND`) on the nearest creature then in
// its reach and arc (gear.ts `Kit`); a shot is loosed then at the creature it
// was aimed at, and lands when it gets there (`FLIGHT`).
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

let size = (m: Mark) => BEASTS[m.kind]?.size ?? 1
let off = (me: Me, m: Mark) => {
  let a = Math.atan2(m.body.x - me.x, m.body.z - me.z)
  return Math.abs(Math.atan2(Math.sin(a - me.yaw), Math.cos(a - me.yaw)))
}
let nearest = (ms: Mark[]) =>
  ms.reduce<Mark | null>((b, m) => !b || m.near < b.near ? m : b, null)

/** The creature a blow is aimed at as it is asked for, or none: for a weapon
 * that shoots, the one being fought, while in range.
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
 * ```
 */
export let aimOf = <M extends Mark>(
  mobs: M[],
  me: Me,
  kit: Kit,
  foe = '',
): M | null => {
  let reach = (m: Mark) =>
    kit.shot ? kit.reach + size(m) : 0.7 + kit.reach + size(m)
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
