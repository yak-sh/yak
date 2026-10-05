// Actual recurring Vale turn including all deferred calls/model effects.
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { workerd } from './probe.ts'
import type { worldTick } from './play_world_fixture.ts'

test('Vale world tick cascade does no store-sized work', async () => {
  let k = workerd()
  let costs = []
  for (let history of [100, 79000]) {
    let response = await fetch(
      `${k.base}/__play_cost/?world=1&history=${history}`,
    )
    assertEquals(response.status, 200, await response.clone().text())
    let report = await response.json() as Awaited<ReturnType<typeof worldTick>>
    console.log('WORLD_COST', JSON.stringify(report))
    assert(report.villagers > 0)
    assertEquals(report.answers, report.villagers * 2)
    assertEquals(report.failures.length, 0)
    costs.push(report.cascade)
  }
  assert(costs[1].read <= costs[0].read + 100, JSON.stringify(costs))
})
