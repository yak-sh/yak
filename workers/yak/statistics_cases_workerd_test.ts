// These installation transitions use the engine's persisted statistics and size.
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { workerd } from './probe.ts'
import type { statisticsCases } from './statistics_cases_fixture.ts'

let size = (rows: { stat?: unknown }[]) =>
  Number(String(rows[0]?.stat).split(' ')[0])

test('hosted statistics cover legacy data, populated tables and new indexes', async () => {
  let res = await fetch(`${workerd().base}/__play_cost/?statisticsCases=1`)
  assertEquals(res.status, 200, await res.clone().text())
  let { adoption, population, index } = await res.json() as Awaited<
    ReturnType<typeof statisticsCases>
  >
  assertEquals(size(adoption.before), 2)
  assertEquals(adoption.adopted, adoption.before)
  assertEquals(adoption.after, adoption.before)
  assertEquals(adoption.rows, 4)
  assertEquals(size(population.populated), 1)
  assertEquals(population.after, population.populated)
  assertEquals(population.rows, 2)
  assert(population.bytesAfter < population.bytesBefore * 10)
  assert(index.indexed.some((row) => row.idx != null))
  assertEquals(size(index.indexed), 4)
  assertEquals(index.after, index.indexed)
  assertEquals(index.rows, 5)
})
