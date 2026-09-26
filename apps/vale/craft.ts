// Crafting: what a hero makes at a village's stations, from what they gathered
// (gather.ts) and what creatures left them (beasts.ts). A forge makes blades,
// plate and rings, a bench bows, staves, shields, leather and cloth, and a
// cauldron brews tonics, each station a trade of its own (trades.ts). A
// recipe asks for so much of a kind of stuff: metal, wood, herbs and fish
// come in tiers, as the nodes that give them do, and a tier's recipe takes
// stuff of its tier or better; hides, cloth and gems are what creatures
// leave, of any tier.
//
// Making a thing writes an item wearing a `crafted` row, and spends the items
// it took with `used` rows in the same write, so the bag is still items held
// less items spent. A hero's crafting trades are counted from the crafted
// rows on their items, as their gathering trades are from the gathered ones.
import { ARMS } from './arms.ts'
import { LODES } from './gather.ts'
import { ITEMS } from './items.ts'
import { type Craft, type Gather, least } from './trades.ts'

/** Each station: its name, what making a thing at it is called, and while
 * it is being made, how near a hero must stand to work it, in metres from its
 * middle, and the colour of what a stroke there throws up: sparks, shavings,
 * a splash. */
export let STATIONS: Record<Craft, {
  name: string
  verb: string
  doing: string
  reach: number
  chip: number
}> = {
  forge: {
    name: 'Forge',
    verb: 'Forge',
    doing: 'Forging',
    reach: 2.6,
    chip: 0xffb040,
  },
  bench: {
    name: 'Workbench',
    verb: 'Make',
    doing: 'Making',
    reach: 2.6,
    chip: 0xd8b078,
  },
  cauldron: {
    name: 'Cauldron',
    verb: 'Brew',
    doing: 'Brewing',
    reach: 2.6,
    chip: 0x9fe0a0,
  },
}

/** Whether a prop of kind `kind` is a station (props/village.ts). */
export let isStation = (kind: string): kind is Craft => kind in STATIONS

// The tier of each thing a node gives: the least of the nodes that give it.
let TIER: Record<string, number> = {}
for (let l of Object.values(LODES)) {
  TIER[l.gives] = Math.min(TIER[l.gives] ?? 9, l.tier)
}
let gives = (trade: Gather) =>
  Object.keys(TIER).filter((k) =>
    Object.values(LODES).some((l) => l.gives == k && l.trade == trade)
  ).sort((a, b) => TIER[a] - TIER[b])

/** Each kind of stuff a recipe asks for: its name, the kinds of item that
 * serve, and whether they come in tiers. */
export let STUFF: Record<
  string,
  { name: string; kinds: string[]; tiered: boolean }
> = {
  metal: { name: 'Metal', kinds: gives('ore'), tiered: true },
  wood: { name: 'Wood', kinds: gives('wood'), tiered: true },
  herbs: { name: 'Herbs', kinds: gives('herb'), tiered: true },
  fish: { name: 'Fish', kinds: gives('fish'), tiered: true },
  hides: { name: 'Hides', kinds: ['hide', 'pelt', 'scale'], tiered: false },
  cloth: { name: 'Cloth', kinds: ['fleece', 'silk'], tiered: false },
  gems: {
    name: 'Gems',
    kinds: ['pearl', 'toadstone', 'shard', 'glow', 'frost', 'ember', 'gem'],
    tiered: false,
  },
}

/** What serves for `what` in a recipe of `tier`, the humblest first: stuff of
 * that tier or better, or where no stuff is that good the best there is; any
 * of stuff that has no tiers; or the one kind a recipe names.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(serves('metal', 1)[0], 'copper')
 * assertEquals(serves('metal', 2).includes('copper'), false)
 * assertEquals(serves('fish', 5).length > 0, true)
 * assertEquals(serves('mossberry', 1), ['mossberry'])
 * ```
 */
export let serves = (what: string, tier: number): string[] => {
  let s = STUFF[what]
  if (!s) return [what]
  if (!s.tiered) return s.kinds
  let top = Math.max(...s.kinds.map((k) => TIER[k]))
  return s.kinds.filter((k) => TIER[k] >= Math.min(tier, top))
}

/** What a thing is made from, and where: so much of each stuff. */
export type Recipe = {
  makes: string
  at: Craft
  tier: number
  needs: [string, number][]
}

