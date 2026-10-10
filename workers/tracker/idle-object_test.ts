// Idle object incarnations use durable readiness and leave SQL, KV and alarms alone.
import { equal, ok, test } from '@yaks/testing'
import { durable } from '../../packages/durable-object/testing.ts'
import { type State, Tracker } from './object.ts'
import { platform } from './core.ts'

let now = Date.parse('2026-10-10T00:00:00Z')
let env = {
  MAIL: { send: () => Promise.resolve({}) },
  MAIL_FROM: 'tracker@example.test',
  MAIL_TO: 'owner@example.test',
}
let fixture = async () => {
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
  let object = () => new Tracker(ctx, env, () => now)
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
let warmed = idle.object()
await warmed.boot()
idle.writes.length = 0
// A full object incarnation constructs its SQLite readers. Prepare that
// integration outcome separately from the fast assertions over its writes.
let alarm = await fixture()
await alarm.object().alarm()
let idleAlarm = await alarm.db.getAlarm()

test('cold and warm tracker boots reuse readiness and mail without writes', async () => {
  idle.writes.length = 0
  await idle.object().boot()
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
