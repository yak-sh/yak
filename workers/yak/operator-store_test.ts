// The Builder object's alarm (operator-store.ts `waking`): a wake stays
// backed by an alarm while it works, so an object reset under a step in
// flight wakes again and takes the step up, and the alarm answers at once,
// so one a reset cuts off holds back no other.
import { assertEquals } from '@std/assert'
import { test, until } from '@yaks/testing'
import { ram } from '@yaks/ram'
import {
  BACKSTOP,
  drain,
  FITTED,
  operatorGraph,
  operatorStore,
  operatorVocab,
  waking,
} from './operator-store.ts'
import { durable } from '../../packages/durable-object/testing.ts'

let storage = () => {
  let at: number | null = null
  return {
    setAlarm: (t: number) => Promise.resolve(void (at = t)),
    getAlarm: () => Promise.resolve(at),
    deleteAlarm: () => Promise.resolve(void (at = null)),
    get at() {
      return at
    },
  }
}

// Work that ends when the test says, answering the next run due.
let held = () => {
  let end = (_: number | null) => {}, runs = 0
  let work = () => (runs++, new Promise<number | null>((go) => (end = go)))
  return { work, end: (next: number | null) => end(next), runs: () => runs }
}

test('a wake answers once its work is under way, backed by an alarm until the work ends, then armed for the next run due or cleared', async () => {
  let s = storage(), wake = waking(s, () => {}), w = held()
  let start = Date.now()
  await wake(w.work)
  assertEquals(s.at! >= start + BACKSTOP, true)
  w.end(null)
  await until(() => s.at == null)
  await wake(w.work)
  w.end(start + 5)
  await until(() => s.at == start + 5)
})

test('an alarm that rings while the work goes arms the backstop again and starts no second', async () => {
  let s = storage(), wake = waking(s, () => {}), w = held()
  await wake(w.work)
  await s.deleteAlarm()
  await wake(w.work)
  assertEquals([w.runs(), s.at != null], [1, true])
  w.end(null)
  await until(() => s.at == null)
})

test('a wake hands its object the work it leaves going, once', async () => {
  let kept: Promise<void>[] = [], w = held()
  let wake = waking(storage(), () => {}, (work) => void kept.push(work))
  await wake(w.work)
  await wake(w.work)
  let done = false
  void kept[0].then(() => done = true)
  await Promise.resolve()
  assertEquals([kept.length, done], [1, false])
  w.end(null)
  await kept[0]
})

test('an alarm armed while a wake works outlasts it', async () => {
  let s = storage(), wake = waking(s, () => {})
  await wake(() => (s.setAlarm(1), Promise.resolve(null)))
  await until(() => s.at == 1)
})

test('work that fails is reported, and its backstop stays armed to try again', async () => {
  let s = storage(), failed: unknown[] = []
  let wake = waking(s, (e) => void failed.push(e))
  await wake(() => Promise.reject(new Error('no')))
  await until(() => failed.length)
  assertEquals(s.at != null, true)
})

// A store whose every step owes another (forks forking) is worked a slice per
// alarm: past `until` nothing more starts, and drain answers now so the next
// alarm takes it up.
test('a drain past its slice starts nothing and answers now; the next works on', async () => {
  let ran: string[] = []
  let ask = (n: number) => ({
    entity: { eid: crypto.randomUUID() },
    operator_request: { channel: String(n) },
  })
  let store = operatorGraph(ram(operatorVocab), [])
  store.fx.handle({
    operator_receive: async (e) => {
      let n = Number(e.comp?.channel)
      ran.push(String(n))
      if (n < 3) await store.g.apply([ask(n + 1)], { trusted: true })
    },
  })
  await store.g.apply([ask(1)], { trusted: true })
  let before = Date.now()
  let next = await drain(store, before - 1)
  assertEquals([ran, next! >= before && next! <= Date.now()], [[], true])
  assertEquals(await drain(store), null)
  assertEquals(ran, ['1', '2', '3'])
})

// The store keeps its vocabulary's retention, as a local host's daily duty
// does: a row past its declared expiry goes on the next wake.
test('a drain expires what the vocabulary declares expired', async () => {
  let store = operatorGraph(ram(operatorVocab), [])
  let row = (at: string) => ({
    announced: { call: crypto.randomUUID() },
    created: { at },
  })
  let old = row(new Date(Date.now() - 2 * 86_400_000).toISOString())
  let fresh = row(new Date().toISOString())
  await store.g.apply([old, fresh] as never, { trusted: true, stamp: false })
  await drain(store)
  let left = await store.g.read('.announced')
  assertEquals(left.map((b) => b.announced), [fresh.announced])
})

// What a wake asks of its file beyond reading it: the schema's DDL and every
// write, any of which holds the object's answer until storage confirms it.
let fitted = durable()
operatorStore(fitted, { version: 'v1' })
let written = (version: string) => {
  let said: string[] = []
  let exec = fitted.sql.exec
  fitted.sql.exec = (query, ...bindings) => (
    said.push(query), exec(query, ...bindings)
  )
  try {
    operatorStore(fitted, { version })
  } finally {
    fitted.sql.exec = exec
  }
  return said.filter((q) => !/^\s*(select|pragma|savepoint|release)\b/i.test(q))
}

test('a wake whose schema its store was fitted to runs no DDL and writes nothing, under any Worker version, and one fitted to another schema fits it again', () => {
  assertEquals(written('v1'), [])
  assertEquals(written('v2'), [])
  // What a release that fitted once a Worker version recorded.
  fitted.sql.exec(`update server_meta set v = 'v1' where k = '${FITTED}'`)
  assertEquals(written('v2').length > 0, true)
  assertEquals(written('v3'), [])
})
