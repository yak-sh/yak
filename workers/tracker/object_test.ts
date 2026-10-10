// A failed boot still serves refusals and retries on the next request. A
// read outage cannot affect trusted intake into another independently held DO.
import { equal, ok, test } from '@yaks/testing'
import { ram } from '@yaks/ram'
import { capture } from '@yaks/tracker/report'
import { type State, Tracker } from './object.ts'
import { options, store, vocab } from './core.ts'
import { sign } from './auth.ts'
import { durable } from '../../packages/durable-object/testing.ts'
import { platform } from './core.ts'
import { worker } from './worker.ts'
import type { Message } from '@yaks/mail'

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
      get: () => Promise.resolve(undefined),
      put: async () => {},
      setAlarm: (at) => {
        alarms.push(at)
        return Promise.resolve()
      },
    },
  }
  let secret = 'scratch'
  let object = new Tracker(state, {
    TRACKER_SECRET: secret,
    ERRORS: {
      send: () => Promise.reject(Error('reporting unavailable')),
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

test('mail activation skips existing bugs and sends new openings once across restarts', async () => {
  let db = durable(), sent: Message[] = []
  let state: State = {
    id: { name: platform },
    getWebSockets: () => [],
    acceptWebSocket: () => {},
    storage: {
      ...db,
      get: () => Promise.resolve(undefined),
      put: async () => {},
      setAlarm: async () => {},
    },
  }
  let object = new Tracker(state, { ERRORS: { send: async () => {} } })
  let tracker = await object.boot()
  let old = crypto.randomUUID()
  await tracker.graph.apply([{
    entity: { eid: old },
    created: { at: '2026-10-01T00:00:00Z' },
    bug: { fault: 'old', spot: 'old.ts' },
    doc: { title: 'old defect' },
  }], { trusted: true, stamp: false })
  let env = {
    TRACKER_SECRET: 'scratch',
    ERRORS: { send: async () => {} },
    MAIL_FROM: 'task@bot.yak.sh',
    MAIL_TO: 'jeff@yak.sh',
    MAIL: {
      send: (letter: Message) => {
        sent.push(letter)
        return Promise.resolve({ messageId: 'sent-once' })
      },
    },
  }
  object = new Tracker(state, env, () => Date.parse('2026-10-02T00:00:00Z'))
  // A trace wake cannot initialize mail; an ordinary wake activates it later.
  await object.boot(false)
  await object.alarm()
  equal(sent.length, 0)
  let rows = capture(Error('new defect'), { sink: () => {}, fault: 'new' })
  await object.ingest(rows)
  await object.alarm()
  equal(sent.length, 1)
  equal(sent[0].to, env.MAIL_TO)
  equal(sent[0].from, env.MAIL_FROM)
  ok(sent[0].text.includes('https://tracker.yak.sh/'))
  let [letter] = await object.tracker!.graph.read('.mail *')
  equal((letter.mail as { message_id: string }).message_id, 'sent-once')
  let newest = (letter.mail as { target: string }).target
  // A later deployment must preserve activation time and delivery receipts.
  object = new Tracker(state, env, () => Date.parse('2027-01-01T00:00:00Z'))
  await object.ingest(rows)
  await object.alarm()
  equal(sent.length, 1)
  equal((await object.tracker!.graph.read('.mail')).length, 1)
  equal(!!(await object.tracker!.graph.get([old]))[0].notified, false)
  equal(!!(await object.tracker!.graph.get([newest]))[0].notified, true)
  // Delayed grouping of a new opening still mails after an eviction.
  let late = crypto.randomUUID()
  await object.tracker!.graph.apply([{
    entity: { eid: late },
    created: { at: '2026-10-03T00:00:00Z' },
    bug: { fault: 'late', spot: 'late.ts' },
    doc: { title: 'delayed defect' },
  }], { trusted: true, stamp: false })
  await object.alarm()
  equal(sent.length, 2)
  let ticket = await sign({
    scope: platform,
    person: 'scratch',
    admin: true,
    exp: Date.now() / 1000 + 60,
  }, env.TRACKER_SECRET)
  let w = worker({
    ...env,
    ERRORS: { send: (rows) => object.ingest(rows) },
    TRACKERS: { getByName: () => object },
  })
  equal(
    (await w.fetch(
      new Request(
        `https://tracker.test/canary?scope=platform&hash=${'b'.repeat(64)}`,
        { method: 'POST', headers: { authorization: `Bearer ${ticket}` } },
      ),
    )).status,
    200,
  )
  await object.alarm()
  equal(sent.length, 2)
  equal((await object.tracker!.graph.read('.bug .archived')).length, 1)
})
