// A seat kept a moment for everyone who asks (seated.ts): many asks, one read.
import { clock, equal, test } from '@yaks/testing'
import { SEATED, seated } from './seated.ts'

// A directory that says `role` for each person, counting its reads.
let directory = (role: (person: string) => string | null) => {
  let reads = 0, time = clock()
  let seat = seated(
    (person: string) => person,
    (person: string) => (reads++, Promise.resolve({ role: role(person) })),
    (seat) => seat.role != null,
    () => time,
  )
  return { seat, time, reads: () => reads }
}

test('asks for one seat, together or within the window, share one read', async () => {
  let d = directory(() => 'editor')
  let asks = await Promise.all(Array.from({ length: 50 }, () => d.seat('ada')))
  equal([asks[49], d.reads()], [{ role: 'editor' }, 1])
  await d.time.advance(SEATED - 1)
  await d.seat('ada')
  equal(d.reads(), 1)
  await d.seat('bea')
  equal(d.reads(), 2)
  await d.time.advance(1)
  await d.seat('ada')
  equal(d.reads(), 3)
})

test('a seat that gives nothing, or a read that failed, is read again at once', async () => {
  let role: string | null = null
  let d = directory(() => role)
  equal(await d.seat('ada'), { role: null })
  role = 'owner'
  equal([await d.seat('ada'), d.reads()], [{ role: 'owner' }, 2])

  let tries = 0
  let failing = seated(
    () => 'ada',
    () =>
      ++tries == 1
        ? Promise.reject(new Error('overloaded'))
        : Promise.resolve(1),
    () => true,
  )
  await failing().catch(() => {})
  equal([await failing(), tries], [1, 2])
})
