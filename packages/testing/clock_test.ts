// Time advances through due callbacks without timer delays.
import { clock, equal, test, throws } from '@yaks/testing'

test('clock advances callbacks in order and cancels scheduled work', async () => {
  let time = clock(100)
  let seen: number[] = []
  time.after(20, () => {
    seen.push(time.now())
  })
  let cancel = time.after(5, () => {
    seen.push(-1)
  })
  time.after(10, () => {
    seen.push(time.now())
  })
  cancel()
  await time.advance(15)
  equal(seen, [110])
  equal(time.now(), 115)
  await time.advance(10)
  equal(seen, [110, 120])
  equal(time.now(), 125)
})

test('clock includes nested callbacks and preserves equal-time order', async () => {
  let time = clock()
  let seen: string[] = []
  time.after(5, async () => {
    seen.push('first')
    await Promise.resolve()
    time.after(0, () => {
      seen.push('nested')
    })
    time.after(2, () => {
      seen.push(`later ${time.now()}`)
    })
  })
  time.after(5, () => {
    seen.push('second')
  })
  await time.advance(7)
  equal(seen, ['first', 'second', 'nested', 'later 7'])
})

test('clock rejects backwards advances without changing time', async () => {
  let time = clock(10)
  await throws(() => time.advance(-1), 'nonnegative span')
  equal(time.now(), 10)
})
