import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { workerd } from './probe.ts'
import type { queryCost } from './query_cost_fixture.ts'

test('one-row Store query bills only its answer and lookups, cold and warm', async () => {
  let k = workerd()
  let res = await fetch(`${k.base}/__play_cost/?query=1`)
  assertEquals(res.status, 200, await res.clone().text())
  let report = await res.json() as Awaited<ReturnType<typeof queryCost>>
  console.log('QUERY_COST', JSON.stringify(report))
  for (let [name, value] of Object.entries(report)) {
    assertEquals(value.cost.written, 0)
    assert(
      value.cost.read <= (name == 'cold' ? 50 : 20),
      `${name}: ${value.cost.read} billed rows`,
    )
  }
})
