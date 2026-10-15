// Rolls land on each rarity as often as its odds say.
import { test } from '@yaks/testing'
import { assert, assertAlmostEquals } from '@std/assert'
import { dropped, made, oddsOf, RARITIES, type Rarity } from './rarity.ts'

// The share of `N` rolls spread evenly over [0, 1) that lands on each rarity:
// each is within 1 / N of the odds it was rolled with.
let N = 100
let shares = (roll: (r: number) => Rarity) => {
  let seen = RARITIES.map(() => 0)
  for (let i = 0; i < N; i++) seen[RARITIES.indexOf(roll((i + 0.5) / N))]++
  return seen.map((n) => n / N)
}

test('over many falls each rarity comes as often as its odds say', () => {
  let odds = oddsOf(11 / 59)
  shares((r) => dropped(r, 12)).forEach((share, i) =>
    assertAlmostEquals(share, odds[i], 1 / N)
  )
})

test('a made piece is likelier fine the further its maker is past the recipe', () => {
  let fine = (lvl: number) => 1 - shares((r) => made(r, lvl, 1))[0]
  assert(fine(13) > fine(1) * 1.4)
})
