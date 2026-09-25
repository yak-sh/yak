// The native driver's statement cache, under a fault only the handle itself can
// produce.

import './sqlitepath.ts'
import { Database } from '@db/sqlite'
import { assertEquals, assertThrows } from '@std/assert'
import { driver } from './native.ts'

Deno.test('failed row decoding releases a cached write before rollback and the next savepoint', () => {
  let db = new Database(':memory:')
  try {
    db.exec('create table sample (value integer unique)')
    let sql = driver(db)
    let prepare = db.prepare.bind(db)
    let attempts = 0
    let original = new Error('row conversion failed')
    db.prepare = (text: string) => {
      let statement = prepare(text)
      if (
        text == 'insert into sample values (?) returning value' &&
        ++attempts == 1
      ) {
        // Fault exactly after sqlite3_step returned SQLITE_ROW, before all()
        // resets it. No fake SQLite error: without eviction the next SAVEPOINT
        // actually throws "cannot open savepoint - SQL statements in progress".
        statement.getRowObject = () => () => {
          throw original
        }
      }
      return statement
    }
    sql.exec('savepoint outer')
    let error = assertThrows(() =>
      sql.query('insert into sample values (?) returning value', [1])
    )
    assertEquals(error, original)
    sql.exec('savepoint after_failure')
    sql.exec('release after_failure')
    sql.exec('rollback to outer')
    sql.exec('release outer')
    sql.exec('savepoint next')
    sql.exec('savepoint nested')
    assertEquals(sql.query('select * from sample', []), [])
    assertEquals(
      sql.query('insert into sample values (?) returning value', [2]),
      [{ value: 2 }],
    )
    assertEquals(attempts, 2, 'failed statement was re-prepared, not retried')
    sql.exec('release nested')
    sql.exec('release next')
  } finally {
    db.close()
  }
})
