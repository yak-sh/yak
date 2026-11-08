import { clock, equal, test } from '@yaks/testing'
import { watchRevision } from './watch_revision.ts'

test('revision watching serializes pending reads and wakes only on a change', async () => {
  let time = clock(), changed = 0
  let reads: ReturnType<typeof Promise.withResolvers<unknown>>[] = []
  let stop = watchRevision(
    () => {
      let read = Promise.withResolvers<unknown>()
      reads.push(read)
      return read.promise
    },
    () => changed++,
    () => {},
    time,
  )
  try {
    await time.advance(500)
    equal(reads.length, 1)
    reads[0].resolve(1)
    await Promise.resolve()
    await time.advance(50)
    equal(reads.length, 2)
    reads[1].resolve(1)
    await Promise.resolve()
    await time.advance(50)
    reads[2].resolve(2)
    await Promise.resolve()
    equal(changed, 1)
  } finally {
    stop()
  }
})

test('a stopped revision watcher ignores a pending result and schedules nothing', async () => {
  let time = clock(), read = Promise.withResolvers<unknown>()
  let calls = 0, changed = 0
  let stop = watchRevision(
    () => (++calls, read.promise),
    () => changed++,
    () => {},
    time,
  )
  stop()
  read.resolve(1)
  await time.advance(500)
  equal([calls, changed], [1, 0])
})

test('a failed revision read reports once and stops', async () => {
  let time = clock(), errors: unknown[] = [], calls = 0
  let stop = watchRevision(
    () => {
      calls++
      return Promise.reject(new Error('disk unavailable'))
    },
    () => {},
    (error) => errors.push(error),
    time,
  )
  await time.advance(500)
  equal([calls, errors.length, (errors[0] as Error).message], [
    1,
    1,
    'disk unavailable',
  ])
  stop()
})
