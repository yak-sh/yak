// A hero's trades: the four they gather by (gather.ts) and the three they
// make things by at a village's stations (craft.ts). Each grows by use, a
// level at a time, and is counted again from the hero's own rows: what each
// gathering and each making was worth to its trade.
import type { Glyph } from './glyphs.ts'

/** A trade a hero gathers by. */
export type Gather = 'wood' | 'ore' | 'herb' | 'fish'
/** A trade a hero makes things by, named for the station it is worked at. */
export type Craft = 'forge' | 'bench' | 'cauldron'
export type Trade = Gather | Craft

/** Each trade's name and glyph, the gathering ones first. */
export let TRADES: Record<Trade, { name: string; icon: Glyph }> = {
  wood: { name: 'Woodcutting', icon: 'axe' },
  ore: { name: 'Mining', icon: 'pickaxe' },
  herb: { name: 'Herbalism', icon: 'sprout' },
  fish: { name: 'Fishing', icon: 'fish' },
  forge: { name: 'Smithing', icon: 'anvil' },
  bench: { name: 'Woodworking', icon: 'hammer' },
  cauldron: { name: 'Brewing', icon: 'flask' },
}

/** Every trade, in the order a sheet lists them. */
export let ALL: Trade[] = [
  'wood',
  'ore',
  'herb',
  'fish',
  'forge',
  'bench',
  'cauldron',
]

/** The xp a level of a trade takes, counted from nothing.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals([tradeNeed(1), tradeNeed(2), tradeNeed(3)], [0, 10, 40])
 * assertEquals(tradeLevel(tradeNeed(5)), 5)
 * assertEquals(tradeLevel(tradeNeed(5) - 1), 4)
 * ```
 */
export let tradeNeed = (lvl: number): number => 10 * (lvl - 1) ** 2

export let tradeLevel = (xp: number): number => {
  let l = 1
  while (xp >= tradeNeed(l + 1)) l++
  return l
}

/** The least level of its trade a thing of `tier` asks, to gather or to
 * make: a tier every two levels. */
export let least = (tier: number): number => 2 * tier - 1

export type Trades = Record<Trade, { xp: number; lvl: number }>

/** A hero's trades, from each piece of work they did: its trade, and what it
 * was worth.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let t = tradesOf([...Array(8).fill(['wood', 5]), ['forge', 10]])
 * assertEquals(t.wood, { xp: 40, lvl: 3 })
 * assertEquals(t.forge, { xp: 10, lvl: 2 })
 * assertEquals(t.fish, { xp: 0, lvl: 1 })
 * ```
 */
export let tradesOf = (works: [Trade, number][]): Trades => {
  let at = (t: Trade) => {
    let xp = works.reduce((n, [w, x]) => w == t ? n + x : n, 0)
    return { xp, lvl: tradeLevel(xp) }
  }
  return {
    wood: at('wood'),
    ore: at('ore'),
    herb: at('herb'),
    fish: at('fish'),
    forge: at('forge'),
    bench: at('bench'),
    cauldron: at('cauldron'),
  }
}
