import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { workerd } from './probe.ts'
import type { blobGatherCost } from './blob_gather_cost_fixture.ts'

test('a blob component gather reads its stored address without rereading the component', async () => {
  let res = await fetch(`${workerd().base}/__play_cost/?blob-gather=1`)
  assertEquals(res.status, 200, await res.clone().text())
  let report = await res.json() as ReturnType<typeof blobGatherCost>
  console.log('BLOB_GATHER_COST', JSON.stringify(report))
  assertEquals(report.rows, [{
    entity: { eid: 'post' },
    post: { title: 'Hello', body: 'current prose' },
  }])
  assertEquals(report.written, 0)
  assert(report.read <= 4, `${report.read} billed rows for one blob gather`)
})
