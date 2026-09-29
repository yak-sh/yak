// What a player can carry is a store row, seeded from seed/items/. This
// module holds the current index and the drawing functions shared by every
// consumer; a design update replaces the index before the next frame.
import type { Slot } from './arms.ts'
import { type Box, cuboids } from './boxes.ts'
import { comp, str } from './bundle.ts'
import { type Out, out } from './mesh.ts'
import type { Bundle } from './net.ts'
export type { Box } from './boxes.ts'

/** How a thing's picture sees it (sprites.ts), its front toward +z: from a
 * corner above, the most of it at once; from the `front`, for what is worn
 * on a chest or a head; from the `side`, for a boot or a fish; from the
 * `top`, for what lies flat; `lying` corner to corner; `chop` turns a weapon
 * around its long axis so its edge points down the picture. */
export type View = 'corner' | 'front' | 'side' | 'top' | 'lying' | 'chop'

/** A soft glow anchored in a thing's own look, shared by the held model and
 * its picture. */
export type Aura = { at: [number, number, number]; color: number; size: number }

export type Thing = {
  name: string
  /** health a drink gives back */
  heals?: number
  /** where it is worn (gear.ts); a thing without one is only carried */
  slot?: Slot
  /** how strong it is, 1 to 5, by the country it comes from (arms.ts) */
  tier?: number
  /** the family of weapon, or of what is held in the other hand */
  family?: string
  /** the weight of armour: plate, leather or cloth */
  weight?: string
  /** how hard a weapon's blow lands, against bare level */
  dmg?: number
  /** how much of every bite it turns */
  armour?: number
  /** health it adds */
  hp?: number
  /** how much faster its wearer runs, as a share */
  speed?: number
  /** how much sooner each blow comes, as a share */
  haste?: number
  /** how much harder every blow lands, as a share */
  force?: number
  /** how much likelier a great blow is */
  luck?: number
  /** a standard tier piece, offered on the rack and used for recipes */
  plain?: boolean
  /** the recipe sort for a crafted piece (craft.ts) */
  recipe?: string
  look: Box[]
  aura?: Aura
  /** how its picture sees it; from a corner unless it says */
  view?: View
}

export let ITEMS: Record<string, Thing> = {}
export let itemVersion = 0

/** Install the store's current item designs. */
export let useItems = (rows: Bundle[]) => {
  ITEMS = Object.fromEntries(rows.flatMap((row) => {
    let design = comp(row, 'item_design'), kind = str(design.kind)
    return kind ? [[kind, design as Thing]] : []
  }))
  itemVersion++
}

/** A look as triangles to draw (mesh.ts), in voxels 5 cm across, each box as
 * soft at its edges as a small thing is unless it says: what lies on the
 * ground (cast.ts) and what flies to a hero (nodes.ts). */
export let meshed = (look: Box[]): Out => cuboids(out(), look, 0.05, 0.02)

/** How much larger than itself a thing lying on the ground is drawn: a small
 * thing, a coin or a jelly, grown so it is seen from where the camera looks,
 * and arms at their own size, the size they are in a hero's hand.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { seedItems } from './items_fixture.ts'
 * seedItems()
 * assertEquals(onGround(ITEMS.jelly.look) > 1, true)
 * assertEquals([onGround(ITEMS.sword1.look), onGround(ITEMS.staff3.look)], [
 *   1,
 *   1,
 * ])
 * ```
 */
export let onGround = (look: Box[]) => {
  let span = [0, 1, 2].map((a) =>
    Math.max(...look.map(([min, size]) => min[a] + size[a])) -
    Math.min(...look.map(([min]) => min[a]))
  )
  return Math.min(1.6, Math.max(1, 0.5 / Math.max(...span)))
}
