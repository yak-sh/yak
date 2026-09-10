import { assertEquals } from '@std/assert'
import { BATCH_SIZE, CHAIN, eid, TASKS, workload } from './fleet.ts'

Deno.test('throughput workload is deterministic, bounded, and every reference exists', () => {
  let data = workload()
  assertEquals(data, workload())
  let ids = new Set(data.bundles.map((b) => b.entity.eid))
  assertEquals(ids.size, data.bundles.length)
  assertEquals(ids.size, 1 + TASKS + TASKS + TASKS - TASKS / CHAIN)
  assertEquals(data.queries.map((q) => q.expected.length), [
    1,
    1536,
    64,
    16,
    63,
  ])
  for (let b of data.bundles) {
    for (let comp of ['edge', 'claim']) {
      let values = b[comp]
      if (!values || typeof values != 'object') continue
      for (let v of Object.values(values)) {
        if (typeof v == 'string') assertEquals(ids.has(v), true)
      }
    }
  }
  assertEquals(data.batches.map((b) => b.length), [BATCH_SIZE, BATCH_SIZE])
  assertEquals(data.batches[0][0].entity.eid, eid(1))
})
