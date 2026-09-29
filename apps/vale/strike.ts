// How a blow finds its foe. What my next blow or ability would take is worked
// out once a frame (`aimOf`): the pale mark shows it, and whatever I do is
// aimed at it while it is in that act's reach (`aimFor`), so the creature
// marked is the one struck. The hero turns toward it as they do it. A blow
// lands a moment into the swing (`LAND`), on what it was aimed at while that
// is in its reach and arc, or else on the nearest that is (gear.ts `Kit`); a
// shot is loosed then at the creature it was aimed at, and lands when it gets
// there (`FLIGHT`). An ability takes what its shape covers (`takenBy`).
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

// How far either side of ahead a creature can be aimed at: the hero turns
// this far to face it.
let TURN = 1.9
// The creature aimed at keeps the mark until another is nearer than this
// share of its distance, so two about as near do not trade it back and forth.
let HOLD = 0.8
// How far a sweep reaches with a weapon that shoots: the arm's length.
let HAND = 1.4

let size = (m: Mark) => BEASTS[m.kind]?.size ?? 1
let off = (me: Me, m: Mark) => {
  let a = Math.atan2(m.body.x - me.x, m.body.z - me.z)
  return Math.abs(Math.atan2(Math.sin(a - me.yaw), Math.cos(a - me.yaw)))
}
let nearest = <M extends Mark>(ms: M[]) =>
  ms.reduce<M | null>((b, m) => !b || m.near < b.near ? m : b, null)
// How near a creature must be to be aimed at by an act that goes `far` past
// the weapon's reach: forgivingly, for a blade, as the hero steps into it.
let reach = (kit: Kit, far: number, m: Mark) =>
  far + (kit.shot ? 0 : 0.7) + kit.reach + size(m)

/** Whether an ability goes to one creature, and so needs one to aim at. */
export let aims = (a: Ability): boolean =>
  a.shape == 'one' || a.shape == 'burst'

/** How far past the weapon's reach an ability goes to what it is aimed at:
 * a dash's length, or its own `far` for `one` or an `arc`. A `burst`'s `far`
 * is how wide it bursts, not how far it goes. */
export let farOf = (a: Ability): number =>
  a.dash ?? (a.shape == 'one' || a.shape == 'arc' ? a.far ?? 0 : 0)

/** What my next blow or ability would take, or none, worked out once a
 * frame for the mark and every act to share: of the creatures up and before
 * me, those in the shortest reach that has any, of a blow's and of each
 * ability in `acts` that goes to one creature (the ones ready, or under way),
 * and of those the nearest. The one aimed at last (`held`) keeps it until
 * another is a good deal nearer (`HOLD`).
 *
 * ```ts
 * import { seedBeasts } from './beasts_fixture.ts'
 * seedBeasts()
 * import { assertEquals } from '@std/assert'
 * import { ABILITIES } from './abilities.ts'
 * import { HANDLES } from './arms.ts'
 * let at = (eid: string, x: number, z: number, kind = 'slime') =>
 *   ({ eid, kind, down: false, near: Math.hypot(x, z), body: { x, z } })
 * let kit = (family: string) => ({ ...HANDLES[family], family } as never)
 * let aim = (
 *   mobs: ReturnType<typeof at>[],
 *   family: string,
 *   held = '',
 *   acts: string[] = [],
 * ) =>
 *   aimOf(
 *     mobs,
 *     { x: 0, z: 0, yaw: 0 },
 *     kit(family),
 *     held,
 *     acts.map((id) => ABILITIES[id]),
 *   )?.eid ?? null
 * let mobs = [at('near', 0, 2), at('far', 0, 9), at('behind', 0, -1.5)]
 * // The nearest before me in reach, never one behind; a bow reaches further.
 * assertEquals(aim(mobs, 'sword'), 'near')
 * assertEquals(aim(mobs.slice(1), 'sword'), null)
 * assertEquals(aim(mobs.slice(1), 'bow'), 'far')
 * // A ready lunge reaches one further off.
 * assertEquals(aim([at('far', 0, 6)], 'sword', '', ['lunge']), 'far')
 * // What a blow reaches comes first: an aurochs at hand, before a hen a
 * // little nearer that only a lunge reaches.
 * let herd = [at('hen', 0, 3.2, 'hen'), at('aurochs', 1, 3.7, 'aurochs')]
 * assertEquals(aim(herd, 'sword', '', ['lunge']), 'aurochs')
 * // The one aimed at holds until another is a good deal nearer.
 * let two = [at('a', 0, 3), at('b', 1, 2.6)]
 * assertEquals(aim(two, 'bow'), 'b')
 * assertEquals(aim(two, 'bow', 'a'), 'a')
 * assertEquals(aim([at('a', 0, 3), at('b', 0, 1.5)], 'bow', 'a'), 'b')
 * ```
 */
