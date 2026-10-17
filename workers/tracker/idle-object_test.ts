// Idle object incarnations use durable readiness and leave SQL, KV and alarms alone.
import { equal, ok, test } from '@yaks/testing'
import { durable } from '../../packages/durable-object/testing.ts'
import { type State, Tracker } from './object.ts'
import { platform } from './core.ts'
import { canary } from './worker.ts'
import type { Comp } from '@yaks/graph'

let now = Date.parse('2026-10-10T00:00:00Z')
let env = {
  MAIL: { send: () => Promise.resolve({}) },
  MAIL_FROM: 'tracker@example.test',
  MAIL_TO: 'owner@example.test',
}
let fixture = async (clock: () => number = () => now) => {
  let db = durable(), writes: string[] = []
  let sql = db.sql.exec.bind(db.sql), put = db.put, arm = db.setAlarm
  db.sql.exec = (text, ...args) => {
    if (/^\s*(insert|update|delete|create|drop|alter)\b/i.test(text)) {
      writes.push(text)
    }
    return sql(text, ...args)
  }
  db.put = (key, value) => {
    writes.push(`kv ${key}`)
    return put(key, value)
  }
  db.setAlarm = (at) => {
    writes.push(`alarm ${at}`)
    return arm(at)
  }
  let ctx: State = {
    id: { name: platform },
    storage: db,
    getWebSockets: () => [],
    acceptWebSocket: () => {},
  }
  let object = () => new Tracker(ctx, env, clock)
  await object().boot()
  writes.length = 0
  return { db, object, writes }
}
let idle = await fixture()
// Installation is a separate setup path, including after a schema changes.
let stale = await fixture()
await stale.db.put('schema', 'older vocabulary')
await stale.object().boot()
let repaired = await stale.db.get<string>('schema')
let cold = idle.object()
let warmed = idle.object()
await warmed.boot()
idle.writes.length = 0
// A full object incarnation constructs its SQLite readers. Prepare that
// integration outcome separately from the fast assertions over its writes.
let alarm = await fixture()
await alarm.object().alarm()
let idleAlarm = await alarm.db.getAlarm()

test('a cold tracker boot reuses readiness and mail without writes', async () => {
  idle.writes.length = 0
  await cold.boot()
  equal(idle.writes, [])
})

test('a warm tracker boot reuses readiness and mail without writes', async () => {
  idle.writes.length = 0
  await warmed.boot()
  equal(idle.writes, [])
})

test('an idle tracker alarm stops without installation, effects or alarm writes', () => {
  equal(alarm.writes, [])
  equal(idleAlarm, null)
})

test('an obsolete readiness stamp installs before recording the new schema', () => {
  ok(repaired && repaired != 'older vocabulary')
  ok(stale.writes.some((s) => s == 'kv schema'))
})

let future = await fixture()
await future.object().boot().then((tracker) =>
  tracker.graph.apply([{
    entity: { eid: 'future' },
    wake: { at: new Date(now + 60_000).toISOString() },
  }], { trusted: true })
)
future.writes.length = 0
await future.object().alarm()
let futureAlarm = await future.db.getAlarm()

test('an alarm sleeps until its future wake instead of polling each second', () => {
  equal(futureAlarm, now + 60_000)
  equal(future.writes, [`alarm ${now + 60_000}`])
})

// Duplicate queue deliveries must not postpone grouping already owed.
let intakeAt = now
let intake = await fixture(() => intakeAt)
let active = intake.object()
await active.alarm()
let rows = canary('a'.repeat(64))
await active.ingest(rows)
let first = await intake.db.getAlarm()
let retained: (number | null)[] = []
for (let i = 0; i < 4; i++) {
  intakeAt += 500
  await active.ingest(rows)
  retained.push(await intake.db.getAlarm())
}

test('duplicate intake preserves the earlier grouping alarm', () => {
  equal(first, now + 1000)
  equal(retained, Array(4).fill(first))
})

let rescheduled = await fixture()
let rescheduler = rescheduled.object()
await rescheduler.alarm()
await rescheduled.db.setAlarm(now + 60_000)
await rescheduler.ingest(canary('b'.repeat(64)))
let broughtForward = await rescheduled.db.getAlarm()

test('intake brings a later alarm forward for immediate grouping', () => {
  equal(broughtForward, now + 1000)
})

// The runtime clears a delivered alarm before entering its handler.
await intake.db.deleteAlarm()
await active.alarm()
let [grouped] = await active.tracker!.graph.get([rows[0].entity.eid])

test('the preserved alarm groups the admitted canary', () => {
  ok((grouped.error as Comp | undefined)?.bug)
})
