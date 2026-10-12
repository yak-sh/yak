import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { workerd } from './probe.ts'

test('short collections preserve values without billed virtual rows', async () => {
  let res = await fetch(`${workerd().base}/__play_cost/?collection-selector=1`)
  assertEquals(res.status, 200, await res.clone().text())
  let report = await res.json()
  console.log('COLLECTION_SELECTOR_COST', report.read)
  assertEquals(
    report.rows,
    ["can't", '雪', 'a,b', null, 1, 0, 3, 2.5].map((value) => ({ value })),
  )
  assertEquals(report.read, 0)
  for (let { actual, expected } of report.parity) {
    assertEquals(actual, expected)
  }
})
