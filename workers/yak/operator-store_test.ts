// The Builder object's alarm (operator-store.ts `woken`): a wake stays
// backed by an alarm while it works, so an object reset under a step in
// flight wakes again and takes the step up.
import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { BACKSTOP, woken } from './operator-store.ts'

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

test('a wake is backed by an alarm while it works, then armed for the next run due or cleared', async () => {
  let s = storage(), during: (number | null)[] = []
  let start = Date.now()
  await woken(s, () => (during.push(s.at), Promise.resolve(null)))
  assertEquals(during[0]! >= start + BACKSTOP, true)
  assertEquals(s.at, null)
  await woken(s, () => Promise.resolve(start + 5))
  assertEquals(s.at, start + 5)
})

test('an alarm armed while a wake works outlasts it', async () => {
  let s = storage()
  await woken(s, () => (s.setAlarm(1), Promise.resolve(null)))
  assertEquals(s.at, 1)
})
