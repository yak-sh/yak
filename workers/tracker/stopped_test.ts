// A tracker past the rows it may read or write stops until its window ends
// (@yaks/durable-object `bounded`). A report sent to it meanwhile comes back
// on the queue once the window ends and is taken then; a stop is told as no
// bug and spends no delivery; its alarm and doors wait the window out. Each
// object is a Tracker over in-memory storage whose rows a case spends on its
// own clock, reached by the Worker through stubs that hand its failures over
// as a Durable Object's RPC does (`crossed`).
import { equal, ok, test } from '@yaks/testing'
import { bounded } from '@yaks/durable-object/ceiling'
import type { Bundle } from '@yaks/graph'
import { capture } from '@yaks/tracker/report'
import { type Clock, system } from '@yaks/fp'
import { crossed, durable } from '../../packages/durable-object/testing.ts'
import { type State, Tracker } from './object.ts'
import { type Stub, worker } from './worker.ts'
import type { Message } from './queue.ts'
import { platform } from './core.ts'
import { sign } from './auth.ts'

let MINUTE = 60_000
let SECRET = 'scratch'
let instant: Clock = {
  ...system,
  after: (_ms, go) => (queueMicrotask(go), () => {}),
}

// A failure as the object's stub hands it to the Worker.
let across = <T>(work: () => Promise<T>) =>
  work().catch((e) => {
    throw e instanceof Error ? crossed(e) : e
  })

// The platform tracker, stopping past a thousand rows written in a minute,
// the Worker in front of it, and what each put on the queue. A space's
// tracker named `down` fails every intake.
let held = async () => {
  let at = { t: 0 }
  let queued: { body: Bundle[]; delaySeconds?: number }[] = []
  let ERRORS = {
    send: (body: Bundle[], options?: { delaySeconds?: number }) =>
      Promise.resolve(void queued.push({ body, ...options })),
  }
  let db = durable()
  let ctx: State = {
    id: { name: platform },
    storage: db,
    getWebSockets: () => [],
    acceptWebSocket: () => {},
  }
  let object = new Tracker(
    ctx,
    { ERRORS, TRACKER_SECRET: SECRET },
    () => at.t,
    [{ ms: MINUTE, read: 1e9, written: 1_000 }],
  )
  let asked = 0
  let stub = {
    fetch: (r: Request) => across(() => object.fetch(r)),
    ingest: (rows: Bundle[]) => (asked++, across(() => object.ingest(rows))),
    enroll: () => Promise.resolve(),
  } as unknown as Stub
  let down = {
    ingest: () => Promise.reject(Error('space tracker down')),
    enroll: () => Promise.resolve(),
  } as unknown as Stub
  let w = worker(
    {
      ERRORS,
      TRACKER_SECRET: SECRET,
      TRACKERS: { getByName: (s) => s == platform ? stub : down },
    },
    sign,
    instant,
  )
  await object.boot()
  // Past the minute's rows written (or read): stopped until it ends.
  let spend = (kind: 'read' | 'written' = 'written') =>
    bounded(db).count({
      shape: () => 'spent',
      rowsRead: kind == 'read' ? 2e9 : 0,
      rowsWritten: kind == 'written' ? 2_000 : 0,
      returned: 0,
    })
  // A delivery of these bodies: what each message was answered with.
  let deliver = async (...bodies: unknown[]) => {
    let said: string[] = []
    await w.queue(bodies.map((body): Message => ({
      body,
      attempts: 7,
      ack: () => void said.push('ack'),
      retry: (o) => void said.push(`retry ${o?.delaySeconds}`),
    })))
    return said
  }
  let kept = async (eid: string) =>
    (await object.tracker!.graph.get([eid])).length > 0
  return { at, queued, db, object, w, spend, deliver, kept, asked: () => asked }
}
let report = (space?: string) =>
  capture(Error('missing row'), {
    sink: () => {},
    ...space ? { during: { space } } : {},
  })

// The tracker stops, and its own runaway is the report that must wait.
let first = await held()
first.spend()
let [runaway] = first.queued.splice(0)
let other = report()
let stoppedSaid = await first.deliver(runaway.body, other)
let stoppedAsked = first.asked()
let setBack = first.queued.splice(0)
let stoppedKept = await first.kept(runaway.body[0].entity.eid)
let stoppedAlarm = await first.db.getAlarm()
first.at.t = MINUTE
let endedSaid = await first.deliver(...setBack.map((q) => q.body))
let endedKept = [
  await first.kept(runaway.body[0].entity.eid),
  await first.kept(other[0].entity.eid),
]

