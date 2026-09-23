// The relational representation: a SELECT statement held as a value, sitting
// between the binder (which routes an @yaks/query AST through an @yaks/vocab
// schema) and the SQL text a dialect renders. It is shaped like Arel and
// deliberately borrows Arel's names — project, join, where, group, order, take,
// distinct — because anyone who has used Arel or ActiveRecord already knows
// what they do.
//
// It is backend-independent by design: a relation carries its projected
// columns, its joins, a boolean condition tree, grouping, ordering and row
// limit as plain data, and `render` is the one place that turns that data into
// a SQL string plus the parameters to bind. A new backend (D1, Postgres) is
// another renderer over the same value — the structure never changes, only how
// leaf column expressions are lowered (a dialect's layout, see ./sqlite.ts)
// and, for a backend whose placeholders are not `?`, a renumbering of the
// parameters it emits.
//
// The shape is functional, not Arel's mutable manager object: a relation is a
// plain object built up field by field, and a condition is a small tree —
// and/or/not/raw/lit — whose leaves (raw) are fragments a dialect has already
// lowered. Keeping AND/OR/NOT explicit rather than joining them into text early
// lets a renderer choose how to write them, and lets a later pass look inside
// them before rendering.

// A value to bind. The filter grammar has no literals but text and numbers, so
// stating that here keeps every caller from having to cast.
export type Bind = string | number

// A piece of SQL and the parameters it consumes, in order. A lowered leaf
// condition, a rendered statement, and a column expression all have this shape.
export type Frag = { sql: string; params: Bind[] }

// A boolean condition as a tree. `raw` is the leaf a dialect lowers (a
// comparison, a presence test, a correlated EXISTS); the combinators stay
// backend-independent, so a renderer decides how AND/OR/NOT are written and a
// rewrite pass can look inside them.
export type Cond =
  | { t: 'lit'; v: boolean }
  | { t: 'raw'; frag: Frag }
  | { t: 'and'; parts: Cond[] }
  | { t: 'or'; parts: Cond[] }
  | { t: 'not'; c: Cond }

export let TRUE: Cond = { t: 'lit', v: true }
export let FALSE: Cond = { t: 'lit', v: false }
export let raw = (frag: Frag): Cond => ({ t: 'raw', frag })
export let not = (c: Cond): Cond => ({ t: 'not', c })

// AND/OR that fold their identity value away: an empty and is TRUE, an empty OR
// is FALSE, and a single child collapses to itself — so the binder can combine
// conditions without special-casing zero or one of them, and a FALSE
// short-circuits an AND.
export let and = (...parts: Cond[]): Cond => {
  if (parts.some((c) => c.t == 'lit' && !c.v)) return FALSE
  let kept = parts.filter((c) => !(c.t == 'lit' && c.v))
  return kept.length == 0
    ? TRUE
    : kept.length == 1
    ? kept[0]
    : { t: 'and', parts: kept }
}
export let or = (...parts: Cond[]): Cond => {
  if (parts.some((c) => c.t == 'lit' && c.v)) return TRUE
  let kept = parts.filter((c) => !(c.t == 'lit' && !c.v))
  return kept.length == 0
    ? FALSE
    : kept.length == 1
    ? kept[0]
    : { t: 'or', parts: kept }
}

// One joined table: the source as it appears after `join` (a component's own
// table) and the whole on expression. Every join made here is a LEFT JOIN — a
// component table is joined to read a column that may be absent, and "the
// column is NULL" must be the same answer as "the component is absent".
export type Join = { source: string; on: string }

// A relation. `from` is the source after from; `cols` are the whole projected
// expressions; `where` is the condition tree; the rest are the optional
// grouping, ordering and row limit (a bound parameter, never a literal written
// into the SQL).
export type Rel = {
  from: string
  cols: string[]
  uniq: boolean
  joins: Join[]
  where: Cond
  group: string | null
  order: string[]
  limit: Bind | null
}

export let rel = (from: string, over: Partial<Rel> = {}): Rel => ({
  from,
  cols: [],
  uniq: false,
  joins: [],
  where: TRUE,
  group: null,
  order: [],
  limit: null,
  ...over,
})

// Conditions joined by `and` or `or`, parenthesised. SQLite parses `a or b or
// c …` into a tree as deep as the list is long and refuses one deeper than
// 1000, so a long list nests in halves, which keeps the depth logarithmic:
// the reverse read behind a well-referenced entity's delete asks thousands.
export let nest = (sqls: string[], joiner: string): string => {
  if (sqls.length <= 64) return `(${sqls.join(joiner)})`
  let half = sqls.length >> 1
  return `(${nest(sqls.slice(0, half), joiner)}${joiner}${
    nest(sqls.slice(half), joiner)
  })`
}

// The condition tree rendered. Standard SQL boolean operators and `?`
// placeholders (SQLite's; a Postgres dialect renumbers them on the way out). A
// `raw` leaf passes its fragment straight through; the combinators parenthesise
// so precedence is never left to the reader.
export let renderCond = (c: Cond): Frag => {
  if (c.t == 'lit') return { sql: c.v ? '1' : '0', params: [] }
  if (c.t == 'raw') return c.frag
  if (c.t == 'not') {
    let inner = renderCond(c.c)
    return { sql: `not (${inner.sql})`, params: inner.params }
  }
  let joiner = c.t == 'and' ? ' and ' : ' or '
  let parts = c.parts.map(renderCond)
  return {
    sql: nest(parts.map((p) => p.sql), joiner),
    params: parts.flatMap((p) => p.params),
  }
}

// The joined tables, written out as they appear after from.
export let joined = (joins: Join[]): string =>
  joins.map((j) => ` left join ${j.source} on ${j.on}`).join('')

// The relation as one statement. Parameters come out in the order SQLite binds
// them: the WHERE conditions in tree order, then the limit. A relation with no
// projected columns selects `*`; one with no condition renders `where 1`.
export let render = (r: Rel): Frag => {
  let where = renderCond(r.where)
  return {
    sql: `select${r.uniq ? ' distinct' : ''} ` +
      `${r.cols.length ? r.cols.join(', ') : '*'}` +
      ` from ${r.from}${joined(r.joins)}` +
      ` where ${where.sql}` +
      (r.group ? ` group by ${r.group}` : '') +
      (r.order.length ? ` order by ${r.order.join(', ')}` : '') +
      (r.limit == null ? '' : ' limit ?'),
    params: [
      ...where.params,
      ...(r.limit == null ? [] : [r.limit]),
    ],
  }
}
