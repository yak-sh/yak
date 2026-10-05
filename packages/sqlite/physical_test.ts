// Component inventories stay valid across schema mutation and rollback.
import { equal, test } from '@yaks/testing'
import { mem } from './testing.ts'
import { componentTables } from './physical.ts'

test('component inventory follows schema changes and rollback, with caller-local exclusions', () => {
  let d = mem()
  let make = (name: string) =>
    d.query({
      t: 'create table',
      name,
      cols: [{ name: 'entity', type: 'integer', pk: true }],
    })
  make('one')
  equal(componentTables(d), ['one'])
  equal(componentTables(d, ['one']), [])
  equal(componentTables(d), ['one'])
  d.query({ t: 'begin' })
  make('two')
  equal(componentTables(d), ['one', 'two'])
  d.query({ t: 'rollback' })
  equal(componentTables(d), ['one'])
  d.query({ t: 'drop', kind: 'table', name: 'one' })
  equal(componentTables(d), [])
})
