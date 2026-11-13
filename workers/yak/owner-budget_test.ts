// Owner migration shares the object's write windows with schema installation.
import { equal, test } from '@yaks/testing'
import { col, select, table } from '@yaks/sql'
import { driver } from '@yaks/durable-object/sql'
import { bounded } from '@yaks/durable-object/ceiling'
import { reclassify } from '@yaks/sqlite'
import { unit } from '@yaks/sqlite/unit'
import { durable } from '../../packages/durable-object/testing.ts'
import { operatorStore } from './operator-store.ts'
import { ownerBackfill } from './owner-move.ts'
import { OWNERS } from './operator-owner.ts'

test('owner backfill pauses before spending the serving window and resumes its page after the window turns', async () => {
  using file = durable()
  let now = 1000, failures: Error[] = []
  let bound = bounded(file, {
    now: () => now,
    windows: [{ ms: 60_000, read: 50e6, written: 1500 }],
    report: (e) => void failures.push(e),
  })
  let store = operatorStore(file)
  let person = crypto.randomUUID(), space = crypto.randomUUID()
  let eids = Array.from({ length: 200 }, () => crypto.randomUUID())
  await store.g.apply(
    eids.map((eid) => ({
      entity: { eid },
      session: {},
      operator_session: { person, space },
    })),
    { trusted: true },
  )
  // A store from before owners were kept, as the deployed pass receives it.
  let sql = driver(file)
  unit(sql, () => {
    sql.query({ t: 'delete', from: 'owner' })
    reclassify(sql, eids)
    store.marks!.del(OWNERS)
  })
  let exec = file.sql.exec
  let changes = () => Number(exec('select total_changes() as n').toArray()[0].n)
  // Workerd bills indexes too. Give each changed row two index writes here.
  file.sql.exec = (q, ...bindings) => {
    let before = changes(), cursor = exec(q, ...bindings)
    return {
      ...cursor,
      rowsRead: cursor.toArray().length,
      rowsWritten: (changes() - before) * 3,
    }
  }
  bound.count({
    shape: () => 'schema work',
    rowsRead: 0,
    rowsWritten: 700,
    returned: 0,
  })
  equal(await ownerBackfill(store), true)
  let owners = () =>
    sql.query(select({ cols: [col('entity')], from: table('owner') })).length
  equal(owners(), 50)
  equal(store.marks!.get(OWNERS), undefined)
  equal(await ownerBackfill(store), true)
  equal(owners(), 50)
  equal(failures, [])
  for (let pass = 0; pass < 10; pass++) {
    now += 60_000
    if (!await ownerBackfill(store)) break
  }
  equal(store.marks!.get(OWNERS), 'done')
  equal(owners(), 200)
  equal(failures, [])
})
