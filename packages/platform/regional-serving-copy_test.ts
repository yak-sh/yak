import { clock, equal, test } from '@yaks/testing'
import {
  fenceRegionalCopies,
  REGIONAL_CLOCK_SKEW_MS,
  REGIONAL_LEASE_MS,
  type RegionalCopyChange,
  type RegionalCopySnapshot,
  RegionalServingCopy,
} from './regional-serving-copy.ts'
import { ServingCopyUnavailable } from './serving-copy.ts'

let fixture = (now: () => number, maxAnswers?: number) => {
  let saved: RegionalCopySnapshot | undefined
  let writes = 0, unavailable = false
  let restart = () =>
    new RegionalServingCopy({
      clock: { now },
      maxAnswers,
      persistence: {
        read: () => structuredClone(saved),
        write: ({ state, clear, remove, put }: RegionalCopyChange) => {
          if (unavailable) throw new Error('persistence unavailable')
          let answers = new Map(clear ? undefined : saved?.answers)
          for (let key of remove ?? []) answers.delete(key)
          if (put) {
            answers.delete(put[0])
            answers.set(...put)
          }
          saved = structuredClone({ state, answers: [...answers] })
          writes++
        },
      },
    })
  return {
    copy: restart(),
    restart,
    writes: () => writes,
    unavailable: (failed: boolean) => unavailable = failed,
  }
}

let read = (copy: RegionalServingCopy, key = 'page') => {
  try {
    return copy.read(key)
  } catch (e) {
    if (!(e instanceof ServingCopyUnavailable)) throw e
    return null
  }
}

let lease = (epoch: number, revision: number, start = 0) => ({
  epoch,
  revision,
  until: start + REGIONAL_LEASE_MS,
})
let invalidate = (copy: RegionalServingCopy, epoch: number) => () =>
  Promise.resolve(copy.invalidate(epoch))

test('regional routes and their grant survive idle and restart', async () => {
  let time = clock()
  let f = fixture(time.now)
  let granted = lease(0, 4)
  equal(f.copy.publish(granted, 'page', 'release 4'), true)
  await time.advance(21_000)
  let resumed = f.restart()
  equal(read(resumed), { ...granted, body: 'release 4' })
  equal(resumed.publish(granted, 'page', 'release 4'), true)
  equal(f.writes(), 1)
  await time.advance(granted.until - REGIONAL_CLOCK_SKEW_MS - time.now())
  equal(read(f.restart()), null)
  equal(f.restart().publish(granted, 'page', 'delayed'), false)
  let renewed = lease(0, 4, time.now())
  equal(resumed.publish(renewed, 'page', 'release 4'), true)
  equal(read(f.restart()), { ...renewed, body: 'release 4' })
})

test('a durable fence rejects old fills after restart and admits a rolled-back route', () => {
  let { copy, restart } = fixture(() => 1)
  let old = lease(1, 4)
  equal(copy.publish(old, 'page', 'release 4'), true)
  copy.invalidate(2)
  let resumed = restart()
  equal(read(resumed), null)
  equal(resumed.publish(old, 'page', 'delayed'), false)
  let rollback = lease(2, 4)
  equal(resumed.publish(rollback, 'page', 'release 4'), true)
  resumed.invalidate(2)
  equal(read(restart()), { ...rollback, body: 'release 4' })
  resumed.invalidate(3)
  let committed = lease(3, 5)
  equal(resumed.publish(committed, 'page', 'release 5'), true)
  equal(restart().publish(rollback, 'page', 'delayed'), false)
  equal(read(restart()), { ...committed, body: 'release 5' })
})

test('an unacknowledged regional fence drains the persisted authority deadline', async () => {
  let authority = clock(1000)
  let broken = fixture(() => authority.now() - REGIONAL_CLOCK_SKEW_MS)
  let healthy = fixture(authority.now)
  let old = lease(0, 4, authority.now())
  broken.copy.publish(old, 'page', 'public')
  healthy.copy.publish(old, 'page', 'public')
  let committed = false
  let write = fenceRegionalCopies([
    { until: old.until, invalidate: () => new Promise(() => {}) },
    { until: old.until, invalidate: invalidate(healthy.copy, 1) },
  ], authority).then((fences) => {
    committed = true
    return fences
  })
  await authority.advance(1000)
  equal(read(healthy.restart()), null)
  equal(read(broken.restart())?.body, 'public')
  await authority.advance(old.until - authority.now() - 1)
  equal(committed, false)
  equal(read(broken.restart())?.body, 'public')
  await authority.advance(1)
  equal(await write, [false, true])
  equal(read(broken.restart()), null)
  equal(broken.restart().publish(old, 'page', 'late public'), false)
})

test('a durable fence acknowledges before grant expiry and rejected writes do not acknowledge', async () => {
  let time = clock()
  let f = fixture(time.now)
  let old = lease(0, 2)
  f.copy.publish(old, 'page', 'public')
  f.unavailable(true)
  let outstanding = fenceRegionalCopies([{
    until: old.until,
    invalidate: invalidate(f.copy, 1),
  }], time)
  await time.advance(1000)
  equal(read(f.restart())?.body, 'public')
  f.unavailable(false)
  equal(
    await fenceRegionalCopies([{
      until: old.until,
      invalidate: invalidate(f.copy, 1),
    }], time),
    [true],
  )
  equal(read(f.restart()), null)
  await time.advance(old.until - time.now())
  equal(await outstanding, [false])
})

test('a slow acknowledgement commits without waiting for the lease deadline', async () => {
  let time = clock()
  let f = fixture(time.now)
  let old = lease(0, 2)
  f.copy.publish(old, 'page', 'public')
  let acknowledge!: () => void
  let write = fenceRegionalCopies([{
    until: old.until,
    invalidate: () =>
      new Promise<void>((resolve) => {
        acknowledge = () => {
          f.copy.invalidate(1)
          resolve()
        }
      }),
  }], time)
  await time.advance(1000)
  acknowledge()
  equal(await write, [true])
  equal(read(f.restart()), null)
  equal(time.pending(), 0)
})

test('regional bounds and fill order persist without rewriting existing bodies', () => {
  let f = fixture(() => 1, 2)
  let grant = lease(0, 2)
  f.copy.publish(grant, 'a', 'oldest')
  f.copy.publish(grant, 'b', 'newer')
  let resumed = f.restart()
  equal(read(resumed, 'a')?.body, 'oldest')
  equal(resumed.publish(grant, 'a', 'oldest'), true)
  equal(f.writes(), 2)
  resumed.publish(grant, 'c', 'newest')
  let trimmed = f.restart()
  equal(read(trimmed, 'a'), null)
  equal(read(trimmed, 'b')?.body, 'newer')
  equal(read(trimmed, 'c')?.body, 'newest')
  equal(trimmed.publish(grant, 'large', 'a'.repeat(64 * 1024)), false)
})

test('a restarted copy refuses to serve behind its persisted clock observation', () => {
  let now = 6000
  let f = fixture(() => now)
  let grant = lease(0, 1, now)
  f.copy.publish(grant, 'page', 'public')
  now = 5999
  equal(read(f.restart()), null)
  equal(f.restart().publish(lease(0, 1, 8000), 'page', 'public'), false)
  now = 8000
  equal(read(f.restart()), { ...grant, body: 'public' })
})
