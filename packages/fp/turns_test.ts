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
  await time.advance(10)
  equal(taken, ['a', 'b'])
  b.end()
  await time.advance(10)
  equal([taken, a.gone(), c.gone()], [['a', 'b', 'c'], true, false])
})

test('a turn whose caller never looks again passes on', async () => {
  let time = clock()
  // A caller whose request ended: its timers never fire.
  let dead = false
  let lossy = {
    now: time.now,
    after: (ms: number, f: () => void) => dead ? () => {} : time.after(ms, f),
  }
  let turn = turns(lossy, 1000, 5000)
  let taken: string[] = []
  let a = turn()
  dead = true
  let b = turn()
  dead = false
  let c = turn()
  a.ready.then(() => taken.push('a'))
  b.ready.then(() => taken.push('b'))
  c.ready.then(() => taken.push('c'))
  a.end()
  await time.advance(990)
  equal(taken, ['a'])
  await time.advance(30)
  equal([taken, b.gone()], [['a', 'c'], true])
})

test('a caller that leaves before its turn is skipped', async () => {
  let time = clock()
  let { all: [a, b], taken } = taking(['a', 'b', 'c'], turns(time))
  b.end()
  a.end()
  await time.advance(10)
  equal(taken, ['a', 'c'])
})

test('a turn held past its hold passes on, and its late end passes nothing', async () => {
  let time = clock()
  let { all: [a], taken } = taking(['a', 'b', 'c'], turns(time, 1000, 5000))
  await time.advance(4990)
  equal(taken, ['a'])
  await time.advance(20)
  equal([taken, a.gone()], [['a', 'b'], true])
  a.end()
  await time.advance(10)
  equal(taken, ['a', 'b'])
})
