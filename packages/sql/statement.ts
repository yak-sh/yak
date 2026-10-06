// Code names for statement spans, taken from structural identifiers. Lowered
// SQL retains its origin; SQL text, aliases and values are never inspected.
import type { Source, Stmt } from './ast.ts'

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
