// Host clocks choose when to call the same write. A fake web clock keeps
// minute-long waits and shutdown races deterministic and fast.

import { assertEquals, assertRejects } from '@std/assert'
import { FakeTime } from '@std/testing/time'
import { arm, scheduled } from './cloudflare.ts'
import { loop } from './deno.ts'
import { store, T0, woken } from './harness.ts'

let iso = (t: number) => new Date(t).toISOString()
let advance = async (time: FakeTime, ms: number) => {
  await time.tickAsync(ms)
  await time.runMicrotasks()
}

Deno.test('scheduled uses the event instant and leaves later wakes alone', async () => {
  let g = woken(store())
  g.apply(['due', 'later'].map((eid, i) => ({
    entity: { eid },
    wake: { at: iso(T0 + i * 1000) },
  })))
  let result = await scheduled(g, { scheduledTime: T0 })
  assertEquals(result.fired.map((b) => b.entity.eid), ['due'])
  assertEquals(result.fired[0].fired, { at: iso(T0) })
  assertEquals(result.refused, [])
})

Deno.test('a DO alarm fills the gap before a trigger and preserves earlier alarms', async () => {
  let held: number | null = null
  let writes: number[] = []
  let storage = {
    getAlarm: () => Promise.resolve(held),
    setAlarm: (at: number) => {
      writes.push(held = at)
      return Promise.resolve()
    },
  }
  let before = T0 + 60_000
  assertEquals(await arm(storage, {}, before), false)
  assertEquals(await arm(storage, { at: 'invalid' }, before), false)
  assertEquals(await arm(storage, { at: iso(before) }, before), false)
  assertEquals(await arm(storage, { at: iso(T0 + 500) }, before), true)
  assertEquals(await arm(storage, { at: iso(T0 + 600) }, before), true)
  assertEquals(await arm(storage, { at: iso(T0 + 500) }, before), true)
  assertEquals(await arm(storage, { at: iso(T0 + 100) }, before), true)
  assertEquals(writes, [T0 + 500, T0 + 100])
  held = null
  await Promise.all([
    arm(storage, { at: iso(T0 + 100) }, before),
    arm(storage, { at: iso(T0 + 500) }, before),
  ])
  assertEquals(held, T0 + 100)
})

Deno.test('the loop sleeps to the earliest wake, caps empty waits, and stops', async () => {
  using time = new FakeTime(T0)
  let stop = new AbortController()
  let g = woken(store())
  let fired: string[] = []
  let ticks: number[] = []
  let running = loop(g, {
    signal: stop.signal,
    cap: 60_000,
    onTick: (r) => {
      ticks.push(Date.now())
      fired.push(...r.fired.map((b) => b.entity.eid))
    },
  })
  await time.runMicrotasks()
  g.apply([{
    entity: { eid: 'new' },
    wake: { at: iso(T0 + 65_000) },
  }])
  await advance(time, 60_000)
  assertEquals(ticks, [T0, T0 + 60_000])
  await advance(time, 4_999)
  assertEquals(fired, [])
  await advance(time, 1)
  assertEquals(fired, ['new'])
  assertEquals(ticks, [T0, T0 + 60_000, T0 + 65_000])
  stop.abort()
  await running
  await advance(time, 120_000)
  assertEquals(ticks.length, 3)
})

Deno.test('the loop retries refused wakes at the cap without a tight timer', async () => {
  using time = new FakeTime(T0)
  let stop = new AbortController()
  let g = woken(store())
  g.apply([{ entity: { eid: 'held' }, wake: { at: iso(T0) } }])
  let closed = true
  g.use({
    name: 'gate',
    hooks: {
      precondition: (bs) => {
        if (closed) throw new Error('closed')
        return bs
      },
    },
  })
  let counts: number[] = []
  let running = loop(g, {
    signal: stop.signal,
    cap: 1000,
    onTick: (r) => {
      counts.push(r.refused.length)
    },
  })
  await time.runMicrotasks()
  await advance(time, 999)
  assertEquals(counts, [1])
  closed = false
  await advance(time, 1)
  assertEquals(counts, [1, 0])
  stop.abort()
  await running
})

Deno.test('the loop refuses invalid caps and accepts an already stopped signal', async () => {
  let g = woken(store())
  for (let cap of [0, -1, NaN, Infinity, 2_147_483_648]) {
    await assertRejects(() => loop(g, { cap }), RangeError)
  }
  let stop = new AbortController()
  stop.abort()
  await loop(g, { signal: stop.signal })
})

Deno.test('the loop promptly visits a wake that became due during an effect', async () => {
  using time = new FakeTime(T0)
  let stop = new AbortController()
  let g = woken(store())
  g.apply(['first', 'next'].map((eid, i) => ({
    entity: { eid },
    wake: { at: iso(T0 + i * 10) },
  })))
  let fired: string[] = []
  g.use({
    name: 'slow',
    rules: [{
      phase: 'effect',
      match: '.wake, *fired',
      run: async ({ entity }) => {
        if (entity.eid == 'first') {
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        fired.push(entity.eid)
      },
    }],
  })
  let running = loop(g, { signal: stop.signal })
  await time.runMicrotasks()
  await advance(time, 20)
  await advance(time, 1)
  assertEquals(fired, ['first', 'next'])
  stop.abort()
  await running
})
