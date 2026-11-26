/// <reference lib="deno.ns" />
// A turn passes in order, skips a caller that left before it, and passes on
// from one held too long by a caller that never came back.

import { clock, equal, test } from '@yaks/testing'
import { type Turn, turns } from './mod.ts'

// Who has taken a turn, by name, as the queue moves.
let taking = (names: string[], turn: () => Turn) => {
  let taken: string[] = []
  let all = names.map((name) => {
    let t = turn()
    t.ready.then(() => taken.push(name))
    return t
  })
  return { all, taken }
}

test('turns pass in order, each when the one before it ends', async () => {
  let time = clock()
  let { all: [a, b, c], taken } = taking(['a', 'b', 'c'], turns(time))
  await time.advance(0)
  equal(taken, ['a'])
  a.end()
  await time.advance(0)
  equal(taken, ['a', 'b'])
  b.end()
  await time.advance(0)
  equal([taken, a.gone(), c.gone()], [['a', 'b', 'c'], true, false])
})

test('a caller that leaves before its turn is skipped', async () => {
  let time = clock()
  let { all: [a, b], taken } = taking(['a', 'b', 'c'], turns(time))
  b.end()
  a.end()
  await time.advance(0)
  equal(taken, ['a', 'c'])
})

test('a turn held past its hold passes on, and its late end passes nothing', async () => {
  let time = clock()
  let { all: [a], taken } = taking(['a', 'b', 'c'], turns(time, 1000, 5000))
  // Seen taken at the first beat, a second after it was.
  await time.advance(5900)
  equal(taken, ['a'])
  await time.advance(200)
  equal([taken, a.gone()], [['a', 'b'], true])
  a.end()
  await time.advance(0)
  equal(taken, ['a', 'b'])
})
