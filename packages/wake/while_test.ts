// A wake that repeats only while something holds, read through the two calls
// a host makes: `tick` when its clock goes off, `rouse` after a write.

import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { type Bundle, graph } from '@yaks/graph'
import { soonest, wakeOf } from './due.ts'
import { rouse } from './while.ts'
import { home, HOUR, store, T0, woken } from './testing.ts'
import { type Driver, tick } from './tick.ts'
import { wakes } from './plugin.ts'

let iso = (t: number) => new Date(t).toISOString()
let MIN = 60_000

// A world that ticks every 30m while basil grows, every 2h while anything
// grows, and not at all over bare ground.
let world = () => {
  let g = woken(store())
  let plant = (name: string) =>
    g.apply([{ entity: { eid: name }, plant: { name } }])
  let uproot = (...names: string[]) =>
    g.apply(names.map((eid) => ({ entity: { eid }, $delete: true })))
  let at = () => wakeOf((g.read('.eid=world') as Bundle[])[0])?.at ?? null
  let sow = (wake: object) =>
    g.apply([{
      entity: { eid: 'world' },
      wake: {
        ...wake,
        while: [
          { match: '.plant.name=basil', every: '30m' },
          { match: '.plant', every: '2h' },
        ],
      },
    }])
  return { g, plant, uproot, at, sow }
}

test('a wake goes on at the first cadence that holds, and sleeps when none does', async () => {
  let w = world()
  w.plant('fern')
  w.sow({ at: iso(T0) })
  await tick(w.g, T0)
  assertEquals(w.at(), iso(T0 + 2 * HOUR))
  w.plant('basil')
  await tick(w.g, T0 + 2 * HOUR)
  assertEquals(w.at(), iso(T0 + 2 * HOUR + 30 * MIN))
  // A stretch nobody ticked through is one firing, on the cadence's phase.
  let { fired } = await tick(w.g, T0 + 5 * HOUR + 10 * MIN)
  assertEquals(fired.length, 1)
  assertEquals(w.at(), iso(T0 + 5 * HOUR + 30 * MIN))
  w.uproot('basil', 'fern')
  await tick(w.g, T0 + 5 * HOUR + 30 * MIN)
  assertEquals(w.at(), null)
  assertEquals(await soonest(w.g, T0), null)
})

test('a write that makes a condition hold arms a sleeping wake, and a faster one brings it forward', async () => {
  let w = world()
  w.sow({})
  assertEquals((await rouse(w.g, T0)).roused, [])
  assertEquals(w.at(), null)
  w.plant('fern')
  assertEquals((await rouse(w.g, T0)).roused.length, 1)
  assertEquals(w.at(), iso(T0 + 2 * HOUR))
  // A slower instant never replaces a sooner one.
  await rouse(w.g, T0 + 10 * MIN)
  assertEquals(w.at(), iso(T0 + 2 * HOUR))
  w.plant('basil')
  await rouse(w.g, T0 + 10 * MIN)
  assertEquals(w.at(), iso(T0 + 40 * MIN))
})

test('a pass shares match answers while each wake chooses its own cadence', async () => {
  let g = woken(store())
  g.apply([{ entity: { eid: 'basil' }, plant: { name: 'basil' } }])
  let ids = ['one', 'two', 'three']
  g.apply(ids.map((eid, i) => ({
    entity: { eid },
    wake: {
      at: iso(T0),
      while: [
        { match: '.plant.name=fern', every: '30m' },
        { match: '.plant', every: `${i + 1}h` },
      ],
    },
  })))
  let reads = 0
  let driver: Driver = {
    read: (query, opts) => {
      if (typeof query != 'string') reads++
      return g.read(query, opts)
    },
    apply: g.apply,
  }
  let times = async () =>
    (await g.read('.wake')).map((b) => wakeOf(b)?.at).sort()

  assertEquals((await tick(driver, T0)).fired.length, 3)
  assertEquals(reads, 2)
  assertEquals(await times(), [1, 2, 3].map((h) => iso(T0 + h * HOUR)))

  g.apply(ids.map((eid) => ({ entity: { eid }, wake: { at: null } })))
  reads = 0
  assertEquals((await rouse(driver, T0)).roused.length, 3)
  assertEquals(reads, 2)
  assertEquals(await times(), [1, 2, 3].map((h) => iso(T0 + h * HOUR)))

  g.apply([{ entity: { eid: 'basil' }, $delete: true }])
  reads = 0
  assertEquals((await tick(driver, T0 + 3 * HOUR)).fired.length, 3)
  assertEquals(reads, 2)
  assertEquals((await g.read('.wake')).every((b) => !wakeOf(b)?.at), true)
})

test('a failed shared match can be read for the next wake', async () => {
  let g = woken(store())
  g.apply([{ entity: { eid: 'basil' }, plant: { name: 'basil' } }])
  g.apply(['one', 'two'].map((eid, i) => ({
    entity: { eid },
    wake: {
      at: iso(T0 - 1 + i),
      while: [{ match: '.plant', every: '1h' }],
    },
  })))
  let reads = 0
  let driver: Driver = {
    read: (query, opts) => {
      if (typeof query != 'string' && ++reads == 1) {
        throw new Error('read failed')
      }
      return g.read(query, opts)
    },
    apply: g.apply,
  }
  let result = await tick(driver, T0)
  assertEquals(result.refused.map(({ wake }) => wake.entity.eid), ['one'])
  assertEquals(result.fired.map((b) => b.entity.eid), ['two'])
  assertEquals(reads, 2)
})

test('a wake write changes matches on the next pass', async () => {
  let g = woken(store())
  let plant = { entity: { eid: 'basil' }, plant: { name: 'basil' } }
  let wakes = ['one', 'two'].map((eid) => ({
    entity: { eid },
    wake: {
      at: iso(T0),
      while: [{ match: '.plant', every: '1h' }],
    },
  }))
  g.apply([plant, ...wakes])
  let reads = 0
  let driver: Driver = {
    read: (query, opts) => {
      if (typeof query != 'string') reads++
      return g.read(query, opts)
    },
    apply: async (bundles, opts) => {
      let applied = await g.apply(bundles, opts)
      if (bundles[0].entity.eid == 'one') {
        await g.apply([{ entity: plant.entity, $delete: true }])
      }
      return applied
    },
  }
  let times = async () =>
    (await g.read('.wake')).map((b) => wakeOf(b)?.at).sort()

  assertEquals((await tick(driver, T0)).fired.length, 2)
  assertEquals(reads, 1)
  assertEquals(await times(), [iso(T0 + HOUR), iso(T0 + HOUR)])

  g.apply([
    plant,
    ...wakes.map(({ entity }) => ({ entity, wake: { at: null } })),
  ])
  reads = 0
  assertEquals((await rouse(driver, T0)).roused.length, 2)
  assertEquals(reads, 1)
  assertEquals(await times(), [iso(T0 + HOUR), iso(T0 + HOUR)])

  reads = 0
  assertEquals((await tick(driver, T0 + HOUR)).fired.length, 2)
  assertEquals(reads, 1)
  assertEquals((await g.read('.wake')).every((b) => !wakeOf(b)?.at), true)
})

test('a condition is refused when it is written, not when it fires', () => {
  let g = graph({ storage: store(), vocab: home, plugins: [wakes()] })
  for (
    let bad of [
      { match: '.plant' },
      { match: '.plant', every: 'now and then' },
      { match: '.plant.name=', every: '1h' },
    ]
  ) {
    assertThrows(() =>
      g.apply([{ entity: { eid: 'w' }, wake: { while: [bad] } }])
    )
  }
})
