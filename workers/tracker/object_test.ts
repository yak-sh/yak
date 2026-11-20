// A failed boot still serves refusals and retries on the next request. A
// read outage cannot affect trusted intake into another independently held DO.
import { equal, test } from '@yaks/testing'
import { ram } from '@yaks/ram'
import { capture } from '@yaks/tracker/report'
import { type State, Tracker } from './object.ts'
import { options, store, vocab } from './core.ts'
import { sign } from './auth.ts'
import type { Bundle, Comp } from '@yaks/graph'
import { platform } from './core.ts'
import { durable } from '../../packages/durable-object/testing.ts'

let space = '00000000-0000-4000-8000-000000000001'

// What an instance the runtime reset for a deploy meets is its replacement's
// to redo: the reset refuses its writes in the runtime's words.
let CODE = 'Durable Object reset because its code was updated.'
// How many reports an instance sends for a reset it recovers from.
let reported = async (reset: boolean) => {
  let sent: Bundle[][] = []
  let { sql, transactionSync } = durable()
  let object = new Tracker({
    id: { name: space },
    getWebSockets: () => [],
    acceptWebSocket: () => {},
    storage: {
      sql,
      transactionSync: (body) => {
        if (reset) throw Error(CODE)
        return transactionSync(body)
      },
      get: () => Promise.resolve(undefined),
      put: async () => {},
      getAlarm: () => Promise.resolve(null),
      setAlarm: () => Promise.resolve(),
    },
  }, { ERRORS: { send: (rows) => Promise.resolve(void sent.push(rows)) } })
  await object.recover(Error(CODE), 'Tracker.alarm')
  return sent.length
}
test('a reset instance reports none of its own resets', async () => {
  equal(await reported(true), 0)
})
test('a live instance reports a reset it meets', async () => {
  equal(await reported(false), 1)
})
test('postboot failure does not poison the object and reporting never throws', async () => {
  let alarms: number[] = []
  let state: State = {
    id: { name: space },
    getWebSockets: () => [],
    acceptWebSocket: () => {},
    storage: {
      sql: {
        exec: () => {
          throw Error('scratch storage unavailable')
        },
      },
      transactionSync: (body) => body(),
      get: () => Promise.resolve(undefined),
      put: async () => {},
      getAlarm: () => Promise.resolve(null),
      setAlarm: (at) => {
        alarms.push(at)
        return Promise.resolve()
      },
    },
  }
  let secret = 'scratch'
  let sent: Bundle[][] = []
  let object = new Tracker(state, {
    TRACKER_SECRET: secret,
    CF_VERSION_METADATA: { id: '00000000-0000-4000-8000-000000000011' },
    ERRORS: {
      send: (rows) => {
        sent.push(rows)
        return Promise.reject(Error('reporting unavailable'))
      },
    },
  })
  let ticket = await sign({
    scope: space,
    person: 'scratch',
    exp: Date.now() / 1000 + 60,
  }, secret)
  let request = () =>
    new Request('https://tracker.test/bugs', {
      headers: { authorization: `Bearer ${ticket}` },
    })
  // Suppress only this test's known fallback report, not the object failure.
  let report = console.error
  try {
    console.error = () => {}
    equal((await object.fetch(request())).status, 503)
  } finally {
    console.error = report
  }
  equal(object.tracker, undefined)
  let [failure, companion] = sent[0]
  equal((failure.error as Comp).tags, {
    script: 'yak-tracker',
    version: '00000000-0000-4000-8000-000000000011',
    entrypoint: 'Tracker.fetch',
  })
  equal((failure.error as Comp).commit, '00000000-0000-4000-8000-000000000011')
  equal(failure.during, { request: companion.entity.eid })
  equal((companion.request as Comp).method, 'GET')
  equal((companion.request as Comp).url, 'https://tracker.test/bugs')
  equal(alarms.length, 1)
  object.tracker = store(ram(vocab, options), { sink: () => {} })
  equal((await object.fetch(request())).status, 200)
  await object.ingest(capture(Error('independent intake'), {
    sink: () => {},
    during: { space },
  }))
  equal((await object.tracker.graph.read('.error')).length, 1)
})

