// Analytics Engine SQL: the dialect Cloudflare's Workers Analytics Engine SQL
// API reads (developers.cloudflare.com/analytics/analytics-engine/sql-reference).
// A select built from ./ast.ts nodes in, its text out, the way ./render.ts
// writes SQLite's.
//
// The API binds no parameters: a query is one string of text, so every value
// is written into it as a literal. The reference documents no escape inside a
// string literal and no quoting of a name, so a string holding a quote, a
// backslash or a control character is refused rather than escaped, and a name
// is written bare once it is a word. Anything this dialect does not write (a
// join, a subquery, a window, a `Raw`, which is SQLite's text) is refused too,
// so no value a caller holds can change what a query says.
//
// ```ts
// import { analytics, interval } from '@yaks/sql/analytics'
// import { as, col, fn, ge, op, select, table } from '@yaks/sql/core'
// import { equal } from '@yaks/testing'
//
// equal(
//   analytics(select({
//     cols: [as(fn('sum', col('_sample_interval')), 'views')],
//     from: table('yak_views'),
//     where: ge(col('timestamp'), op('-', fn('NOW'), interval(7, 'DAY'))),
//   })),
//   'SELECT sum(_sample_interval) AS views FROM yak_views ' +
//     "WHERE timestamp >= NOW() - INTERVAL '7' DAY",
// )
// ```

import {
  type Expr,
  interval,
  type Op,
  type Param,
  type Select,
  type Source,
  type Unit,
} from './ast.ts'

export { interval, type Unit }

let WORD = /^[A-Za-z_][A-Za-z0-9_]*$/
// Whether a string can be a literal: no quote, no backslash, no control
// character.
let plain = (v: string) =>
  ![...v].some((ch) => ch == "'" || ch == '\\' || ch < ' ' || ch == '\x7f')

let refuse = (what: string): never => {
  throw new Error(`not Analytics Engine SQL: ${what}`)
}

let word = (w: string) => WORD.test(w) ? w : refuse(JSON.stringify(w))

let literal = (v: Param): string =>
  typeof v == 'string'
    ? plain(v) ? `'${v}'` : refuse(`the string ${JSON.stringify(v)}`)
    : typeof v == 'boolean'
    ? String(v)
    : typeof v == 'bigint' || typeof v == 'number' && Number.isFinite(v)
    ? String(v)
    : refuse(`the value ${String(v)}`)

// How tightly each operator binds, loosest first, so a tree is written with
// the parentheses its shape needs and no more.
let BINDS: Partial<Record<Op, number>> = {
  or: 1,
  and: 2,
  '=': 4,
  '!=': 4,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  like: 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
}
let NOT = 3, IN = 4, ATOM = 7

let binds = (e: Expr): number =>
  e.t == 'op'
    ? BINDS[e.op] ?? ATOM
    : e.t == 'not'
    ? NOT
    : e.t == 'in'
    ? IN
    : ATOM

// An operand at `at`: parenthesized when it binds looser, or as tightly and
// stands to the right, where `a - (b - c)` needs them.
let operand = (e: Expr, at: number, right = false): string => {
  let b = binds(e)
  return b < at || right && b == at && at > NOT ? `(${expr(e)})` : expr(e)
}

let expr = (e: Expr): string => {
  switch (e.t) {
    case 'col':
      return e.of
        ? refuse(`a qualified column ${e.of}.${e.name}`)
        : word(e.name)
    case 'val':
    case 'lit':
      return literal(e.v)
    case 'fn':
      return e.distinct
        ? refuse(`distinct ${e.name}`)
        : `${word(e.name)}(${e.args.map(expr).join(', ')})`
    case 'star':
      return e.of ? refuse(`${e.of}.*`) : '*'
    case 'op': {
      let at = BINDS[e.op] ?? refuse(`the operator ${e.op}`)
      return e.parts.map((p, i) => operand(p, at, i > 0)).join(
        ` ${e.op.toUpperCase()} `,
      )
    }
    case 'not':
      return `NOT ${operand(e.e, NOT)}`
    case 'in':
      return Array.isArray(e.set)
        ? `${operand(e.e, IN + 1)} IN (${e.set.map(expr).join(', ')})`
        : refuse('an IN of a query')
    case 'as':
      return `${expr(e.e)} AS ${word(e.name)}`
    case 'desc':
      return `${expr(e.e)} DESC`
    case 'interval':
      return Number.isInteger(e.n) && /^[A-Z]+$/.test(e.unit)
        ? `INTERVAL '${e.n}' ${e.unit}`
        : refuse(`the interval ${e.n} ${e.unit}`)
    default:
      return refuse(`a ${e.t}`)
  }
}

let source = (s: Source | Source[] | undefined): string =>
  s && !Array.isArray(s) && s.t == 'table' && !s.schema && !s.args &&
    !s.as && s.indexed == null
    ? word(s.name)
    : refuse('a source that is not one table')

let clause = (head: string, es: Expr[] | undefined) =>
  es?.length ? ` ${head} ${es.map(expr).join(', ')}` : ''

/** A select as Analytics Engine SQL text: one table, a where, a group, an
 * order and a limit. Every value is a literal; anything else is refused. */
export let analytics = (s: Select): string => {
  if (s.with || s.distinct || s.joins || s.having || s.offset) {
    refuse('a select past one table, where, group, order and limit')
  }
  return `SELECT ${s.cols?.length ? s.cols.map(expr).join(', ') : '*'} ` +
    `FROM ${source(s.from)}${s.where ? ` WHERE ${expr(s.where)}` : ''}` +
    `${clause('GROUP BY', s.group)}${clause('ORDER BY', s.order)}` +
    `${s.limit ? ` LIMIT ${expr(s.limit)}` : ''}`
}
