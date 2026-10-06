import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Comp } from '@yaks/graph'
import { conditionalWakes } from './conditional-wakes.ts'
import { store, T0, woken } from '../../packages/wake/testing.ts'

let iso = (at: number) => new Date(at).toISOString()

test('conditional wake catalog is read once while conditions stay authoritative', async () => {
  let g = woken(store()), catalogs = 0, conditions = 0
  await g.apply([{
    entity: { eid: 'world' },
    wake: { while: [{ match: '.plant', every: '1h' }] },
  }])
  let driver = {
    read: (
      q: Parameters<typeof g.read>[0],
      opts?: Parameters<typeof g.read>[1],
    ) => {
      if (q == '.wake.while') catalogs++
      else conditions++
      return g.read(q, opts)
    },
    apply: g.apply,
  }
  let run = conditionalWakes(driver)
  for (let i = 0; i < 10; i++) await run([], T0)
  assertEquals(catalogs, 1)
  assertEquals(conditions, 10)
  let input = await g.apply([{
    entity: { eid: 'fern' },
    plant: { name: 'fern' },
  }])
  let result = await run(input, T0)
  assertEquals(result.roused.length, 1)
  assertEquals(
    ((await g.get(['world']))[0].wake as Comp)?.at,
    iso(T0 + 3_600_000),
  )
})

test('conditional wake catalog follows edits, retargets and deletion', async () => {
  let g = woken(store())
  let run = conditionalWakes({ read: g.read, apply: g.apply })
  await run([], T0)
  let input = await g.apply([
    { entity: { eid: 'fern' }, plant: { name: 'fern' } },
    {
      entity: { eid: 'world' },
      wake: { while: [{ match: '.plant', every: '1h' }] },
    },
  ])
  assertEquals((await run(input, T0)).roused.length, 1)
  input = await g.apply([{
    entity: { eid: 'world' },
    wake: { at: null, while: [{ match: '.plant', every: '30m' }] },
  }])
  assertEquals((await run(input, T0)).roused.length, 1)
  assertEquals(
    ((await g.get(['world']))[0].wake as Comp)?.at,
    iso(T0 + 1_800_000),
  )
  input = await g.apply([{ entity: { eid: 'world' }, $delete: true }])
  assertEquals((await run(input, T0)).roused, [])
})
