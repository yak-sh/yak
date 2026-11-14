// The rating of a match's sides, and the next match it picks.

import { equal, ok, test } from '@yaks/testing'
import { type Game, next, rate } from './rating.ts'

// Every match of `sides`, none played.
let everyMatch = (sides: string[], group?: string): Game[] =>
  sides.flatMap((a, i) =>
    sides.slice(i + 1).map((b) => ({ a, b, ...group ? { group } : {} }))
  )

// Plays what `next` picks until it picks nothing, the side named first in
// `sides` always chosen: how many matches were played.
let play = (games: Game[], order: string[]) => {
  let n = 0
  for (let i = next(games); i != undefined; i = next(games), n++) {
    let { a, b } = games[i]
    games[i].chose = order.indexOf(a) < order.indexOf(b) ? a : b
  }
  return n
}

test('a rating orders the sides by what was chosen, and neither orders nothing', () => {
  let rated = rate([
    { a: 'x', b: 'y', chose: 'x' },
    { a: 'y', b: 'z', chose: 'y' },
    { a: 'x', b: 'z', chose: null },
  ])
  let [x, y, z] = ['x', 'y', 'z'].map((s) => rated.get(s)!)
  ok(x > y && y > z)
  equal(Math.round(y), 0)
  equal(rate([{ a: 'x', b: 'y', chose: null }]).get('x'), 0)
})

test('a consistent judge is not asked every pair, and the rating ends in their order', () => {
  let sides = [...'abcdefgh']
  let games = everyMatch(sides)
  let played = play(games, sides)
  ok(played < games.length, `${played} of ${games.length} played`)
  let rated = rate(games)
  equal([...sides].sort((p, q) => rated.get(q)! - rated.get(p)!), sides)
})

test('each group is rated on its own, and a skipped match is not picked', () => {
  let games = [
    ...everyMatch(['a', 'b'], 'copy'),
    ...everyMatch(['a', 'b'], 'layout'),
  ]
  games[0].chose = 'a'
  equal(next(games), 1)
  equal(next(games, (i) => i == 1), undefined)
})
