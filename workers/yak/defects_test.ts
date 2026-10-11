// Platform catches deliver failures and bounded repeat counts through the
// tracker's queue interface, with invocation context kept apart.
import { clock, equal, ok, test } from '@yaks/testing'
import { type Bundle, Refused } from '@yaks/graph'
import { capture } from '@yaks/tracker/report'
import { batch } from '../tracker/queue.ts'
import { platform } from '../tracker/core.ts'
import { caught, defect, delivery, within } from './defects.ts'

let recorded = () => {
  let rows: Bundle[][] = []
  let time = clock()
  let env = {
    ERRORS: {
      send: (sample: Bundle[]) => {
        rows.push(sample)
        return Promise.resolve()
      },
    },
    CF_VERSION_METADATA: { id: 'deploy' },
    ENVIRONMENT: 'staging',
  }
  return { rows, time, env }
}

let storm = Object.assign(new TypeError('storm'), {
  stack: 'TypeError: storm\n    at failed (app.ts:1:1)',
})

test('platform repeats reach tracker with hit counts and catch tags', async () => {
  let { rows, time, env } = recorded()
  let sink = delivery(env, time)
  let sample = () =>
    capture(storm, {
      sink,
      tags: { space: 'throwaway', app: 'probe', request_id: 'request' },
    })
  for (let i = 0; i < 7; i++) await sink(sample())
  equal(rows.length, 1)
  await time.advance(10_000)
  equal(rows.map((r) => (r[0].error as { hits?: number }).hits ?? 1), [1, 6])
  for (let sample of rows) {
    equal(batch(sample).scope, platform)
    equal(sample[0].during, undefined)
    equal((sample[0].error as { tags: unknown }).tags, {
      space: 'throwaway',
      app: 'probe',
      request_id: 'request',
    })
  }
})

let reused = Error('reused error')
// Stack capture belongs to the input fixture, rather than the repeat counter.
void reused.stack

test('a caught failure counts once per invocation and refusals stay back', async () => {
  let { rows, time, env } = recorded()
  let error = reused
  for (let i = 0; i < 4; i++) {
    await within(env, { request_id: 'invocation' }, () => {
      caught(new Refused('no'), {})
      defect(error, { store: 'ada/notes' })
      caught(error, { request: 'outer catch' })
    }, time)
  }
  equal(rows.length, 1)
  await time.advance(10_000)
  equal(rows.length, 2)
  equal((rows[1][0].error as { hits: number }).hits, 3)
  equal(rows[0][0].error, {
    at: (rows[0][0].error as { at: string }).at,
    level: 'error',
    commit: 'deploy',
    environment: 'staging',
    tags: { request_id: 'invocation', store: 'ada/notes' },
  })
  ok(rows.every((r) => batch(r).scope == platform))
})

test('parallel invocation tags remain isolated and escaping failures reach tracker', async () => {
  let { rows, time, env } = recorded()
  let resume = Promise.withResolvers<void>()
  let first = within(env, { request_id: 'first' }, async () => {
    await resume.promise
    caught(Error('first failure'), { request: 'first catch' })
  }, time)
  let second = within(env, { request_id: 'second' }, () => {
    resume.resolve()
    return Promise.reject(Error('second failure'))
  }, time)
  let results = await Promise.allSettled([first, second])
  equal(results.map((r) => r.status), ['fulfilled', 'rejected'])
  equal(rows.map((r) => (r[0].error as { tags: unknown }).tags), [
    { request_id: 'first', request: 'first catch' },
    { request_id: 'second' },
  ])
})