test('a report to a stopped tracker comes back on the queue when its window ends', () => {
  equal(
    (runaway.body[0].error as { fault?: string }).fault,
    'runaway|written|' + platform,
  )
  equal(stoppedSaid, ['ack', 'ack'])
  equal(setBack, [
    { body: runaway.body, delaySeconds: 60 },
    { body: other, delaySeconds: 60 },
  ])
  equal(stoppedKept, false)
})

test('the rest of a batch for a stopped tracker waits without asking it', () => {
  equal(stoppedAsked, 1)
})

test('a stopped intake arms its tracker for the end of the window', () => {
  equal(stoppedAlarm, MINUTE)
})

test('a report set back for a stop is taken once the window ends', () => {
  equal(endedSaid, ['ack', 'ack'])
  equal(endedKept, [true, true])
  equal(first.queued.filter((q) => q.delaySeconds), [])
})

// A space's tracker fails its intake while the platform's is stopped: the
// consumer's report of it waits for the platform's window to end.
let second = await held()
second.spend()
second.queued.length = 0
let failedSaid = await second.deliver(report(crypto.randomUUID()))
let toldLater = second.queued.splice(0)
second.at.t = MINUTE
await second.deliver(...toldLater.map((q) => q.body))
let toldKept = await second.kept(toldLater[0].body[0].entity.eid)

test("the consumer's report to a stopped platform tracker waits for its window, and is taken", () => {
  equal(failedSaid, ['retry 128'])
  equal(toldLater.map((q) => q.delaySeconds), [60])
  ok(toldKept)
})

// A stopped tracker's door and its alarm, mid-window.
let third = await held()
third.spend('read')
third.queued.length = 0
third.at.t = 15_000
let ticket = await sign({
  scope: platform,
  person: platform,
  admin: true,
  exp: Date.now() / 1000 + 300,
}, SECRET)
let answer = await third.w.fetch(
  new Request('https://tracker.test/bugs?scope=platform', {
    headers: { authorization: `Bearer ${ticket}` },
  }),
)
await third.db.deleteAlarm()
await third.object.alarm()

test('a stopped tracker answers its doors with how long to wait', async () => {
  equal(answer.status, 429)
  equal(answer.headers.get('retry-after'), '45')
  equal((await answer.json()).error, 'Stopped')
})

test("a stopped tracker's alarm comes back when its window ends, and nothing is told", async () => {
  equal(await third.db.getAlarm(), MINUTE)
  equal(third.queued, [])
})

