// What the people of the vale ask of a player, and who they are. Pure data: a
// quest is a row of QUESTS and its giver a row of GIVERS, who stands at a
// place of a level (levels.ts). A giver offers their quests one at a time,
// each once the quest it comes `after` is done, which may be another giver's:
// that is how a story walks a player from one person, and one level, to the
// next. A quest names what to slay by creature kind (beasts.ts) and what to
// gather or give by item kind (items.ts). Its id is what a player's journal
// remembers, so an id, once played, never changes.
//
// The story they tell: a briar is creeping into the vale, and a beast it
// crowns forgets it was ever gentle. Long ago the Greenkeepers planted the moss
// and set a ward at the end of each road out of Mossvale: the Elder Heart up
// the north road, the bell of the Sunken Kirk down the east, the old king's
// barrow down the south, and the light on Stormhead out along the west. Elder
// Wren teaches a new hero and sends them down the west road to the Reeve of
// Birchmere, whose old book names the wards; the people of each land have
// troubles of their own, and the last of each land's asks points down the
// road to the next. The story ends at the Maw, where the Cinder Wyrm lies on
// the briar's root. Directions name a road by where it leads, or by its side
// where levels.ts gives it one.
//
// The rows live in quests/, a file for each country of the world (levels.ts),
// in the order a hero comes to them: every land has someone with something to
// ask, and each land's first ask is open to anyone who walks in.

import * as home from './quests/home.ts'
import * as woods from './quests/woods.ts'
import * as wetlands from './quests/wetlands.ts'
import * as sea from './quests/sea.ts'
import * as moors from './quests/moors.ts'
import * as under from './quests/under.ts'
import * as sands from './quests/sands.ts'
import * as frost from './quests/frost.ts'
import * as fire from './quests/fire.ts'

export type Giver = {
  id: string
  name: string
  /** the level they live in, and the place in it (levels.ts) */
  level: string
  place: string
  /** where they stand from that place, in metres east and south */
  offset: [number, number]
  /** what they say when there is nothing to ask */
  greets: string
  look: { tint: string; hair: string; skin: string }
  /** leans on a staff */
  staff?: boolean
}

export type Quest = {
  id: string
  giver: string
  /** the quest that must be done first */
  after?: string
  /** the level what it asks for is found in, when not the giver's own */
  level?: string
  goal: 'slay' | 'gather'
  /** a creature kind to slay, or an item kind to gather and hand over */
  target: string
  count: number
  xp: number
  /** an item kind given on completion */
  gift?: string
  title: string
  body: string
}

let LANDS = [home, woods, wetlands, sea, moors, under, sands, frost, fire]

export let GIVERS: Giver[] = LANDS.flatMap((l) => l.givers)

/** Every quest can be finished where it sends a hero: its giver stands in a
 * place that exists, the quest it comes after is one, and what it asks for
 * lives in its level (homes.ts `dens`), or drops from something that does.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { BEASTS } from './beasts.ts'
 * import { dens } from './homes.ts'
 * import { ITEMS } from './items.ts'
 * import { LEVELS } from './levels.ts'
 * let giver = new Map(GIVERS.map((g) => [g.id, g]))
 * let ids = new Set(QUESTS.map((q) => q.id))
 * let found = (q: Quest) => {
 *   let lv = LEVELS[q.level ?? giver.get(q.giver)?.level ?? '']
 *   let kinds = lv ? dens(lv).map((d) => d.kind) : []
 *   return q.goal == 'slay'
 *     ? kinds.includes(q.target)
 *     : kinds.some((k) => BEASTS[k].loot.some(([i]) => i == q.target))
 * }
 * let stuck = QUESTS.filter((q) => {
 *   let g = giver.get(q.giver)
 *   return !g || !LEVELS[g.level]?.places[g.place] ||
 *     (q.after && !ids.has(q.after)) || (q.gift && !ITEMS[q.gift]) || !found(q)
 * })
 * assertEquals(stuck.map((q) => q.id), [])
 * assertEquals(ids.size, QUESTS.length)
 * ```
 */
export let QUESTS: Quest[] = LANDS.flatMap((l) => l.quests)
