// A tick is ordinary graph traffic: the same transaction guard, phase rules,
// and refusal isolation as any other writer. No timer or handler is mocked.

import { test } from '@yaks/testing'
import { assertEquals, assertInstanceOf } from '@std/assert'
import { type Bundle, type Comp, Stale } from '@yaks/graph'
import { due, wakeOf } from './due.ts'
import { HOUR, store, T0, woken } from './testing.ts'
import { type Driver, tick } from './tick.ts'

let iso = (t: number) => new Date(t).toISOString()
let ids = (bs: Bundle[]) => bs.map((b) => b.entity.eid)

// Prepare one graph with its admission guard and effect, as a host does before
// ticking. Read the transaction outcome and every resulting wake below.
let guardedStore = store()
let guardedGraph = woken(guardedStore)
guardedGraph.apply(['no', 'once', 'again'].map((eid, i) => ({
  entity: { eid },
  plant: { name: eid },
  wake: { at: iso(T0 - 2 + i), ...(eid == 'again' ? { every: '2h' } : {}) },
})))
let batches: string[][] = []
let ran: string[] = []
guardedGraph.use({
  name: 'plants',
  hooks: {
    precondition: (bs) => {
      batches.push(ids(bs))
      if (bs.some((b) => b.entity.eid == 'no')) throw new Error('held')
      return bs
    },
  },
  rules: [{
    phase: 'effect',
    match: '.wake, *fired, .plant, #Now',
    run: ({ entity, Now, fired }) => {
      assertEquals((fired as Comp).at, Now.at)
      ran.push(entity.eid)
    },
  }],
})
let result = await tick(guardedGraph, T0 + 6 * HOUR)
test('tick commits one wake per batch and leaves a refusal due', async () => {
  let s = guardedStore
  assertEquals(ids(result.fired), ['once', 'again'])
  assertEquals(result.refused.map(({ wake }) => wake.entity.eid), ['no'])
  assertEquals(batches, [['no'], ['once'], ['again']])
  assertEquals(ran, ['once', 'again'])
  assertEquals(ids(await due(s, T0 + 6 * HOUR)), ['no'])
  let rows = await s.read('.wake')
  assertEquals(
    wakeOf(rows.find((b) => b.entity.eid == 'again')!)?.at,
    iso(T0 + 8 * HOUR),
  )
  assertEquals(rows.find((b) => b.entity.eid == 'no')?.fired, undefined)
  assertEquals(
    wakeOf(rows.find((b) => b.entity.eid == 'once')!)?.at ?? null,
    null,
  )
})

test('overlapping ticks consume an occurrence only once', async () => {
  let g = woken(store())
  g.apply([{ entity: { eid: 'one' }, wake: { at: iso(T0) } }])
  let results = await Promise.all([tick(g, T0), tick(g, T0)])
  assertEquals(results.flatMap((r) => r.fired).length, 1)
  assertEquals(results.flatMap((r) => r.refused), [])
})

// A driver whose reads let another writer patch the wake first: once, or on
// every read when the patch is given each read's count.
let moved = (
  g: ReturnType<typeof woken>,
  patch: Comp | ((n: number) => Comp),
): Driver => {
  let n = 0
  return {
    read: async (q, opts) => {
      let rows = structuredClone(await g.read(q, opts))
      let wake = typeof patch == 'function' ? patch(n) : n ? null : patch
      n++
      if (wake) await g.apply([{ entity: { eid: 'moved' }, wake }])
      return rows
    },
    apply: g.apply,
  }
}

test('an asynchronous refusal still lets the next wake commit', async () => {
  let g = woken(store())
  g.apply(['no', 'yes'].map((eid) => ({
    entity: { eid },
    wake: { at: iso(T0) },
  })))
  let result = await tick({
    read: async (q, opts) => await g.read(q, opts),
    apply: async (bs, opts) => {
      if (bs[0].entity.eid == 'no') throw new Error('unavailable')
      return await g.apply(bs, opts)
    },
  }, T0)
  assertEquals(ids(result.fired), ['yes'])
  assertEquals(result.refused.length, 1)
})

test('a wake edited since the due read fires as it was edited', async () => {
  let g = woken(store())
  g.apply([{ entity: { eid: 'moved' }, wake: { at: iso(T0), every: '1h' } }])
  let result = await tick(moved(g, { every: '2h' }), T0)
  assertEquals(ids(result.fired), ['moved'])
  assertEquals(result.refused, [])
  assertEquals(wakeOf((await g.read('.wake'))[0]), {
    at: iso(T0 + 2 * HOUR),
    every: '2h',
  })
})

test('a wake moved later since the due read keeps its new instant', async () => {
  let g = woken(store())
  g.apply([{ entity: { eid: 'moved' }, wake: { at: iso(T0) } }])
  let result = await tick(moved(g, { at: iso(T0 + HOUR) }), T0)
  assertEquals(result, { fired: [], refused: [] })
  assertEquals(wakeOf((await g.read('.wake'))[0]), { at: iso(T0 + HOUR) })
})

test('a wake that keeps moving under every read is refused', async () => {
  let g = woken(store())
  g.apply([{ entity: { eid: 'moved' }, wake: { at: iso(T0), every: '1h' } }])
  let result = await tick(moved(g, (n) => ({ at: iso(T0 - n - 1) })), T0)
  assertEquals(result.fired, [])
  assertInstanceOf(result.refused[0].error, Stale)
})
