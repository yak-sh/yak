import { assert, assertEquals, assertThrows } from '@std/assert'
import { token } from '@yaks/graph'
import { apply, fleetGraphOf, journalSince, readComp, Stale } from '../db.ts'
import { bareDb } from '../testdb.ts'

Deno.test('fleet singleton noop checks only its facets, without stamps or journal', () => {
  let db = bareDb()
  let queries: string[] = []
  let counting = false
  let prepare = db.prepare.bind(db)
  db.prepare = (sql) => {
    let statement = prepare(sql)
    return new Proxy(statement, {
      get: (target, key) => {
        let value = Reflect.get(target, key)
        if (!['get', 'all', 'run'].includes(String(key))) return value
        return (...args: unknown[]) => {
          if (counting) queries.push(sql)
          return Reflect.apply(value, target, args)
        }
      },
    })
  }
  let eid = crypto.randomUUID()
  let g = fleetGraphOf(db)
  apply(db, [
    { eid, name: 'doc', comp: { title: 'One', body: 'held body' } },
    { eid, name: 'task', comp: {} },
    { eid, name: 'filed', comp: { priority: 2 } },
  ])
  let log = journalSince(db, 0)
  let created = readComp(db, eid, 'created')
  let noop = [{ entity: { eid }, filed: { priority: 2 } }]
  counting = true
  assertEquals(g.apply(noop), [])
  counting = false
  assertEquals(queries.length, 2) // indexed identity + filed, no vocabulary scan
  assert(queries.every((sql) => !sql.includes('union all')))
  assertEquals(readComp(db, eid, 'updated'), undefined)
  assertEquals(journalSince(db, 0), log)
  assertThrows(() =>
    g.apply([{
      ...noop[0],
      $was: { doc: { body: token('stale body') } },
    }]), Stale) // A same-value write still checks the caller's FOUND guard.
  // No retained row cache: writes in an enclosing transaction are visible,
  // including the original value again after that transaction rolls back.
  assertThrows(
    () =>
      db.transaction(() => {
        g.apply([{ entity: { eid }, filed: { priority: 1 } }])
        assert((g.apply(noop) as unknown[]).length)
        throw Error('rollback')
      }),
    Error,
    'rollback',
  )
  queries.length = 0
  counting = true
  assertEquals(g.apply(noop), [])
  counting = false
  assertEquals(queries.length, 2)
  assertEquals(readComp(db, eid, 'created'), created)
  assertEquals(readComp(db, eid, 'updated'), undefined)
  assertEquals(journalSince(db, 0), log)
})
