import { assertEquals, assertThrows } from '@std/assert'
import { Database } from '@yaks/sqlite/db'
import { driver, open } from './store.ts'

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

Deno.test('blob-backed graph remains writable after SQL failure and rolls back the whole batch', async () => {
  let h = open(':memory:')
  try {
    h.db.exec(`create trigger refuse_doc before insert on doc
      begin select raise(abort, 'test refusal'); end`)
    let error: unknown
    try {
      await h.g.apply([{
        entity: { eid: 'refused' },
        doc: { body: 'must roll back' },
      }])
    } catch (caught) {
      error = caught
    }
    // sqlite3_finalize reports the prior step failure too; both errors stay
    // inspectable rather than a cleanup error replacing the original.
    assertEquals(error instanceof AggregateError, true)
    assertEquals((error as AggregateError).errors[0].message, 'test refusal')
    let sql = driver(h.db)
    assertEquals(sql.query('select * from blob_text', []), [])
    assertEquals(await h.g.read('.doc'), [])
    h.db.exec('drop trigger refuse_doc')
    await h.g.apply([{
      entity: { eid: 'accepted' },
      doc: { body: 'accepted text' },
    }])
    assertEquals((await h.g.read('.doc'))[0].doc, {
      body: 'accepted text',
      title: null,
    })
  } finally {
    h.close()
  }
})