// What each sort of arms and armour is made from, at which station.
let SORTS: Record<string, [Craft, [string, number][]]> = {
  sword: ['forge', [['metal', 3], ['wood', 1]]],
  axe: ['forge', [['metal', 3], ['wood', 1]]],
  hammer: ['forge', [['metal', 4], ['wood', 2]]],
  dagger: ['forge', [['metal', 2], ['hides', 1]]],
  helm: ['forge', [['metal', 3]]],
  cuirass: ['forge', [['metal', 5]]],
  greaves: ['forge', [['metal', 3]]],
  ring: ['forge', [['metal', 2], ['gems', 1]]],
  bow: ['bench', [['wood', 3], ['hides', 1]]],
  staff: ['bench', [['wood', 3], ['gems', 1]]],
  shield: ['bench', [['wood', 3], ['metal', 1]]],
  tome: ['bench', [['hides', 2], ['herbs', 2]]],
  torch: ['bench', [['wood', 2], ['herbs', 1]]],
  cowl: ['bench', [['hides', 2], ['herbs', 1]]],
  jerkin: ['bench', [['hides', 4], ['herbs', 1]]],
  boots: ['bench', [['hides', 2], ['herbs', 1]]],
  hood: ['bench', [['cloth', 2], ['herbs', 1]]],
  robe: ['bench', [['cloth', 4], ['herbs', 1]]],
  sandals: ['bench', [['cloth', 1], ['hides', 1], ['herbs', 1]]],
}

// What the cauldron brews.
let BREWS: Recipe[] = [
  { makes: 'tonic', at: 'cauldron', tier: 1, needs: [['mossberry', 2]] },
  {
    makes: 'draught',
    at: 'cauldron',
    tier: 2,
    needs: [['herbs', 2], ['fish', 1]],
  },
  {
    makes: 'elixir',
    at: 'cauldron',
    tier: 3,
    needs: [['herbs', 3], ['fish', 1], ['honey', 1]],
  },
]

/** Every recipe, by the kind of item it makes. */
export let RECIPES: Record<string, Recipe> = Object.fromEntries([
  ...Object.entries(ARMS).flatMap(([kind, t]) => {
    let sort = SORTS[kind.replace(/\d+$/, '')]
    return sort && t.tier
      ? [{ makes: kind, at: sort[0], tier: t.tier, needs: sort[1] }]
      : []
  }),
  ...BREWS,
].map((r) => [r.makes, r]))

/** What making a thing of `tier` is worth to its trade. */
export let madeXp = (tier: number): number => 10 * tier

/** Whether a hero whose trade is at `lvl` may follow a recipe. */
export let able = (r: Recipe, lvl: number): boolean => lvl >= least(r.tier)

/** A stack in the bag: an item row, its kind and how many. */
type Held = { eid: string; kind: string; n: number }

/** What in a bag is spare to make things from: all but what is worn. */
export let spare = (bag: Held[], worn: (Held | undefined)[]): Held[] =>
  bag.filter((h) => !worn.some((w) => w?.eid == h.eid))

/** How much of `what` a bag holds that would serve a recipe of `tier`. */
export let have = (bag: Held[], what: string, tier: number): number => {
  let kinds = serves(what, tier)
  return bag.reduce((n, h) => kinds.includes(h.kind) ? n + h.n : n, 0)
}

/** Which item rows of a bag following a recipe spends, the humblest stuff
 * first, and what comes back from a row that held more than was asked; or
 * nothing, when the bag is short.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let bag = [
 *   { eid: 'a', kind: 'silver', n: 2 },
 *   { eid: 'b', kind: 'copper', n: 2 },
 *   { eid: 'c', kind: 'oaklog', n: 1 },
 * ]
 * assertEquals(plan(RECIPES.sword1, bag), {
 *   spend: ['b', 'a', 'c'],
 *   change: [['silver', 1]],
 * })
 * assertEquals(plan(RECIPES.sword2, bag), null)
 * ```
 */
export let plan = (
  r: Recipe,
  bag: Held[],
): { spend: string[]; change: [string, number][] } | null => {
  let left = bag
  let spend: string[] = [], change: [string, number][] = []
  for (let [what, n] of r.needs) {
    let kinds = serves(what, r.tier)
    let rows = left
      .filter((h) => kinds.includes(h.kind))
      .sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind))
    let got = 0
    for (let h of rows) {
      if (got >= n) break
      got += h.n
      spend.push(h.eid)
      left = left.filter((x) => x != h)
      if (got > n) change.push([h.kind, got - n])
    }
    if (got < n) return null
  }
  return { spend, change }
}

/** The name a recipe's stuff goes by. */
export let stuffName = (what: string): string =>
  STUFF[what]?.name ?? ITEMS[what]?.name ?? what
