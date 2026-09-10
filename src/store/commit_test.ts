import { assert, assertEquals, assertThrows } from '@std/assert'
import { DatabaseSync } from './sqlite.ts'
import { DoSql } from './do.ts'
import type { Sql } from './sql.ts'

// The DO test double rejects transaction SQL just like workerd; all nesting
// must go through transactionSync, including observer commit delivery.
for (let kind of ['file', 'DO']) {
  Deno.test(`Sql afterCommit follows outer commits and savepoint rollbacks (${kind})`, () => {
    let file = new DatabaseSync(':memory:')
    let db: Sql = kind == 'file' ? file : new DoSql({
      sql: {
        exec: <T>(sql: string, ...args: unknown[]) => {
          assert(!/^(begin|commit|rollback|savepoint|release)\b/i.test(sql))
          let rows = file.prepare(sql).all(...args as string[]) as T[]
          return Object.assign(rows, { toArray: () => rows, rowsWritten: 0 })
        },
      },
      transactionSync: (fn) => file.transaction(fn),
      kv: { get: () => undefined, put: () => {} },
    })
    try {
      let seen: number[] = []
      let observe = (n: number) =>
        db.afterCommit(() => {
          assertEquals(db.inTransaction, false)
          seen.push(n)
        })
      db.transaction(() => {
        observe(1)
        db.transaction(() => observe(2))
        assertThrows(() =>
          db.transaction(() => {
            observe(9)
            throw new Error('inner')
          })
        )
        observe(3)
        assertEquals(seen, [])
      }, true)
      assertEquals(seen, [1, 2, 3])
      assertThrows(() =>
        db.transaction(() => {
          db.transaction(() => observe(4))
          throw new Error('outer')
        })
      )
      observe(5)
      assertEquals(seen, [1, 2, 3, 5])
      db.exec('create table kept (n integer)')
      assertThrows(
        () =>
          db.transaction(() => {
            db.exec('insert into kept values (1)')
            db.afterCommit(() => {
              throw new Error('observer')
            })
          }),
        Error,
        'observer',
      )
      assertEquals(db.prepare('select n from kept').all(), [{ n: 1 }])
    } finally {
      file.close()
    }
  })
}
