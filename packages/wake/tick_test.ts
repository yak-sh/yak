// A tick is ordinary graph traffic: the same transaction guard, phase rules,
// and refusal isolation as any other writer. No timer or handler is mocked.

import { assertEquals, assertInstanceOf } from '@std/assert'
import { type Bundle, type Comp, Stale } from '@yaks/graph'
import { due, wakeOf } from './due.ts'
import { HOUR, store, T0, woken } from './harness.ts'
import { tick } from './tick.ts'

let iso = (t: number) => new Date(t).toISOString()
let ids = (bs: Bundle[]) => bs.map((b) => b.entity.eid)

Deno.test('tick commits one wake per batch and leaves a refusal due', async () => {
  let s = store()
  let g = woken(s)
  g.apply(['no', 'once', 'again'].map((eid, i) => ({
    entity: { eid },
    plant: { name: eid },
    wake: { at: iso(T0 - 2 + i), ...(eid == 'again' ? { every: '2h' } : {}) },
  })))
  let batches: string[][] = []
  let ran: string[] = []
  g.use({
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
  let result = await tick(g, T0 + 6 * HOUR)
  assertEquals(ids(result.fired), ['once', 'again'])
  assertEquals(result.refused.map(({ wake }) => wake.entity.eid), ['no'])
  assertEquals(batches, [['no'], ['once'], ['again']])
  assertEquals(ran, ['once', 'again'])
  assertEquals(ids(await due(s, T0 + 6 * HOUR)), ['no'])
  let rows = await s.read('.wake!')
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

Deno.test('overlapping ticks consume an occurrence only once', async () => {
  let g = woken(store())
  g.apply([{ entity: { eid: 'one' }, wake: { at: iso(T0) } }])
  let results = await Promise.all([tick(g, T0), tick(g, T0)])
  assertEquals(results.flatMap((r) => r.fired).length, 1)
  let refused = results.flatMap((r) => r.refused)
  assertEquals(refused.length, 1)
  assertInstanceOf(refused[0].error, Stale)
})

Deno.test('an asynchronous refusal still lets the next wake commit', async () => {
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

Deno.test('tick refuses a recurrence edited since the due read', async () => {
  let g = woken(store())
  g.apply([{
    entity: { eid: 'edited' },
    wake: { at: iso(T0), every: '1h' },
  }])
  let result = await tick({
    read: async (q, opts) => {
      let rows = structuredClone(await g.read(q, opts))
      await g.apply([{
        entity: { eid: 'edited' },
        wake: { at: iso(T0), every: '2h' },
      }])
      return rows
    },
    apply: g.apply,
  }, T0)
  assertEquals(result.fired, [])
  assertInstanceOf(result.refused[0].error, Stale)
  assertEquals(wakeOf((await due(g, T0))[0]), { at: iso(T0), every: '2h' })
})
