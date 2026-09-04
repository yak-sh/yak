// The relational IR: a SELECT as a VALUE, sitting between the binder (which
// routes an @yaks/query AST through an @yaks/vocab schema) and the SQL text a
// dialect renders. It is Arel-shaped and deliberately borrows Arel's words
// (M-12915) — project, join, where, group, order, take, distinct — because
// anyone who has used Arel or ActiveRecord already knows what they do.
//
// The IR is DIALECT-AGNOSTIC by design: a relation carries its projection,
// joins, a boolean CONDITION TREE, grouping, ordering and bound as plain data,
// and `render` is the one place that turns that data into a SQL string plus
// bound params. A new backend (D1, Postgres) is another renderer over the same
// value — the structure never changes, only the lowering of leaf column
// expressions (a dialect's Layout, see ./sqlite.ts) and, for a non-`?`
// placeholder dialect, a renumber of the params it emits.
//
// The SHAPE is functional, not Arel's mutable manager (M-4454): a relation is a
// plain object built up field by field, and a condition is a small algebraic
// tree — and/or/not/raw/lit — whose leaves (raw) are Frags a dialect already
// lowered. Keeping AND/OR/NOT explicit rather than pre-joined text lets a
// renderer choose how to spell them and a pass look into them before rendering.

// A bound value. The filter grammar has no literal but text and numbers, so
// saying that here keeps every caller off a cast.
export type Bind = string | number

// A piece of SQL and the binds it consumes, in order. A lowered leaf condition,
// a rendered statement, and a column expression are all this one shape.
export type Frag = { sql: string; params: Bind[] }

// A boolean condition as an algebraic tree. `raw` is the leaf a dialect lowers
// (a comparison, a presence test, a correlated EXISTS); the composers stay
// dialect-free so a renderer owns how AND/OR/NOT are spelled and a rewrite pass
// can look inside.
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

// AND/OR that fold their identity away: an empty AND is TRUE, an empty OR is
// FALSE, and a single child collapses — so a binder composes without special-
// casing the zero/one clause count, and a FALSE short-circuits an AND.
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

// One joined table: the source as it appears after `join` (a component's
// storage table) and the whole ON expression. Every join this layer makes is a
// LEFT join — a component table is joined to read a column that may be absent,
// and "the column is absent" must be the same NULL as "the component is absent".
export type Join = { source: string; on: string }

// A relation. `from` is the source after FROM; `cols` are whole projected
// expressions; `where` is the condition tree; the rest are the optional
// grouping, ordering and row bound (a bind, never an inlined literal).
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

// The condition tree rendered. Standard SQL boolean spelling, `?` placeholders
// (SQLite's; a Postgres dialect renumbers on the way out). A `raw` leaf hands
// its Frag straight through; the composers parenthesise so precedence is never
// left to the reader.
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
    sql: `(${parts.map((p) => p.sql).join(joiner)})`,
    params: parts.flatMap((p) => p.params),
  }
}

// The joined tables as they are spelled after FROM.
export let joined = (joins: Join[]): string =>
  joins.map((j) => ` left join ${j.source} on ${j.on}`).join('')

// The relation as one statement. Params come out in the order SQLite binds
// them: the WHERE conditions in tree order, then the bound. A relation with no
// projection selects `*`; with no condition renders `where 1`.
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
