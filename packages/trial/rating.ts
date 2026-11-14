/**
 * A rating of the sides of pair matches, computed from what was chosen and
 * never stored, and the next pair it says is worth playing. Pure, with no
 * imports, so the tap page (./page.ts) picks its next pair with the same
 * arithmetic the tally (./skill.ts) prints.
 *
 * The rating is Bradley-Terry's, on the Elo scale: a side rated 400 above
 * another is expected to be chosen ten times in eleven. Each side also has
 * half a win and half a loss against a fixed side rated 0 ({@link PRIOR}), so
 * a side chosen once is not rated infinitely high, and a side nobody played is
 * rated 0. A game whose
 * judge chose neither orders nothing and is left out.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { next, rate } from '@yaks/trial/rating'
 *
 * let rated = rate([{ a: 'x', b: 'y', chose: 'x' }])
 * equal(Math.round(rated.get('x')!), 131)
 * equal(Math.round(rated.get('y')!), -131)
 * // Three sides: x beat y, so z is played next, against y or x.
 * let games = [
 *   { a: 'x', b: 'y', chose: 'x' },
 *   { a: 'x', b: 'z' },
 *   { a: 'y', b: 'z' },
 * ]
 * equal(next(games), 1)
 * ```
 *
 * @module
 */

/** One match: two sides, and the one chosen. `chose` is `null` where the
 * judge chose neither, and absent where the match is not played yet. A
 * `group` keeps apart matches rated on their own, such as one question's from
 * another's. */
export type Game = {
  a: string
  b: string
  chose?: string | null
  group?: string
}

/** How sure the rating must be of a match's winner before the match is not
 * played: its expected share of wins. */
export let SURE = 0.9

/** The wins, and the losses, each side is given against the fixed side
 * before any game: how far a few games move a rating. */
export let PRIOR = 0.5

/// odds(400, 0) -> 0.9090909090909091
/** How often a side rated `a` is expected to be chosen over one rated `b`. */
export let odds = (a: number, b: number): number =>
  1 / (1 + 10 ** ((b - a) / 400))

/** Each side's rating from the games played, by side. */
export let rate = (games: Game[]): Map<string, number> => {
  let played = games.filter((g) =>
    g.chose && (g.chose == g.a || g.chose == g.b)
  )
  let sides = [...new Set(games.flatMap((g) => [g.a, g.b]))]
  // Wins and opponents, the prior against the fixed side counted in.
  let wins = new Map(sides.map((s) => [s, PRIOR]))
  let met = new Map(sides.map((s) => [s, [] as string[]]))
  for (let g of played) {
    wins.set(g.chose!, wins.get(g.chose!)! + 1)
    met.get(g.a)!.push(g.b)
    met.get(g.b)!.push(g.a)
  }
  // Hunter's minorization-maximization, on strengths where the fixed side's is 1.
  let strength = new Map(sides.map((s) => [s, 1]))
  for (let round = 0; round < 200; round++) {
    let moved = 0
    let after = new Map(sides.map((s) => {
      let p = strength.get(s)!
      let against = met.get(s)!.reduce(
        (sum, o) => sum + 1 / (p + strength.get(o)!),
        2 * PRIOR / (p + 1),
      )
      let q = wins.get(s)! / against
      moved = Math.max(moved, Math.abs(q - p))
      return [s, q]
    }))
    strength = after
    if (moved < 1e-9) break
  }
  return new Map(sides.map((s) => [s, 400 * Math.log10(strength.get(s)!)]))
}

/**
 * The index of the game to play next, or `undefined` where none is worth
 * playing. Each group is rated on its own games. Of the games not played and
 * not `skipped`, the one whose sides are rated nearest is next, then the one
 * whose sides have played fewest, then the first. A game whose winner the
 * rating already expects at least {@link SURE} of the time is not played.
 */
export let next = (
  games: Game[],
  skipped: (i: number) => boolean = () => false,
): number | undefined => {
  let groups = new Map<string, Game[]>()
  for (let g of games) {
    let key = g.group ?? ''
    groups.set(key, [...groups.get(key) ?? [], g])
  }
  let rated = new Map(
    [...groups].map(([key, gs]) => [key, rate(gs)]),
  )
  let count = new Map<string, number>()
  for (let g of games.filter((g) => g.chose !== undefined)) {
    for (let side of [g.a, g.b]) {
      let key = `${g.group ?? ''}|${side}`
      count.set(key, (count.get(key) ?? 0) + 1)
    }
  }
  let best: { i: number; gap: number; games: number } | undefined
  games.forEach((g, i) => {
    if (g.chose !== undefined || skipped(i)) return
    let rating = rated.get(g.group ?? '')!
    let [a, b] = [rating.get(g.a)!, rating.get(g.b)!]
    if (Math.max(odds(a, b), odds(b, a)) >= SURE) return
    let gap = Math.abs(a - b)
    let played = [g.a, g.b].reduce(
      (n, side) => n + (count.get(`${g.group ?? ''}|${side}`) ?? 0),
      0,
    )
    if (
      !best || gap < best.gap - 1e-9 ||
      (Math.abs(gap - best.gap) <= 1e-9 && played < best.games)
    ) best = { i, gap, games: played }
  })
  return best?.i
}