let fourth = await held()
let preserved = report()
await fourth.object.ingest(preserved)
fourth.spend('read')
let recover = async (path: string, mark = false, reason = '') => {
  let ticket = await sign({
    scope: platform,
    person: platform,
    admin: true,
    mark,
    exp: Date.now() / 1000 + 300,
  }, SECRET)
  return fourth.w.fetch(
    new Request(`https://tracker.test/${path}?scope=platform`, {
      method: path == 'resume' ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${ticket}` },
      ...path == 'resume' ? { body: JSON.stringify({ reason }) } : {},
    }),
  )
}
let inspection = await (await recover('ceiling')).json()
let denied = await recover('resume')
let unexplained = await recover('resume', true)
let resumed = await recover('resume', true, 'The boot fault is repaired')
let receipt = await resumed.json()
let restored = await recover('bugs')

test('signed recovery opens fresh windows without losing reports or disabling the ceiling', async () => {
  equal(inspection.wait, MINUTE)
  equal(denied.status, 403)
  equal(unexplained.status, 400)
  equal(resumed.status, 200)
  equal(receipt.spent, inspection.spent)
  equal(
    (await fourth.db.get<{ reason: string }>(`ceiling:resumed:${receipt.eid}`))
      ?.reason,
    'The boot fault is repaired',
  )
  equal(restored.status, 200)
  ok(await fourth.kept(preserved[0].entity.eid))
  fourth.spend('read')
  equal((await recover('bugs')).status, 429)
})

let paced = await held()
let { canary } = await import('./worker.ts')
let queuedProbe = canary('c'.repeat(64))
await paced.object.ingest(queuedProbe)
bounded(paced.db).count({
  shape: () => 'foreground writes',
  rowsRead: 0,
  rowsWritten: 750,
  returned: 0,
})
await paced.db.setAlarm(paced.at.t + 1000)
await paced.object.alarm()
let pacedAlarm = await paced.db.getAlarm()
let [waitingProbe] = await paced.object.tracker!.graph.get([
  queuedProbe[0].entity.eid,
])
// Intake while paced finds the alarm where it must stand, and asks nothing
// of the backlog to leave it there.
let pacing = paced.object.tracker!, asks = 0, ask = pacing.next
pacing.next = (now) => (asks++, ask(now))
await paced.deliver(report(), report(), report())
let pacedAsks = asks, intakeAlarm = await paced.db.getAlarm()
pacing.next = ask
paced.at.t = MINUTE
await paced.db.deleteAlarm()
await paced.object.alarm()
let [finishedProbe] = await paced.object.tracker!.graph.get([
  queuedProbe[0].entity.eid,
])

test('alarm backlog keeps request capacity and resumes at the write window instead of polling', () => {
  equal(pacedAlarm, MINUTE)
  equal([pacedAsks, intakeAlarm], [0, MINUTE])
  equal((waitingProbe.probe as { grouped?: boolean }).grouped, undefined)
  ok((finishedProbe.probe as { grouped?: string }).grouped)
})

// A flood's grouping stopped the tracker past its rows (2026-11-12): a fixer's
// mark on the bug behind it is still taken, and intake still waits.
let flooded = await held()
await flooded.object.ingest(report())
await flooded.object.tracker!.drain(flooded.at.t)
let [known] = await flooded.object.tracker!.bugs()
let mark = async (path: string, body: unknown) =>
  flooded.w.fetch(
    new Request(`https://tracker.test${path}?scope=platform`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await sign({
          scope: platform,
          person: platform,
          admin: true,
          mark: true,
          exp: Date.now() / 1000 + 300,
        }, SECRET)}`,
      },
      body: JSON.stringify(body),
    }),
  )
let fixed = { bug: known.entity.eid, cause: 'a race', recur: 'no' }
let marked: number[] = []
flooded.spend('written')
marked.push((await mark('/resolve', fixed)).status)
marked.push((await mark('/reopen', { bug: known.entity.eid })).status)
flooded.spend('read')
marked.push((await mark('/resolve', fixed)).status)
marked.push(
  (await mark('/resolve', { ...fixed, bug: crypto.randomUUID() })).status,
)

test("a stopped tracker takes a fixer's marks on its known bugs, and still sets intake back", async () => {
  equal(marked, [200, 200, 200, 404])
  let [after] = await bounded(flooded.db).free(() =>
    flooded.object.tracker!.graph.get([known.entity.eid])
  )
  equal((after.bug as { status?: string }).status, 'resolved')
  flooded.queued.length = 0
  equal(await flooded.deliver(report()), ['ack'])
  equal(flooded.queued.map((q) => q.delaySeconds), [60])
})

// A sustained intake flood leaves admitted reports room to group before the
// window ends. Deferred messages retain their capture and own no new error.
let intake = await held()
let admitted = report(), deferred = [report(), report()]
await intake.deliver(admitted)
let beforeFlood = await intake.db.getAlarm()
bounded(intake.db).count({
  shape: () => 'foreground writes',
  rowsRead: 0,
  rowsWritten: 300,
  returned: 0,
})
let floodSaid = await intake.deliver(...deferred)
let floodQueued = intake.queued.splice(0)
let afterFlood = await intake.db.getAlarm()
let pending = await Promise.all(
  deferred.map((rows) => intake.kept(rows[0].entity.eid)),
)
await intake.db.deleteAlarm()
await intake.object.alarm()
let [groupedReport] = await intake.object.tracker!.graph.get([
  admitted[0].entity.eid,
])
intake.at.t = MINUTE
let recovered = await intake.deliver(...floodQueued.map((q) => q.body))
let retained = await Promise.all(
  deferred.map((rows) => intake.kept(rows[0].entity.eid)),
)

test('intake under flood preserves its queued reports and lets admitted errors group', () => {
  equal(floodSaid, ['ack', 'ack'])
  equal(floodQueued, deferred.map((body) => ({ body, delaySeconds: 60 })))
  equal(pending, [false, false])
  equal(afterFlood, beforeFlood)
  ok((groupedReport.error as { bug?: string }).bug)
  equal(recovered, ['ack', 'ack'])
  equal(retained, [true, true])
})
