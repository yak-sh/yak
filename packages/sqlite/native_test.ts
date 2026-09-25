// The native driver's statement cache, under a fault only the handle itself can
// produce.

import './sqlitepath.ts'
import { Database } from '@db/sqlite'
import { assertEquals, assertThrows } from '@std/assert'
import { col, type Insert, render, scan, type Tx, val } from '@yaks/sql'
import { driver } from './native.ts'

let insert = (value: number): Insert => ({
  t: 'insert',
  into: 'sample',
  cols: ['value'],
  rows: [[val(value)]],
  returning: [col('value')],
})

Deno.test('failed row decoding releases a cached write before rollback and the next savepoint', () => {
  let db = new Database(':memory:')
  try {
    let sql = driver(db)
    sql.query({
      t: 'create table',
      name: 'sample',
      cols: [{ name: 'value', type: 'integer', unique: true }],
    })
    let tx = (...steps: Tx[]) => steps.forEach((s) => sql.query(s))
    let prepare = db.prepare.bind(db)
    let attempts = 0
    let original = new Error('row conversion failed')
    db.prepare = (text: string) => {
      let statement = prepare(text)
      if (text == render(insert(0)).sql && ++attempts == 1) {
        // Fault exactly after sqlite3_step returned SQLITE_ROW, before all()
        // resets it. No fake SQLite error: without eviction the next SAVEPOINT
        // actually throws "cannot open savepoint - SQL statements in progress".
        statement.getRowObject = () => () => {
          throw original
        }
      }
      return statement
    }
    tx({ t: 'savepoint', name: 'outer' })
    let error = assertThrows(() => sql.query(insert(1)))
    assertEquals(error, original)
    tx(
      { t: 'savepoint', name: 'after_failure' },
      { t: 'release', name: 'after_failure' },
      { t: 'rollback', to: 'outer' },
      { t: 'release', name: 'outer' },
      { t: 'savepoint', name: 'next' },
      { t: 'savepoint', name: 'nested' },
    )
    assertEquals(scan(sql, 'sample'), [])
    assertEquals(sql.query(insert(2)), [{ value: 2 }])
    assertEquals(attempts, 2, 'failed statement was re-prepared, not retried')
    tx({ t: 'release', name: 'nested' }, { t: 'release', name: 'next' })
  } finally {
    db.close()
  }
})
