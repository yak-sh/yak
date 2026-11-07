// A store's start runs once and holds every caller that arrives before it
// finishes; a stage that took a second or more says how long.
import { equal, test } from '@yaks/testing'
import { once, SLOW, timed } from './stage.ts'

test('a start holds every caller that arrives before it finishes, and runs once until forgotten', async () => {
  let start = once(), runs = 0, open!: () => void
  let work = () => (runs++, new Promise<void>((r) => open = r))
  equal(start.holds, true)
  let first = start.run(work), behind = start.run(work)
  equal([start.holds, first == behind], [true, true])
  open()
  await first
  equal([runs, start.holds], [1, false])
  start.forget()
  equal(start.holds, true)
  await start.run(() => (runs++, Promise.resolve()))
  equal([runs, start.holds], [2, false])
})

test('a stage that took a second or more says how long, finished or thrown', async () => {
  let said: number[] = []
  let took = (ms: number, fail = false) => {
    let now = 0
    return timed(() => now, () => {
      now = ms
      return fail
        ? Promise.reject(new Error('replay failed'))
        : Promise.resolve()
    }, (ms) => said.push(ms)).catch(() => {})
  }
  await took(SLOW - 1)
  await took(SLOW)
  await took(SLOW + 500, true)
  equal(said, [SLOW, SLOW + 500])
})
