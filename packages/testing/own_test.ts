import { equal, test } from '@yaks/testing'
import { own } from './own.ts'

// A clock over scripted looks: what each look finds each thread has waited,
// and the wall clock at the clock's making and at each call after it.
let read = (looks: Record<string, number>[], times: number[], every = 0) => {
  let at = [...times]
  let now = own(0, {
    every,
    look: () => new Map(Object.entries(looks.shift()!)),
    time: () => at.shift()!,
  })
  return times.slice(1).map(() => now())
}

test('own time is the wall clock less the most-held thread’s wait', () => {
  equal(read([{ a: 0, b: 0 }, { a: 30, b: 10 }], [0, 0, 100]), [0, 70])
  equal(read([{ a: 0 }, { a: 0, c: 20 }], [0, 0, 100]), [0, 80])
  equal(read([{ a: 10 }, {}], [0, 0, 100]), [0, 100])
})

test('own time never runs back when a look finds a wait already counted', () => {
  equal(
    read([{ a: 0 }, { a: 0 }, { a: 200 }], [0, 0, 100, 150]),
    [0, 100, 100],
  )
})

test('own time counts its first interval whole and looks once per interval', () => {
  equal(
    read([{ a: 500 }, { a: 550 }], [0, 50, 100, 150, 200], 100),
    [50, 100, 150, 150],
  )
})
