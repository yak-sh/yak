// A failed or held sync reaches the independent local notification path once.
import { clock, equal, test, throws } from '@yaks/testing'
import { watching } from './sync_health.ts'

let failure = Error('offline')
let down = () => Promise.reject(failure)
let scenario = async () => {
  let time = clock(), notices: string[] = []
  let watch = watching(
    (error) => {
      notices.push(error.message)
      return Promise.resolve()
    },
    'delivery',
    (run, ms) => time.after(ms, run),
  )
  await watch(down).catch(() => {})
  await watch(down).catch(() => {})
  let failed = notices.length
  await watch(async () => {})
  let release!: () => void
  let running = watch(() =>
    new Promise<void>((done) => {
      release = done
    })
  )
  await time.advance(60_000)
  let held = notices.length
  await time.advance(60_000)
  let quiet = notices.length
  release()
  await running
  await watch(down).catch(() => {})
  return { failed, held, quiet, recovered: notices.length }
}
let seen = await scenario()
test('sync failure and held pass notify once until a successful pass rearms it', () => {
  equal(seen, { failed: 1, held: 2, quiet: 2, recovered: 3 })
})
test('sync watchdog preserves the failing errand outcome', async () => {
  let watch = watching(async () => {}, 'delivery')
  await throws(() => watch(down))
})
