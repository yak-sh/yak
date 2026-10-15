// Platform catches deliver failures and bounded repeat counts through the
// tracker's queue interface, with invocation context kept apart.
import { clock, equal, ok, test } from '@yaks/testing'
import { type Bundle, Refused } from '@yaks/graph'
import { capture, origin } from '@yaks/tracker/report'
import { batch } from '../tracker/queue.ts'
import { platform } from '../tracker/core.ts'
import { CallError } from '@yaks/tools/errors'
import {
  caught,
  defect,
  delivery,
  redone,
  refusing,
  within,
} from './defects.ts'
import { Pending } from './writes.ts'
import { type Own, replaced } from '@yaks/durable-object'

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

// A failure with its stack already said: a report reads the stack, and
// formatting a fresh one is the runtime's work, not what these check.
let said = <E extends Error>(e: E) =>
  Object.assign(e, {
    stack: `${e.name}: ${e.message}\n    at failed (app.ts:1:1)`,
  })
let storm = said(new TypeError('storm'))

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

let request = new Request('https://yaks.app/mcp?token=secret', {
  method: 'POST',
  headers: { authorization: 'secret' },
  body: 'secret',
})
test('nested catches retain runtime origin and its request companion', async () => {
  let { rows, time, env } = recorded()
  await within(
    env,
    {},
    () => {
      return within(env, { tool: 'inspect' }, () => {
        caught(reused, { request: 'tool catch' })
      })
    },
    time,
    { origin: origin('yak', 'deploy', 'gateway fetch', request) },
  )
  let [error, http] = rows[0]
  equal((error.error as { tags: unknown }).tags, {
    script: 'yak',
    version: 'deploy',
    entrypoint: 'gateway fetch',
    tool: 'inspect',
    request: 'tool catch',
  })
  equal(error.during, { request: http.entity.eid })
  equal(http.request, {
    method: 'POST',
    url: 'https://yaks.app/mcp',
    route: 'gateway fetch',
    status: undefined,
    ms: undefined,
    agent: undefined,
  })
})

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

test('a door keeps a refusal or relayed answer at its status and throws its own failure on, each reported once', async () => {
  let { rows, time, env } = recorded()
  let door = (e: unknown) => {
    try {
      return refusing(e, { request: 'door' })
    } catch (thrown) {
      caught(thrown, { request: 'entry' })
      return thrown
    }
  }
  let broke = said(new TypeError('fell over'))
  let answers = await within(env, {}, () =>
    [
      new Refused('no'),
      new CallError('missing', 'no such product'),
      Object.assign(new Error('relayed'), { status: 403 }),
      Object.assign(new Error('stalled'), { name: 'Refused', status: 503 }),
      new Pending('kept'),
      said(Object.assign(new Error('store fell over'), { status: 500 })),
      broke,
    ].map(door), time)
  equal(answers, [400, 404, 403, 503, 202, 500, broke])
  equal(
    rows.map(([row]) => [
      (row.exception as { value: string }).value,
      (row.error as { tags: unknown }).tags,
    ]),
    [
      ['store fell over', { request: 'door' }],
      ['fell over', { request: 'door' }],
    ],
  )
})

// What an instance the runtime moved meets is its replacement's to redo; the
// same words reaching a live object or the Worker are a call out of retries.
let GONE =
  'Connection closed: this Durable Object instance is no longer active. Reconnect or retry the request.'
let CODE = 'Durable Object reset because its code was updated.'
let TIMEOUT =
  'Durable Object storage operation exceeded timeout which caused object to be reset.'
// An instance's storage. One reset for a deploy refuses writes and still
// answers reads; one no longer active refuses both.
let refuse = (words: string) => (): never => {
  throw new Error(words)
}
let storage = (write = () => {}, read: () => unknown = () => []): Own => ({
  sql: { exec: read },
  transactionSync: (body) => (write(), body()),
})

test('a moved instance reports none of its resets; a live caller and our own reset do', () => {
  let redoneBy = (instance?: Own) =>
    [GONE, CODE, TIMEOUT].map((words) =>
      redone(new Error(words), instance && (() => replaced(instance)))
    )
  equal(redoneBy(storage(refuse(CODE))), [true, true, false])
  equal(redoneBy(storage(undefined, refuse(GONE))), [true, true, false])
  equal(redoneBy(storage()), [false, false, false])
  equal(redoneBy(), [false, false, false])
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
