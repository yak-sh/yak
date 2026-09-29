// Upgrading a piece of gear, +1 and up to +5, at the station that makes one
// like it (craft.ts `recipes`): what is smithed at the forge, what is made at
// the bench there, and wherever a recipe moves, its upgrades follow. Each
// step asks more of the stuff the piece is made from, and from +3 a gem too.
// Its rolled gain lives on the upgraded row (rarity.ts `piece`).
//
// An upgrade writes an `upgraded` row naming the piece, and spends what it
// took with `used` rows in the same write, so the bag is still items held
// less items spent; how far a piece is upgraded is how many rows name it
// (`upgradesOf`), so a guest, who can only add rows, keeps theirs. Each step is
// worth xp to the station's trade, as making is (`upgradeWorth`).
import { madeXp, type Recipe, recipes } from './craft.ts'
import { ITEMS } from './items.ts'
import { UP } from './rarity.ts'
import type { Trade } from './trades.ts'

/** The furthest a piece is upgraded. */
export let MOST = 5

/** The recipe a piece of `kind` is made by, or one like it: a quest's blade
 * is upgraded as a plain one of its family and tier.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { seedItems } from './items_fixture.ts'
 * seedItems()
 * assertEquals(madeBy('sword2')?.at, 'forge')
 * assertEquals(madeBy('robe2')?.at, 'loom')
 * assertEquals(madeBy('blade4')?.makes, 'axe3')
 * assertEquals(madeBy('tonic')?.at, 'cauldron')
 * ```
 */
export let madeBy = (kind: string): Recipe | undefined => {
  let t = ITEMS[kind]
  return recipes()[kind] ?? recipes()[`${t?.family}${t?.tier}`]
}

/** What taking a piece of `kind` from +`plus` to the next step asks, as a
 * recipe at its station: one more of its first stuff than the step it goes
 * to, and from +3 a gem, two for the last. Nothing past the last step, or
 * for what is not gear.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { seedItems } from './items_fixture.ts'
 * seedItems()
 * assertEquals(upgradeOf('sword2', 0)?.needs, [['metal', 2]])
 * assertEquals(upgradeOf('robe1', 2)?.needs, [['cloth', 4], ['gems', 1]])
 * assertEquals(upgradeOf('bow3', 4), {
 *   makes: 'bow3',
 *   at: 'bench',
 *   tier: 3,
 *   needs: [['wood', 6], ['gems', 2]],
 * })
 * assertEquals(upgradeOf('sword2', MOST), null)
 * assertEquals(upgradeOf('tonic', 0), null)
 * ```
 */
export let upgradeOf = (kind: string, plus: number): Recipe | null => {
  let r = madeBy(kind)
  if (!r || !ITEMS[kind]?.slot || plus >= MOST) return null
  let to = plus + 1
  let needs: [string, number][] = [[r.needs[0][0], to + 1]]
  if (to >= 3) needs.push(['gems', to >= MOST ? 2 : 1])
  return { makes: kind, at: r.at, tier: r.tier, needs }
}

/** How far each piece is upgraded, and its rolled gain, by item eid. Rows
 * without a gain retain their original tenth per step.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let rows = ['a', 'b', 'a', ...Array(9).fill('c')].map((item) => ({ item }))
 * assertEquals(Object.fromEntries(upgradesOf(rows)), {
 *   a: { plus: 2 }, b: { plus: 1 }, c: { plus: MOST },
 * })
 * ```
 */
export let upgradesOf = (
  rows: { item: string; gain?: number; at?: number; eid?: string }[],
): Map<string, { plus: number; gain?: number }> => {
  let by = new Map<string, { plus: number; gain?: number }>()
  for (
    let { item, gain } of [...rows].sort((a, b) =>
      (a.at ?? 0) - (b.at ?? 0) ||
      (a.eid ?? '').localeCompare(b.eid ?? '')
    )
  ) {
    let was = by.get(item) ?? { plus: 0 }
    if (was.plus >= MOST) continue
    let total = gain == null
      ? was.gain == null ? undefined : was.gain + UP
      : (was.gain ?? UP * was.plus) + gain
    by.set(item, { plus: was.plus + 1, ...total != null && { gain: total } })
  }
  return by
}

/** What taking a piece of `tier` to step `to` is worth to its trade: half
 * of making one at the first step, and half again at each step after, so
 * the last is worth more than two makings, for what it asks.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { madeXp } from './craft.ts'
 * assertEquals(upgradeXp(2, 1), madeXp(2) / 2)
 * assertEquals(upgradeXp(2, MOST) > 2 * madeXp(2), true)
 * ```
 */
export let upgradeXp = (tier: number, to: number): number =>
  madeXp(tier) * to / 2

/** What a hero's upgrades were worth, trade by trade: each row, to the trade
 * of the station that makes its piece, by its tier and the step it reached,
 * counted in the order they were made; `kinds` says what each piece is.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { seedItems } from './items_fixture.ts'
 * seedItems()
 * let rows = [{ item: 'a', at: 2 }, { item: 'a', at: 1 }, { item: 'b', at: 3 }]
 * let kinds = new Map([['a', 'sword2'], ['b', 'bow1']])
 * assertEquals(upgradeWorth(rows, kinds), [
 *   ['forge', upgradeXp(2, 1)],
 *   ['forge', upgradeXp(2, 2)],
 *   ['bench', upgradeXp(1, 1)],
 * ])
 * ```
 */
export let upgradeWorth = (
  rows: { item: string; at: number }[],
  kinds: Map<string, string>,
): [Trade, number][] => {
  let steps = new Map<string, number>()
  return [...rows].sort((a, b) => a.at - b.at).flatMap(({ item }) => {
    let to = Math.min(MOST, (steps.get(item) ?? 0) + 1)
    let r = madeBy(kinds.get(item) ?? '')
    steps.set(item, to)
    return r ? [[r.at, upgradeXp(r.tier, to)] as [Trade, number]] : []
  })
}
