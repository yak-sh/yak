// The Builder object's alarm (operator-store.ts `waking`): a wake stays
// backed by an alarm while it works, so an object reset under a step in
// flight wakes again and takes the step up, and the alarm answers at once,
// so one a reset cuts off holds back no other.
import { assertEquals } from '@std/assert'
import { test, until } from '@yaks/testing'
import { BACKSTOP, waking } from './operator-store.ts'

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
