// A hero's trades: the four they gather by (gather.ts) and the four they
// make things by at a village's stations (craft.ts). Each grows by use, a
// level at a time, and is counted again from the hero's own rows: what each
// gathering, making and upgrading was worth to its trade (work.ts). Their
// panel's Trades tab lists them all, each with its level and the xp toward
// the next (`ledger`).
import { type Glyph, glyph } from './glyphs.ts'
import type { Page } from './panel.ts'

/** A trade a hero gathers by. */
export type Gather = 'wood' | 'ore' | 'herb' | 'fish'
/** A trade a hero makes things by, named for the station it is worked at. */
export type Craft = 'forge' | 'bench' | 'cauldron' | 'loom'
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
  loom: { name: 'Tailoring', icon: 'scissors' },
}

/** The trades a hero gathers by, and those they make by, in the order a
 * sheet lists them. */
export let GATHERING: Gather[] = ['wood', 'ore', 'herb', 'fish']
export let MAKING: Craft[] = ['forge', 'bench', 'cauldron', 'loom']

/** Every trade, in the order a sheet lists them. */
export let ALL: Trade[] = [...GATHERING, ...MAKING]

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
    loom: at('loom'),
  }
}

/** The Trades tab, drawn into its tab (panel.ts): the gathering trades, then
 * the making ones, each with its glyph, its level, and a bar of the xp
 * toward the next, written again only when the count changed. */
export let ledger = (tab: Page) => {
  let was: Trades | null = null
  let row = (t: Trade, { xp, lvl }: { xp: number; lvl: number }) => {
    let from = tradeNeed(lvl), to = tradeNeed(lvl + 1)
    return `<li class=Trades_Row><i>${glyph(TRADES[t].icon)}</i><b>${
      TRADES[t].name
    }</b><span class=Badge>Level ${lvl}</span><div class="Bar Bar-xp"><i style="--k:${
      ((xp - from) / (to - from)).toFixed(3)
    }"></i><span>${xp - from} / ${to - from} xp</span></div></li>`
  }
  let list = (head: string, ts: Trade[], mine: Trades) =>
    `<h3 class=Pack_Head>${head}</h3><ul class=Trades_List>${
      ts.map((t) => row(t, mine[t])).join('')
    }</ul>`
  return {
    /** show the hero's trades, from what the stations read (work.ts), when
     * the tab is open and they changed */
    show: (mine: Trades) => {
      if (!tab.open) {
        was = null
        return
      }
      if (mine == was) return
      was = mine
      tab.body.innerHTML = `<div class=Trades>${
        list('Gathering', GATHERING, mine)
      }${list('Making', MAKING, mine)}</div>`
    },
  }
}
