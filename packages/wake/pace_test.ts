// A wake that repeats only while something holds, read through the two calls
// a host makes: `tick` when its clock goes off, `rouse` after a write.

import { assertEquals, assertThrows } from '@std/assert'
import { type Bundle, graph } from '@yaks/graph'
import { soonest, wakeOf } from './due.ts'
import { rouse } from './pace.ts'
import { home, HOUR, store, T0, woken } from './testing.ts'
import { tick } from './tick.ts'
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

Deno.test('a wake goes on at the first cadence that holds, and sleeps when none does', async () => {
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

Deno.test('a write that makes a condition hold arms a sleeping wake, and a faster one brings it forward', async () => {
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

Deno.test('a condition is refused when it is written, not when it fires', () => {
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
