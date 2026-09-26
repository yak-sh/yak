// What the people of the vale ask of a player, and who they are. Pure data: a
// quest is a row of QUESTS and its giver a row of GIVERS, who stands at a
// place of a level (levels.ts). A giver offers their quests one at a time,
// each once the quest it comes `after` is done, which may be another giver's:
// that is how a story walks a player from one person, and one level, to the
// next. A quest names what to slay by creature kind (beasts.ts) and what to
// gather or give by item kind (items.ts). Its id is what a player's journal
// remembers, so an id, once played, never changes.
//
// The story they tell: a briar is creeping into the vale from somewhere far
// off, and a beast it crowns forgets it was ever gentle. Long ago the
// Greenkeepers planted the moss and held the briar back. Elder Wren's quests
// are the spine, from Mossvale outward; everyone else has troubles of their
// own, and most of those troubles have thorns in them.
//
// The rows live in quests/, a file for each country of the world
// (levels.ts), in the order a hero comes to them.

import * as home from './quests/home.ts'

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

export let GIVERS: Giver[] = [...home.givers]

/** Every quest can be finished: its giver stands in a place that exists, the
 * quest it comes after is one, and what it asks for lives somewhere or drops
 * from something or is given.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { BEASTS } from './beasts.ts'
 * import { ITEMS } from './items.ts'
 * import { LEVELS } from './levels.ts'
 * let kinds = new Set(
 *   Object.values(LEVELS).flatMap((l) =>
 *     Object.values(l.places).map((p) => p.kind)
 *   ),
 * )
 * let lives = (k: string) => BEASTS[k]?.haunts.some((h) => kinds.has(h.near))
 * let had = new Set([
 *   ...Object.values(BEASTS).flatMap((b) => b.loot.map(([i]) => i)),
 *   ...QUESTS.map((q) => q.gift),
 * ])
 * let ids = new Set(QUESTS.map((q) => q.id))
 * let stands = (id: string) =>
 *   GIVERS.some((g) => g.id == id && LEVELS[g.level]?.places[g.place])
 * let stuck = QUESTS.filter((q) =>
 *   !stands(q.giver) || (q.after && !ids.has(q.after)) ||
 *   (q.gift && !ITEMS[q.gift]) ||
 *   (q.goal == 'slay' ? !lives(q.target) : !had.has(q.target))
 * )
 * assertEquals(stuck.map((q) => q.id), [])
 * assertEquals(ids.size, QUESTS.length)
 * ```
 */
export let QUESTS: Quest[] = [...home.quests]
