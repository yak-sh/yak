import { equal, test } from '@yaks/testing'
import { observe, type Progress, stalled } from './test.ts'

let progress = (): Progress => ({
  name: 'loading tests',
  phase: 'loading',
  at: 0,
  count: 0,
  failed: [],
})
let says = (text: string, p: Progress, at: number) =>
  observe([new TextEncoder().encode(text)], p, () => at)

test('loading leaves the first test its full idle allowance', async () => {
  let p = progress()
  equal(stalled(p, 500, 300), false)
  await says('loading a_test.ts\n', p, 500)
  equal(stalled(p, 1_200, 300), false)
  await says('first ... ', p, 1_200)
  equal(stalled(p, 1_499, 300), false)
  equal(stalled(p, 1_500, 300), true)
})

test('completed tests renew idle but beginning another does not', async () => {
  let p = progress()
  await says('first ... ok (1ms)\n', p, 50)
  await says('second ... ', p, 299)
  equal(stalled(p, 349, 300), false)
  equal(stalled(p, 350, 300), true)
  await says('second ... ok (1ms)\n', p, 350)
  equal(stalled(p, 649, 300), false)
  equal(stalled(p, 650, 300), true)
})

test('a hung startup or subsequent fixture load still expires', async () => {
  let p = progress()
  equal(stalled(p, 59_999, 300), false)
  equal(stalled(p, 60_000, 300), true)
  await says('first ... ok (1ms)\n', p, 50)
  await says('loading b_test.ts\n', p, 1_000)
  equal(stalled(p, 60_999, 300), false)
  equal(stalled(p, 61_000, 300), true)
})
