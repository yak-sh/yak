import { lasting } from './testing.ts'
// The in-memory runtime keeps a store's native storage alive for background
// work, just as a Durable Object retains its waitUntil context.
import { assertEquals, assertThrows } from '@std/assert'
import { test, until } from '@yaks/testing'
import { DIM } from './embedding.ts'
import { bucket, platform } from './testing.ts'
import { sha256 } from './versions.ts'

test('platform disposal waits for store work before releasing storage', async () => {
  let release!: () => void
  let gate = new Promise<void>((done) => release = done)
  let asked = 0
  let p = platform('probe', {
    AI: {
      gateway: () => ({ getUrl: () => Promise.resolve('') }),
      run: async (_model: string, input: unknown) => {
        asked++
        await gate
        return {
          data: (input as { text: string[] }).text.map(() =>
            Array.from({ length: DIM }, (_, i) => i == 0 ? 1 : 0)
          ),
        }
      },
    },
  })
  try {
    let name = 'ada/lifetime'
    let post = (path: string, body: unknown) =>
      p.object(name).fetch(
        new Request(`http://store${path}`, {
          method: 'POST',
          headers: {
            'x-store': name,
            'x-yak-role': 'owner',
            'x-yak-person': 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
          },
          body: JSON.stringify(body),
        }),
      )
    assertEquals((await post('/vocab', {})).status, 200)
    // A text the model is owed: an app's store holds none until it writes one.
    let note = [{ entity: { eid: 'note' }, doc: { title: 'A note' } }]
    assertEquals((await post('/apply', note)).status, 200)
    await until(() => asked > 0)
    let { storage } = p.states.get(name)!
    let closing = p[Symbol.asyncDispose]()
    // The request ended, but its deferred vector must still be able to land.
    assertEquals(storage.sql.exec('select 1 as alive').toArray(), [{
      alive: 1,
    }])
    release()
    await closing
    assertThrows(
      () => storage.sql.exec('select 1'),
      Error,
      'storage is disposed',
    )
  } finally {
    release()
    await p[Symbol.asyncDispose]()
  }
})

let receipt = '{"call":"original"}'
let receiptTag = await sha256(new TextEncoder().encode(receipt))
let viewTag = await sha256(new Uint8Array([1, 2]))
test('the runtime bucket stores strings and the bytes selected by a view', async () => {
  let { r2 } = bucket()
  await r2.put('receipt', receipt)
  let stored = (await r2.get('receipt'))!
  assertEquals(stored.etag, receiptTag)
  assertEquals(
    new TextDecoder().decode(await stored.arrayBuffer()),
    receipt,
  )
  let bytes = new Uint8Array([9, 1, 2, 8])
  await r2.put('view', new DataView(bytes.buffer, 1, 2))
  let view = (await r2.get('view'))!
  assertEquals(view.etag, viewTag)
  assertEquals(
    new Uint8Array(await view.arrayBuffer()),
    new Uint8Array([1, 2]),
  )
})

// Open stores before timing delivery: the runtime's task is choosing due
// alarms, not rebuilding each object's schema on every tick.
let alarms = lasting('alarm-index-probe')
let dormant = alarms.object('alarm-index/dormant')
let due = alarms.object('alarm-index/due')
let later = alarms.object('alarm-index/later')
let stuck = alarms.object('alarm-index/stuck')
let idleReads = 0
let idleAlarm = alarms.states.get('alarm-index/dormant')!.storage.getAlarm
alarms.states.get('alarm-index/dormant')!.storage.getAlarm = () => {
  idleReads++
  return idleAlarm()
}
let delivered: string[] = []
dormant.alarm = () => {
  delivered.push('dormant')
  return Promise.resolve()
}
due.alarm = async () => {
  delivered.push('due')
  // Re-arming the same object is for the next delivery, even when due now.
  await alarms.states.get('alarm-index/due')!.storage.setAlarm(0)
}
later.alarm = () => {
  delivered.push('later')
  return Promise.resolve()
}
let unstick = Promise.withResolvers<void>()
stuck.alarm = async () => {
  delivered.push('stuck')
  await unstick.promise
}
// Observe real deliveries once as the runtime fixture is built; timed checks
// inspect the independent outcomes rather than schema shutdown scheduling.
let alarmDeliveries: string[][] = []
let stuckDeliveries: string[] = []
try {
  let dueStorage = alarms.states.get('alarm-index/due')!.storage
  let laterStorage = alarms.states.get('alarm-index/later')!.storage
  await dueStorage.setAlarm(0)
  await laterStorage.setAlarm(Date.now() + 60_000)
  await alarms.ring()
  alarmDeliveries.push([...delivered])
  await dueStorage.deleteAlarm()
  await laterStorage.deleteAlarm()
  await alarms.ring()
  alarmDeliveries.push([...delivered])
  await dueStorage.setAlarm(0)
  await alarms.ring()
  alarmDeliveries.push([...delivered])
  await dueStorage.deleteAlarm()
  // One object's alarm still running, and another's comes due.
  delivered.length = 0
  await alarms.states.get('alarm-index/stuck')!.storage.setAlarm(0)
  let stuckRing = alarms.ring()
  await dueStorage.setAlarm(0)
  await alarms.ring()
  stuckDeliveries = [...delivered]
  unstick.resolve()
  await stuckRing
} finally {
  await alarms[Symbol.asyncDispose]()
}
test('alarm delivery skips idle objects and delivers a rearm on the next tick', () => {
  assertEquals(alarmDeliveries, [['due'], ['due'], ['due', 'due']])
  assertEquals(idleReads, 0)
})
test("an object's alarm still running holds back no other object's", () =>
  assertEquals(stuckDeliveries, ['stuck', 'due']))
