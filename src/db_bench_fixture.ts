// Shared by the benchmark and its contract tests: the num lookup must HIT a
// resident task, even when ordinary writes mint no human number by default.
import { assertEquals } from '@std/assert'
import { apply, resolveId } from './db.ts'
import type { Sql } from './store/sql.ts'

export let benchTask = (eid: string, i: number) => [
  { eid, name: 'doc', comp: { title: `Task ${i}`, body: 'b'.repeat(200) } },
  { eid, name: 'task', comp: {} },
  { eid, name: 'filed', comp: { priority: i % 3 } },
]

export let dbBenchFixture = (db: Sql, count = 2000) => {
  let eids = Array.from({ length: count }, () => crypto.randomUUID())
  eids.forEach((eid, i) =>
    apply(db, benchTask(eid, i).map((c) => ({ ...c, $num: true })))
  )
  let lookupEid = eids[Math.floor(count / 4)]
  let row = db.prepare('select num from entity where eid = ?').get(lookupEid)
  // Derive the handle instead of assuming where numbering starts. Verify the
  // operation before timing, not in the hot loop (which measures resolveId).
  let lookupId = String(row?.num)
  assertEquals(resolveId(db, lookupId), lookupEid)
  return { eids, lookupId, lookupEid }
}
