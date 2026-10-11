import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { col, lit } from '@yaks/sql'
import { identity, inspect } from './inspect.ts'
import { open } from './db.ts'

let counted = open(':memory:')
counted.query({
  t: 'create table',
  name: 'note',
  cols: [
    { name: 'id', type: 'integer', pk: true },
    { name: 'body', type: 'text' },
  ],
})
counted.query({
  t: 'create index',
  name: 'note_body',
  on: 'note',
  cols: [col('body')],
})
counted.query({
  t: 'insert',
  into: 'note',
  cols: ['body'],
  rows: [[lit('private')]],
})

test('inspection counts stored rows and indexes without reading values', () => {
  using db = Object.assign(counted, { [Symbol.dispose]: counted.close })
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

let identified = open(':memory:')
identified.query({
  t: 'create table',
  name: 'entity',
  cols: [
    { name: 'id', type: 'integer', pk: true },
    { name: 'eid', type: 'text' },
  ],
})
for (let name of ['tombstone', 'note']) {
  identified.query({
    t: 'create table',
    name,
    cols: [{ name: 'entity', type: 'integer' }, {
      name: 'body',
      type: 'text',
    }],
  })
}
identified.query({
  t: 'insert',
  into: 'entity',
  cols: ['id', 'eid'],
  rows: [[lit(1), lit('a')], [lit(2), lit('b')]],
})
identified.query({
  t: 'insert',
  into: 'note',
  cols: ['entity', 'body'],
  rows: [[lit(1), lit('secret')]],
})
identified.query({
  t: 'insert',
  into: 'tombstone',
  cols: ['entity'],
  rows: [[lit(2)]],
})

test('identity inspection sees graves and live component presence without values', () => {
  using db = Object.assign(identified, { [Symbol.dispose]: identified.close })
  assertEquals(identity(db, 'a'), {
    eid: 'a',
    exists: true,
    tombstoned: false,
    tables: ['note'],
    omitted: 0,
  })
  assertEquals(identity(db, 'b'), {
    eid: 'b',
    exists: true,
    tombstoned: true,
    tables: ['tombstone'],
    omitted: 0,
  })
  assertEquals(identity(db, 'missing'), {
    eid: 'missing',
    exists: false,
    tombstoned: false,
    tables: [],
    omitted: 0,
  })
})