export let aimOf = <M extends Mark>(
  mobs: M[],
  me: Me,
  kit: Kit,
  held = '',
  acts: Ability[] = [],
): M | null => {
  let before = mobs.filter((m) => !m.down && off(me, m) <= TURN)
  let fars = [0, ...acts.filter(aims).map(farOf)].sort((a, b) => a - b)
  let far = fars.find((f) => before.some((m) => m.near <= reach(kit, f, m)))
  if (far == null) return null
  let can = before.filter((m) => m.near <= reach(kit, far, m))
  let best = nearest(can)!
  let was = can.find((m) => m.eid == held)
  return was && best.near >= was.near * HOLD ? was : best
}

/** What an act takes of the creature aimed at (`aimOf`): it, while it is in
 * the act's reach, a blow's or ability `a`'s, or else nothing.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { ABILITIES } from './abilities.ts'
 * import { HANDLES } from './arms.ts'
 * let kit = (family: string) => ({ ...HANDLES[family], family } as never)
 * let m = { eid: 'm', kind: 'slime', down: false, near: 6, body: { x: 0, z: 6 } }
 * assertEquals(aimFor(m, kit('sword')), null)
 * assertEquals(aimFor(m, kit('sword'), ABILITIES.lunge), m)
 * assertEquals(aimFor(m, kit('sword'), ABILITIES.cleave), null)
 * assertEquals(aimFor(null, kit('sword'), ABILITIES.lunge), null)
 * ```
 */
export let aimFor = <M extends Mark>(
  aim: M | null,
  kit: Kit,
  a?: Ability,
): M | null => aim && aim.near <= reach(kit, a ? farOf(a) : 0, aim) ? aim : null

/** The creature a blow lands on, or none: the one it was aimed at while in
 * its reach and arc, or else the nearest that is, or one close enough to
 * touch; a shot flies at the one it was aimed at, while it is still up and
 * about in range.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { HANDLES } from './arms.ts'
 * let at = (eid: string, x: number, z: number) =>
 *   ({ eid, kind: 'slime', down: false, near: Math.hypot(x, z), body: { x, z } })
 * let me = { x: 0, z: 0, yaw: 0 }
 * let sword = { ...HANDLES.sword, family: 'sword' } as never
 * let mobs = [at('ahead', 0, 1.8), at('beside', 0.6, 1.2), at('far', 0, 4)]
 * assertEquals(landOf(mobs, me, sword)?.eid, 'beside')
 * assertEquals(landOf(mobs, me, sword, 'ahead')?.eid, 'ahead')
 * assertEquals(landOf(mobs, me, sword, 'far')?.eid, 'beside')
 * ```
 */
export let landOf = <M extends Mark>(
  mobs: M[],
  me: Me,
  kit: Kit,
  aimed = '',
): M | null => {
  let reach = (m: Mark) =>
    kit.shot ? kit.reach + size(m) : kit.reach + size(m) * 0.5
  let takes = (m: Mark) =>
    !m.down && m.near <= reach(m) && (off(me, m) <= kit.arc || m.near <= 1)
  let m = mobs.find((m) => m.eid == aimed)
  let range = (m: Mark) => m.near <= kit.reach + size(m) + 1
  if (m && !m.down && (kit.shot ? range(m) : takes(m))) return m
  return nearest(mobs.filter(takes))
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
