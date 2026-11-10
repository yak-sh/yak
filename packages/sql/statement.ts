// Structural SQL observations. Lowered SQL retains its origin, so observers
// inspect the statement's nodes without parsing its text.
import type { Source, Stmt } from './ast.ts'
import type { Row } from './driver.ts'

let source = (s?: Source | Source[]): string => {
  if (!s) return ''
  if (Array.isArray(s)) return source(s[0])
  if (s.t == 'table') return s.name
  if (s.t == 'from') return relation(s.q)
  return s.table ?? (s.origin ? relation(s.origin) : '')
}

let relation = (s: Stmt): string => {
  switch (s.t) {
    case 'raw':
      return s.table ?? (s.origin ? relation(s.origin) : '')
    case 'select':
      return source(s.from)
    case 'compound':
      return s.parts.length ? relation(s.parts[0]) : ''
    case 'insert':
      return s.into
    case 'update':
    case 'alter table':
      return s.table
    case 'analyze':
      return s.table ?? ''
    case 'delete':
      return s.from
    case 'create index':
    case 'create trigger':
      return s.on
    case 'create table':
    case 'create virtual table':
    case 'create view':
    case 'drop':
      return s.name
    case 'explain query plan':
      return relation(s.of)
    default:
      return ''
  }
}

export let statement = (s: Stmt): string => {
  if (s.t == 'raw' && s.origin) return statement(s.origin)
  if (s.t == 'pragma') return `${s.name} pragma`
  let verb = s.t == 'raw' || s.t == 'compound' ? 'select' : s.t
  let table = relation(s)
  return table ? `${table} ${verb}` : verb
}

export let writing = (s: Stmt): boolean =>
  s.t == 'raw' && s.origin
    ? writing(s.origin)
    : s.t == 'insert' || s.t == 'update' || s.t == 'delete'

/** Rows represented by an answer, including each group's COUNT(*) inputs.
 * Only a direct, named COUNT(*) qualifies: nullable/distinct counts, windows
 * and scalar subqueries do not measure the outer selection's cardinality. */
export let cardinality = (s: Stmt, rows: Row[]): number => {
  if (s.t == 'raw' && s.origin) return cardinality(s.origin, rows)
  if (s.t != 'select') return rows.length
  let counts = (s.cols ?? []).flatMap((c) =>
    c.t == 'as' && c.e.t == 'fn' && c.e.name.toLowerCase() == 'count' &&
      !c.e.distinct && c.e.args.length == 1 && c.e.args[0].t == 'star'
      ? [c.name]
      : []
  )
  return Math.max(
    rows.length,
    ...counts.map((name) =>
      rows.reduce((sum, row) => {
        let n = Number(row[name])
        return sum + (Number.isFinite(n) && n >= 0 ? n : 0)
      }, 0)
    ),
  )
}
