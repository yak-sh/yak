import { assertThrows } from '@std/assert'
import { equal, test } from '@yaks/testing'
import { analytics, interval } from './analytics.ts'
import {
  among,
  and,
  col,
  type Expr,
  fn,
  join,
  lit,
  not,
  op,
  or,
  render,
  select,
  table,
} from './core.ts'
import { raw } from './ast.ts'

let where = (e: Expr) => analytics(select({ from: table('t'), where: e }))
let x = col('x'), y = col('y')

test('analytics writes the parentheses a tree needs and no more', () => {
  let cases: [Expr, string][] = [
    [
      and(op('=', x, lit(1)), or(op('=', y, lit(2)), op('=', y, lit(3)))),
      'x = 1 AND (y = 2 OR y = 3)',
    ],
    [
      op('>=', x, op('-', fn('NOW'), interval(7, 'DAY'))),
      "x >= NOW() - INTERVAL '7' DAY",
    ],
    [op('-', x, op('-', y, lit(1))), 'x - (y - 1)'],
    [not(among(x, [lit('a'), lit('')])), "NOT x IN ('a', '')"],
    [not(and(x, y)), 'NOT (x AND y)'],
  ]
  for (let [e, sql] of cases) equal(where(e), `SELECT * FROM t WHERE ${sql}`)
})

test('analytics refuses what it cannot write as one literal or name', () => {
  let refused: (() => unknown)[] = [
    () => where(op('=', x, lit("a' OR 1=1 --"))),
    () => where(op('=', x, lit('a\\'))),
    () => where(op('=', x, lit('a\nb'))),
    () => where(op('=', x, lit(null))),
    () => where(op('=', col('x; drop'), lit(1))),
    () => where(op('=', x, raw('1'))),
    () => analytics(select({ from: table('t; drop') })),
    () => analytics(select({ from: table('t'), joins: [join(table('u'), x)] })),
  ]
  for (let f of refused) assertThrows(f)
})

test('SQLite has no interval to write', () => {
  assertThrows(() =>
    render(select({ from: table('t'), where: op('>', x, interval(1, 'DAY')) }))
  )
})
