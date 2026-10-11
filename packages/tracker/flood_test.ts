// Reporting is exercised with its spool and tracker sinks and a clock that
// expires windows without sleeping or touching a host's filesystem.

import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { capture, coalesce, spool, type WindowClock } from './report.ts'
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

let rig = () => {
  let ticks = clock()
  let records: Bundle[][] = []
  let sink = coalesce(
    spool((line) => {
      records.push(JSON.parse(line))
    }),
    { window: 100, clock: ticks.time },
  )
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
  }
}

test('a burst reaches the tracker immediately and closes as one counted fault', async () => {
  let r = rig()
  let immediate = r.report()
  equal(r.records.length, 1)
  await immediate
  await r.report(broken, 'repeat')
  await r.report(broken, 'latest')
  await r.report(broken, 'latest')
  equal(r.records.length, 1)
  equal(comp(r.records[0][0], 'during').entity, 'call')
  equal(comp(r.records[0][0], 'exception').stack, broken.stack)
  await r.advance(100)
  equal(r.records.length, 2)
  equal(comp(r.records[1][0], 'error').hits, 3)
  equal(r.records[1][0].during, {
    kind: 'call',
    entity: 'latest',
    process: 'worker',
  })
  let first = grouped(r.records[0][0], undefined, [])
  let counted = grouped(r.records[1][0], first[1], [first[0]])
  equal(comp(counted[1], 'bug').hits, 4)
})

test('two different faults each reach the tracker at once', async () => {
  let r = rig()
  await r.report()
  await r.report(other)
  equal(r.records.length, 2)
  equal(comp(r.records[1][0], 'exception').value, other.message)
  await r.sink.close()
  equal(r.records.length, 2)
})

test('a fault after its window goes at once even when its timer is late', async () => {
  let r = rig()
  await r.report()
  await r.report()
  await r.advance(100, false)
  await r.report()
  equal(r.records.length, 3)
  await r.advance(100)
  equal(r.records.length, 3)
  await r.report()
  equal(r.records.length, 4)
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