test('a platform object tells an admin the bundle it runs, before booting', async () => {
  let secret = 'scratch'
  let object = new Tracker({
    id: { name: platform },
    getWebSockets: () => [],
    acceptWebSocket: () => {},
    storage: {
      sql: {
        exec: () => {
          throw Error('scratch storage unavailable')
        },
      },
      transactionSync: (body) => body(),
      get: () => Promise.resolve(undefined),
      put: async () => {},
      getAlarm: () => Promise.resolve(null),
      setAlarm: () => Promise.resolve(),
    },
  }, {
    TRACKER_SECRET: secret,
    BUNDLE_HASH: 'a'.repeat(64),
    CF_VERSION_METADATA: { id: '00000000-0000-4000-8000-000000000012' },
  })
  let ask = async (admin: boolean) =>
    await object.fetch(
      new Request('https://tracker.internal/bundle', {
        headers: {
          authorization: `Bearer ${await sign({
            scope: platform,
            person: platform,
            admin,
            exp: Date.now() / 1000 + 60,
          }, secret)}`,
        },
      }),
    )
  equal(await (await ask(true)).json(), {
    hash: 'a'.repeat(64),
    version: '00000000-0000-4000-8000-000000000012',
  })
  equal((await ask(false)).status, 403)
})
test('the platform lists each space tracker it enrolled once, to an admin', async () => {
  let secret = 'scratch', kept = new Map<string, unknown>()
  let object = new Tracker({
    id: { name: platform },
    getWebSockets: () => [],
    acceptWebSocket: () => {},
    storage: {
      sql: {
        exec: () => {
          throw Error('scratch storage unavailable')
        },
      },
      transactionSync: (body) => body(),
      get: <T>(key: string) => Promise.resolve(kept.get(key) as T),
      put: (key, value) => Promise.resolve(void kept.set(key, value)),
      getAlarm: () => Promise.resolve(null),
      setAlarm: () => Promise.resolve(),
    },
  }, { TRACKER_SECRET: secret })
  let ask = async (admin: boolean) =>
    await object.fetch(
      new Request('https://tracker.internal/scopes', {
        headers: {
          authorization: `Bearer ${await sign({
            scope: platform,
            person: platform,
            admin,
            exp: Date.now() / 1000 + 60,
          }, secret)}`,
        },
      }),
    )
  equal(await (await ask(true)).json(), { scopes: [] })
  let other = '00000000-0000-4000-8000-000000000002'
  for (let scope of [space, other, space, platform]) await object.enroll(scope)
  equal(await (await ask(true)).json(), { scopes: [space, other] })
  equal((await ask(false)).status, 403)
})
test('a retry through the door arms the alarm that works the run', async () => {
  let secret = 'scratch', alarms: number[] = []
  let { sql, transactionSync } = durable()
  let object = new Tracker({
    id: { name: platform },
    getWebSockets: () => [],
    acceptWebSocket: () => {},
    storage: {
      sql,
      transactionSync,
      get: () => Promise.resolve(undefined),
      put: async () => {},
      getAlarm: () => Promise.resolve(null),
      setAlarm: (at) => Promise.resolve(void alarms.push(at)),
    },
  }, { TRACKER_SECRET: secret })
  let tracker = await object.boot()
  await tracker.graph.apply([{
    entity: { eid: space },
    effect: {
      handler: 'bug_settle',
      target: space,
      state: 'failed',
      attempts: 10,
      at: '2026-11-06T00:00:00Z',
    },
  }], { trusted: true })
  let answer = await object.fetch(
    new Request('https://tracker.internal/retry', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await sign({
          scope: platform,
          person: platform,
          admin: true,
          mark: true,
          exp: Date.now() / 1000 + 60,
        }, secret)}`,
      },
      body: JSON.stringify({ of: 'bug_settle' }),
    }),
  )
  equal(await answer.json(), { retried: 1 })
  equal(alarms.length, 1)
})

// A grouped occurrence read back carries its stored shape (entity.archetype);
// marking it with that identity still stores the mark.
test("a space's grouped occurrences close by each door that archives them", async () => {
  let secret = 'scratch', app = '00000000-0000-4000-8000-000000000003'
  let object = new Tracker({
    id: { name: space },
    storage: durable(),
    getWebSockets: () => [],
    acceptWebSocket: () => {},
  }, { TRACKER_SECRET: secret })
  let [fixed, settled] = ['fixed', 'settled'].map((why) =>
    capture(Error(why), { sink: () => {}, during: { space, app } })
  )
  await object.ingest([...fixed, ...settled])
  await object.alarm()
  let token = await sign({
    scope: space,
    person: 'scratch',
    admin: true,
    ingest: true,
    exp: Date.now() / 1000 + 60,
  }, secret)
  let ask = async (path: string, body?: unknown) =>
    await (await object.fetch(
      new Request(`https://tracker.internal${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { authorization: `Bearer ${token}` },
        ...body ? { body: JSON.stringify(body) } : {},
      }),
    )).json()
  let open = async () =>
    (await ask(`/query?q=${encodeURIComponent('.error !archived *')}`))
      .map((b: Bundle) => b.entity.eid)
  equal((await open()).length, 2)
  let eids = [fixed[0].entity.eid]
  equal(await ask('/app-errors', { app, eids, mark: 'archived' }), {
    marked: 1,
  })
  equal(await object.settle([settled[0].entity.eid], 'fixed upstream'), 1)
  equal(await open(), [])
})
