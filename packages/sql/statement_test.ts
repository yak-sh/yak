// Statement span names expose structural code identifiers, never bound values.
import { equal, test } from '@yaks/testing'
import { col, eq, select, statement, table, val, writing } from './mod.ts'

test('public statement names and write classification use the SQL AST', () => {
  let read = select({
    from: table('book'),
    where: eq(col('title'), val('private')),
  })
  equal(statement(read), 'book select')
  equal(writing(read), false)
  let write = {
    t: 'update' as const,
    table: 'book',
    set: { title: val('private') },
  }
  equal(statement(write), 'book update')
  equal(writing(write), true)
})
