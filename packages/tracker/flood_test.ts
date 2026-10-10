// Reporting is exercised with its spool and Sentry adapters and a clock that
// expires windows without sleeping or touching a host's filesystem.

import { equal, ok, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { capture, coalesce, fanout, spool, type WindowClock } from './report.ts'
import { sentry, type SentryEvent } from './sentry.ts'
import { comp } from './model.ts'
import { group, grouped } from './group.ts'
import { fixture } from './fixture_test.ts'
import { intake } from './service.ts'

let broken = Object.assign(new Error('no such table: ref'), {
  stack: 'Error: no such table: ref\n    at query (/app/query.ts:7:3)',
})
let other = Object.assign(new TypeError('mail unavailable'), {
  stack: 'TypeError: mail unavailable\n    at post (/app/mail.ts:8:2)',
})
let refusal = new Error('Sentry report request answered 429')
let admitted = fixture(), counted = fixture()
let countedRows = capture('missing table', { sink: () => {} })
countedRows[0].error = { ...comp(countedRows[0], 'error'), hits: 130_000 }
await counted.apply(countedRows, { trusted: true })

let clock = () => {
  let now = 0
  let timers = new Set<{ at: number; run: () => Promise<void> }>()
  let time: WindowClock = {
    now: () => now,
    after: (ms, run) => {
      let timer = { at: now + ms, run }
      timers.add(timer)
      return () => {
        timers.delete(timer)
      }
    },
  }
  return {
    time,
    advance: async (ms: number, fire = true) => {
      now += ms
      if (fire) {
        await Promise.all(
          [...timers].filter((timer) => timer.at <= now)
            .map((timer) => timer.run()),
        )
      }
    },
  }
}

let rig = (reject = false) => {
  let ticks = clock()
  let records: Bundle[][] = []
  let events: SentryEvent[] = []
  let deliveries = fanout({
    spool: spool((line) => {
      records.push(JSON.parse(line))
    }),
    sentry: sentry((event) => {
      events.push(event)
      return reject ? Promise.reject(refusal) : Promise.resolve()
    }),
  })
  let sink = coalesce(deliveries, { window: 100, clock: ticks.time })
  let report = (error = broken, context = 'call') =>
    sink(capture(error, {
      sink,
      eid: `sample-${ticks.time.now()}-${context}`,
      at: new Date(ticks.time.now()).toISOString(),
      during: { kind: 'call', entity: context, process: 'worker' },
      tags: { handler: 'query' },
      commit: 'sha',
    }))
  return {
    ...ticks,
    sink,
    report,
    records,
    events,
    failures: deliveries.failures,
  }
}

test('a burst reaches both sinks immediately and closes as one counted fault', async () => {
  let r = rig()
  let immediate = r.report()
  equal(r.records.length, 1)
  equal(r.events.length, 1)
  await immediate
  await r.report(broken, 'repeat')
  await r.report(broken, 'latest')
  await r.report(broken, 'latest')
  equal(r.records.length, 1)
  equal(r.events.length, 1)
  equal(comp(r.records[0][0], 'during').entity, 'call')
  equal(comp(r.records[0][0], 'exception').stack, broken.stack)
  equal(r.events[0].extra?.hits, 1)
  equal(r.events[0].tags.entity, 'call')
  equal(r.events[0].exception.values[0].stacktrace?.frames, [{
    filename: '/app/query.ts',
    lineno: 7,
    colno: 3,
    function: 'query',
  }])
  await r.advance(100)
  equal(r.records.length, 2)
  equal(r.events.length, 2)
  equal(comp(r.records[1][0], 'error').hits, 3)
  equal(r.events[1].extra?.hits, 3)
  equal(r.events[1].fingerprint, r.events[0].fingerprint)
  let first = grouped(r.records[0][0], undefined, [])
  let counted = grouped(r.records[1][0], first[1], [first[0]])
  equal(comp(counted[1], 'bug').hits, 4)
})

test('two different faults each reach both sinks at once', async () => {
  let r = rig()
  await r.report()
  await r.report(other)
  equal(r.records.length, 2)
  equal(r.events.length, 2)
  ok(r.events[0].fingerprint?.[1] != r.events[1].fingerprint?.[1])
  equal(r.events[1].exception.values[0].value, other.message)
  await r.sink.close()
  equal(r.records.length, 2)
})

test('a Sentry refusal is counted without creating a spool error', async () => {
  let r = rig(true)
  let log = console.error
  let diagnostics = 0
  console.error = () => diagnostics++
  try {
    await r.report()
    await r.report()
    await r.report()
    equal(r.records.length, 1)
    equal(r.failures.sentry, 1)
    await r.advance(100)
    equal(r.records.length, 2)
    equal(r.failures, { spool: 0, sentry: 2 })
    equal(diagnostics, 2)
    equal(r.records.map((rows) => comp(rows[0], 'exception').value), [
      broken.message,
      broken.message,
    ])
    equal(r.events.map((event) => event.extra?.hits), [1, 2])
  } finally {
    console.error = log
  }
})

test('a fault after its window goes at once even when its timer is late', async () => {
  let r = rig()
  await r.report()
  await r.report()
  await r.advance(100, false)
  await r.report()
  equal(r.records.length, 3)
  equal(r.events.map((event) => event.extra?.hits), [1, 1, 1])
  await r.advance(100)
  equal(r.records.length, 3)
  await r.report()
  equal(r.records.length, 4)
  equal(r.events[3].extra?.hits, 1)
  await r.sink.close()
})

test('closing reporting flushes repeats and waits for outstanding deliveries', async () => {
  let ticks = clock()
  let records: Bundle[][] = []
  let release!: () => void
  let waiting = new Promise<void>((resolve) => release = resolve)
  let sink = coalesce((rows) => {
    records.push(rows)
    return waiting
  }, { clock: ticks.time })
  let rows = capture(broken, { sink })
  let first = sink(rows)
  await sink(capture(broken, { sink }))
  let finished = false
  let closing = sink.close().then(() => finished = true)
  equal(records.length, 2)
  equal(comp(records[1][0], 'error').hits, 1)
  equal(finished, false)
  release()
  await first
  await closing
  equal(finished, true)
  await ticks.advance(60_000)
  equal(records.length, 2)
})

test('normalization and explicit faults collapse within their own app', async () => {
  let ticks = clock()
  let records: Bundle[][] = []
  let sink = coalesce((rows) => {
    records.push(rows)
  }, { clock: ticks.time })
  let sample = (message: string, app: string, fault?: string) =>
    sink(capture(message, { sink, fault, during: { app } }))
  await sample('missing row 42', 'one')
  await sample('missing row 99', 'one')
  await sample('missing row 42', 'two')
  await sample('first message', 'one', 'explicit')
  await sample('second message', 'one', 'explicit')
  equal(records.length, 3)
  await sink.close()
  equal(records.length, 5)
})

test('intake preserves the count on a flood sample', async () => {
  let rows = capture('missing table', { sink: () => {} })
  rows[0].error = { ...comp(rows[0], 'error'), hits: 130_000 }
  let source = async function* () {
    yield { rows, ack: () => {} }
  }
  await intake(admitted, source)
  let [sample] = await admitted.get([rows[0].entity.eid])
  equal(comp(sample, 'error').hits, 130_000)
})

test('grouping adds a flood count once when its sample is retried', async () => {
  let eid = countedRows[0].entity.eid
  await group(counted, eid)
  await group(counted, eid)
  let [bug] = await counted.read('.bug *')
  equal(comp(bug, 'bug').hits, 130_000)
})
