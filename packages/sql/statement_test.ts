// Statement span names expose structural code identifiers, never bound values.
import { equal, test } from '@yaks/testing'
import {
  as,
  cardinality,
  col,
  count,
  eq,
  type Expr,
  fn,
  over,
  render,
  select,
  statement,
  sub,
  table,
  val,
  writing,
} from './mod.ts'

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

test('aggregate cardinality counts the inputs represented by each group once', () => {
  let query = select({ cols: [as(count(), 'n'), as(count(), 'again')] })
  let rows = [{ n: 40_000, again: 40_000 }, { n: 8_755, again: 8_755 }]
  equal(cardinality(query, rows), 48_755)
  equal(cardinality(render(query), rows), 48_755)
  equal(cardinality(query, [{ n: 0, again: 0 }]), 1)
})

test('an analysis represents every row it reads to count', () => {
  equal(cardinality({ t: 'analyze', table: 'updated' }, [], 129_422), 129_422)
  equal(cardinality(select({ from: table('updated') }), [], 129_422), 0)
})

for (
  let [name, expr] of [
    ['nullable count', fn('count', col('value'))],
    ['distinct count', {
      t: 'fn',
      name: 'count',
      args: [col('value')],
      distinct: true,
    }],
    ['window count', over(count())],
    ['scalar subquery', sub(select({ cols: [count()] }))],
    ['ordinary column', col('n')],
  ] as [string, Expr][]
) {
  test(`a ${name} does not measure outer selection cardinality`, () => {
    equal(cardinality(select({ cols: [as(expr, 'n')] }), [{ n: 48_755 }]), 1)
  })
}
