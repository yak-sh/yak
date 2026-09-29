import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { col, lit } from '@yaks/sql'
import { inspect } from './inspect.ts'
import { mem } from './testing.ts'

test('inspection counts stored rows and indexes without reading values', () => {
  let db = mem()
  db.query({
    t: 'create table',
    name: 'note',
    cols: [
      { name: 'id', type: 'integer', pk: true },
      { name: 'body', type: 'text' },
    ],
  })
  db.query({
    t: 'create index',
    name: 'note_body',
    on: 'note',
    cols: [col('body')],
  })
  db.query({
    t: 'insert',
    into: 'note',
    cols: ['body'],
    rows: [[lit('private')]],
  })
  assertEquals(inspect(db), {
    tables: 1,
    shown: [{
      name: 'note',
      rows: 1,
      indexCount: 1,
      indexes: ['note_body'],
    }],
    omitted: 0,
  })
  assertEquals(inspect(db, 0), { tables: 1, shown: [], omitted: 1 })
})
