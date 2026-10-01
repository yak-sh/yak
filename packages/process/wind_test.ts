// Winding down at its seam: the first interrupt drains, a second forces, and
// the process is done once every hold has answered.

import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { winding } from './wind.ts'

// A wind with two holds whose drains finish when told, and what each was
// asked.
let held = () => {
  let w = winding()
  let said: string[] = []
  let finish!: () => void
  let finished = new Promise<void>((go) => finish = go)
  for (let name of ['a', 'b']) {
    w.hold({
      drain: () => (said.push(`drain ${name}`), finished),
      force: () => void said.push(`force ${name}`),
    })
  }
  return { w, said, finish }
}

test('a first interrupt drains every hold, and is done when they finish', async () => {
  let { w, said, finish } = held()
  w.interrupt(143)
  await Promise.resolve()
  assertEquals([w.draining, said], [true, ['drain a', 'drain b']])
  finish()
  assertEquals(await w.done, 143)
  assertEquals(said, ['drain a', 'drain b'])
})

test('a second interrupt forces each hold once, waiting on no drain', async () => {
  let { w, said } = held()
  w.interrupt(143)
  w.interrupt(130)
  w.interrupt(130)
  assertEquals(await w.done, 130)
  assertEquals(said.filter((s) => s.startsWith('force')), [
    'force a',
    'force b',
  ])
})

test('nothing held is done at once, and a hold let go is not asked', async () => {
  let w = winding()
  let asked = false
  w.hold({ drain: () => asked = true })()
  w.interrupt(129)
  assertEquals([await w.done, asked], [129, false])
})

test('a drain that fails has still answered', async () => {
  let w = winding()
  w.hold({ drain: () => Promise.reject(new Error('broke')) })
  w.hold({
    drain: () => {
      throw new Error('broke too')
    },
  })
  w.interrupt(143)
  assertEquals(await w.done, 143)
})
