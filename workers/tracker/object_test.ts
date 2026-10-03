// A failed boot still serves refusals and retries on the next request. A
// read outage cannot affect trusted intake into another independently held DO.
import { equal, test } from '@yaks/testing'
import { ram } from '@yaks/ram'
import { capture } from '@yaks/tracker/report'
import { type State, Tracker } from './object.ts'
import { options, store, vocab } from './core.ts'
import { sign } from './auth.ts'

let space = '00000000-0000-4000-8000-000000000001'
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
      get: async () => undefined,
      put: async () => {},
      setAlarm: async (at) => {
        alarms.push(at)
      },
    },
  }
  let secret = 'scratch'
  let object = new Tracker(state, {
    TRACKER_SECRET: secret,
    ERRORS: {
      send: async () => {
        throw Error('reporting unavailable')
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
  equal(alarms.length, 1)
  object.tracker = store(ram(vocab, options), { sink: () => {} })
  equal((await object.fetch(request())).status, 200)
  await object.ingest(capture(Error('independent intake'), {
    sink: () => {},
    during: { space },
  }))
  equal((await object.tracker.graph.read('.error')).length, 1)
})
