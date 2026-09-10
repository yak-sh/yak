import { assertEquals, assertMatch } from '@std/assert'
import { apply, resolveId } from './db.ts'
import { benchTask, dbBenchFixture } from './db_bench_fixture.ts'
import { bareDb } from './testdb.ts'

Deno.test('db bench: explicitly numbered resident tasks make num lookup a hit', () => {
  let db = bareDb()
  let { eids, lookupId, lookupEid } = dbBenchFixture(db, 4)
  assertEquals(eids.length, 4)
  assertEquals(lookupEid, eids[1])
  assertMatch(lookupId, /^\d+$/)
  assertEquals(resolveId(db, lookupId), lookupEid)
  assertEquals(
    db.prepare('select count(*) as n from entity where num is not null').get(),
    { n: 4 },
  )
})

Deno.test('db bench: num lookup follows allocated handles, not a fixed number', () => {
  let db = bareDb()
  db.prepare('insert into entity (eid, num) values (?, ?)').run(
    crypto.randomUUID(),
    10000,
  )
  let { lookupId, lookupEid } = dbBenchFixture(db, 4)
  assertEquals(Number(lookupId) > 10000, true)
  assertEquals(resolveId(db, lookupId), lookupEid)
  assertEquals(resolveId(db, '500'), undefined)
})

Deno.test('db bench: the timed mint still uses ordinary unnumbered writes', () => {
  let db = bareDb()
  let eid = crypto.randomUUID()
  apply(db, benchTask(eid, 0))
  assertEquals(
    db.prepare('select num from entity where eid = ?').get(eid),
    { num: null },
  )
})
