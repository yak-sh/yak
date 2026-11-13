/// <reference lib="deno.ns" />
// The one alarm loop: each ring gives every work a slice and sets the alarm
// for the soonest owed, a failure waits a minute, a stopped object waits for
// its window, and a ring during a slice starts no second one.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { LOST } from '@yaks/wake/cloudflare'
import {
  type Alarms,
  BACKSTOP,
  clock,
  RETRY,
  SLICE,
  type Work,
} from './alarm.ts'
import { Stopped } from './ceiling.ts'
import { durable } from './testing.ts'

// A loop at instant 1000 over the stand-in's alarm, what each work was given,
// and what was reported.
let loop = (works: Record<string, Work>, opts = {}) => {
  let storage = durable(), t = { now: 1000 }, given: string[] = []
  let failed: string[] = []
  let logged = Object.fromEntries(
    Object.entries(works).map(([name, work]) => [name, (until: number) => {
      given.push(`${name}@${until}`)
      return work(until)
    }]),
  )
  let time = clock(storage, logged, {
    now: () => t.now,
    report: (_e, name) => failed.push(name),
    ...opts,
  })
  return { storage, t, given, failed, time }
}

test('a ring gives each work its slice, and the alarm is set for the soonest owed', async () => {
  let { storage, given, time } = loop({
    a: () => 9000,
    b: () => 4000,
    c: () => null,
  })
  await time.ring()
  assertEquals(given, [
    `a@${1000 + SLICE}`,
    `b@${1000 + SLICE}`,
    `c@${1000 + SLICE}`,
  ])
  assertEquals(await storage.getAlarm(), 4000)
})

test('nothing owed clears the backstop, and leaves an alarm armed meanwhile', async () => {
  let idle = loop({ a: () => null })
  await idle.time.ring()
  assertEquals(await idle.storage.getAlarm(), null)
  let armed = loop({ a: () => (void armed.time.arm(3000), null) })
  await armed.time.ring()
  assertEquals(await armed.storage.getAlarm(), 3000)
})

test('a slice the alarm answered before holds a backstop, which its answer replaces even later', async () => {
  let held: (number | null)[] = [], kept: Promise<void>[] = []
  let { storage, time } = loop({
    a: async () => (held.push(await storage.getAlarm()), 1000 + BACKSTOP * 2),
  }, { keep: (slice: Promise<void>) => kept.push(slice) })
  await time.ring()
  await kept[0]
  assertEquals(held, [1000 + BACKSTOP])
  assertEquals(await storage.getAlarm(), 1000 + BACKSTOP * 2)
})

test('an awaited slice writes no backstop, and an idle one writes nothing', async () => {
  let held: (number | null)[] = []
  let { storage, time } = loop({
    a: async () => (held.push(await storage.getAlarm()), null),
  })
  await time.ring()
  assertEquals([held, await storage.getAlarm()], [[null], null])
})

test('the alarm a ring answers is superseded by its works, even later', async () => {
  let later = loop({ a: () => 9000 })
  await later.storage.setAlarm(2000)
  await later.time.ring()
  assertEquals(await later.storage.getAlarm(), 9000)
  let idle = loop({ a: () => null })
  await idle.storage.setAlarm(2000)
  await idle.time.ring()
  assertEquals(await idle.storage.getAlarm(), null)
})

test('an alarm armed during a slice outlives the one the ring took over, even later', async () => {
  for (let answer of [null, 9000]) {
    let armed = loop({ a: () => (void armed.time.arm(5000), answer) })
    await armed.storage.setAlarm(2000)
    await armed.time.ring()
    assertEquals(await armed.storage.getAlarm(), 5000)
  }
})

test('a failed work is reported and tried again a minute on, and the rest still run', async () => {
  let { storage, given, failed, time } = loop({
    a: () => {
      throw Error('broke')
    },
    b: () => null,
  })
  await time.ring()
  assertEquals(given.length, 2)
  assertEquals(failed, ['a'])
  assertEquals(await storage.getAlarm(), 1000 + RETRY)
})

test('a work stopped by the ceiling waits for its window, and the rest wait with it', async () => {
  let { storage, given, failed, time } = loop({
    a: () => {
      throw new Stopped(5000, 'written')
    },
    b: () => null,
  })
  await time.ring()
  assertEquals([given.length, failed], [1, []])
  assertEquals(await storage.getAlarm(), 6000)
})

test('a stopped object works nothing and rings when its window ends', async () => {
  let { storage, given, time } = loop({ a: () => 2000 }, { wait: () => 7000 })
  await time.ring()
  assertEquals([given, await storage.getAlarm()], [[], 8000])
})

test('a ring during a slice starts no second slice', async () => {
  let open!: () => void
  let { given, time } = loop({
    a: () => new Promise<null>((done) => open = () => done(null)),
  }, { keep: () => {} })
  await time.ring()
  await time.ring()
  open()
  assertEquals(given.length, 1)
})

test('arming keeps a sooner alarm, and replaces one the runtime gave up on', async () => {
  let storage: Alarms & { at: number | null } = {
    at: null,
    getAlarm: () => Promise.resolve(storage.at),
    setAlarm: (at) => Promise.resolve(void (storage.at = at)),
  }
  let now = 10 * LOST
  let time = clock(storage, {}, { now: () => now })
  await time.arm(now + 500)
  await time.arm(now + 900)
  assertEquals(storage.at, now + 500)
  storage.at = now - LOST - 1
  await time.arm(now + 900)
  assertEquals(storage.at, now + 900)
})
