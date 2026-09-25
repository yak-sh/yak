// SQL as data. Every statement a package sends to SQLite is a value built from
// these nodes — a select, an insert, a trigger, a pragma — and ./render.ts is
// the one place a value becomes text. A package that needs a statement builds
// the node; it never writes the text.
//
// The shape follows SQLite's own grammar, one node per construct: expressions
// (a column, a bound value, a call, an operator, a subquery), queries (a
// select, a compound, a values list), the writes, and the schema statements.
// A statement is a plain object carrying a `t` tag, so a caller writes it as a
// literal and a pass can look inside it before it is rendered:
//
// ```ts
// import { col, eq, render, val } from '@yaks/sql'
//
// render({ t: 'select', cols: [col('v')], from: { t: 'table', name: 'meta' },
//   where: eq(col('k'), val('epoch')) })
// // { sql: 'select "v" from "meta" where "k" = ?', params: ['epoch'] }
// ```
//
// Names are identifiers, always quoted; a value is a bound parameter, or, where
// SQLite binds none (a trigger, a view, a default), a literal the renderer
// quotes. A function, an operator, a type and a pragma are checked against
// what a name can be, so no string a caller holds becomes SQL text by passing
// through here.
//
// One node cannot be built outside this package: `Raw`, SQL this package
// already wrote — what `render` returns, and the lowerings the query compiler
// makes. A rendered statement can therefore sit inside another (a compiled
// query as a subquery), and nothing else can.

/** A value bound to a statement: what a driver hands the engine. */
export type Param = string | number | bigint | boolean | null | Uint8Array

// The mark only this package can put on a node. A caller cannot name it, so it
// cannot build a `Raw` — the one node that carries text.
const RAW: unique symbol = Symbol('raw')

/** SQL this package wrote, with the parameters it binds, in order — a rendered
 * statement, or a fragment the compiler lowered. */
export type Raw = {
  t: 'raw'
  sql: string
  params: Param[]
  [RAW]: true
}

/** A fragment this package wrote, marked as such. Not exported from the
 * package: every caller outside it builds nodes instead. */
export let raw = (sql: string, params: Param[] = []): Raw => ({
  t: 'raw',
  sql,
  params,
  [RAW]: true,
})

/** Whether a value is a {@link Raw} this package made. */
export let isRaw = (x: unknown): x is Raw =>
  !!x && typeof x == 'object' && RAW in x

// The query compiler's own lowering: a piece of SQL and what it binds, before
// it is marked. A value from the filter grammar is text or a number.
export type Bind = string | number
export type Frag = { sql: string; params: Param[] }

/** A lowered fragment as a node. */
export let cond = (f: Frag): Raw => raw(f.sql, f.params)

/** An expression: a value in a column list, a condition, an argument. */
export type Expr =
  | Raw
  | { t: 'col'; name: string; of?: string }
  | { t: 'val'; v: Param }
  | { t: 'lit'; v: string | number | boolean | null }
  | { t: 'fn'; name: string; args: Expr[]; distinct?: boolean }
  | { t: 'star'; of?: string }
  | { t: 'op'; op: Op; parts: Expr[] }
  | { t: 'not'; e: Expr }
  | { t: 'neg'; e: Expr }
  | { t: 'null'; e: Expr; not?: boolean }
  | { t: 'in'; e: Expr; set: Query | Expr[] }
  | { t: 'exists'; q: Query }
  | { t: 'sub'; q: Query }
  | { t: 'case'; of?: Expr; arms: [Expr, Expr][]; else?: Expr }
  | { t: 'cast'; e: Expr; as: string }
  | { t: 'as'; e: Expr; name: string }
  | { t: 'desc'; e: Expr }
  | { t: 'over'; fn: Expr; partition?: Expr[]; order?: Expr[] }

/** The infix operators an `op` node joins its parts with. */
export type Op =
  | 'and'
  | 'or'
  | '='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'is'
  | 'is not'
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '||'
  | 'like'
  | 'glob'
  | 'match'
  | '->'
  | '->>'

/** A query: what a subquery, a CTE, an `in` and an `insert … select` take. */
export type Query = Select | Compound | Values | Raw

export type Select = {
  t: 'select'
  with?: Cte[]
  distinct?: boolean
  /** the projected expressions; none selects `*` */
  cols?: Expr[]
  /** one source, or several joined by commas (the planner picks the order) */
  from?: Source | Source[]
  joins?: Join[]
  where?: Expr
  group?: Expr[]
  having?: Expr
  order?: Expr[]
  limit?: Expr
  offset?: Expr
}

export type Compound = {
  t: 'compound'
  with?: Cte[]
  op: 'union' | 'union all' | 'intersect' | 'except'
  parts: Query[]
  order?: Expr[]
  limit?: Expr
  offset?: Expr
}

export type Values = { t: 'values'; rows: Expr[][] }

/** What a query reads from: a table (a table-valued function when it has
 * `args`), or a query of its own. */
export type Source =
  | Raw
  | { t: 'table'; name: string; args?: Expr[]; as?: string }
  | { t: 'from'; q: Query; as?: string }

export type Join = {
  how: 'join' | 'left' | 'cross'
  src: Source
  on?: Expr
}

/** A common table expression. `materialized` states the hint either way;
 * left out, the planner decides. */
export type Cte = {
  name: string
  cols?: string[]
  q: Query
  recursive?: boolean
  materialized?: boolean
}

/** What a write does on a constraint failure, spelled `insert or …`. */
export type Conflict = 'ignore' | 'replace' | 'abort' | 'fail' | 'rollback'

/** `on conflict (…) do …`: `set` is the update; left out, it does nothing. */
export type Upsert = {
  on?: Expr[]
  where?: Expr
  set?: Record<string, Expr>
  when?: Expr
}

export type Insert = {
  t: 'insert'
  with?: Cte[]
  or?: Conflict
  into: string
  cols?: string[]
  /** the rows, or the query the rows come from */
  rows?: Expr[][]
  q?: Query
  upsert?: Upsert[]
  returning?: Expr[]
}

export type Update = {
  t: 'update'
  with?: Cte[]
  or?: Conflict
  table: string
  as?: string
  set: Record<string, Expr>
  from?: Source | Source[]
  where?: Expr
  returning?: Expr[]
}

export type Delete = {
  t: 'delete'
  with?: Cte[]
  from: string
  as?: string
  where?: Expr
  returning?: Expr[]
}

/** A write: what a trigger's body holds. */
export type Write = Insert | Update | Delete | Select

/** A foreign key's target. */
export type Ref = {
  table: string
  cols?: string[]
  onDelete?: 'cascade' | 'set null' | 'restrict' | 'no action'
}

export type Column = {
  name: string
  type?: string
  pk?: boolean
  /** a rowid key that never hands out a number a deleted row held */
  autoincrement?: boolean
  notNull?: boolean
  unique?: boolean
  default?: Expr
  check?: Expr
  ref?: Ref
}

/** A table constraint. */
export type Key =
  | { pk: string[] }
  | { unique: string[] }
  | { check: Expr }
  | { fk: string[]; ref: Ref }

export type CreateTable = {
  t: 'create table'
  name: string
  ifNot?: boolean
  cols: Column[]
  keys?: Key[]
}

export type CreateIndex = {
  t: 'create index'
  name: string
  on: string
  cols: Expr[]
  unique?: boolean
  ifNot?: boolean
  where?: Expr
}

export type CreateView = {
  t: 'create view'
  name: string
  ifNot?: boolean
  cols?: string[]
  q: Query
}

/** A virtual table: its module, and the arguments it is declared with — a
 * column name, or a `key = value` option. */
export type CreateVirtual = {
  t: 'create virtual table'
  name: string
  ifNot?: boolean
  using: string
  args: (string | [string, string | number])[]
}

export type CreateTrigger = {
  t: 'create trigger'
  name: string
  ifNot?: boolean
  timing: 'before' | 'after'
  event: 'insert' | 'update' | 'delete'
  /** the columns an update trigger watches */
  of?: string[]
  on: string
  when?: Expr
  body: Write[]
}

/** `alter table`: add a column, drop one, or rename the table. */
export type Alter =
  & { t: 'alter table'; table: string }
  & ({ add: Column } | { drop: string } | { rename: string })

export type Drop = {
  t: 'drop'
  kind: 'table' | 'index' | 'view' | 'trigger'
  name: string
  ifExists?: boolean
}

/** `pragma name`, `pragma name = value` or `pragma name(arg)`. A string value
 * is a keyword (`wal`, `on`). */
export type Pragma = {
  t: 'pragma'
  name: string
  schema?: string
  value?: string | number
  arg?: string
}

/** How SQLite would run a statement, one row per step of its plan. */
export type Explain = { t: 'explain query plan'; of: Stmt }

export type Tx =
  | { t: 'begin'; mode?: 'deferred' | 'immediate' | 'exclusive' }
  | { t: 'commit' }
  | { t: 'rollback'; to?: string }
  | { t: 'savepoint'; name: string }
  | { t: 'release'; name: string }

/** Any statement. */
export type Stmt =
  | Query
  | Insert
  | Update
  | Delete
  | CreateTable
  | CreateIndex
  | CreateView
  | CreateVirtual
  | CreateTrigger
  | Alter
  | Drop
  | Pragma
  | Explain
  | Tx

// ---- expression builders ----

export let col = (name: string, of?: string): Expr => ({ t: 'col', name, of })

/** Columns of one table or alias: `let e = at('e')`, then `e('eid')`. */
export let at = (of: string) => (name: string): Expr => col(name, of)

export let val = (v: Param): Expr => ({ t: 'val', v })
export let lit = (v: string | number | boolean | null): Expr => ({
  t: 'lit',
  v,
})
export let fn = (name: string, ...args: Expr[]): Expr => ({
  t: 'fn',
  name,
  args,
})
export let star = (of?: string): Expr => ({ t: 'star', of })
/** `count(*)` */
export let count = (): Expr => fn('count', star())

export let op = (o: Op, ...parts: Expr[]): Expr => ({ t: 'op', op: o, parts })
export let eq = (a: Expr, b: Expr): Expr => op('=', a, b)
export let ne = (a: Expr, b: Expr): Expr => op('!=', a, b)
export let lt = (a: Expr, b: Expr): Expr => op('<', a, b)
export let le = (a: Expr, b: Expr): Expr => op('<=', a, b)
export let gt = (a: Expr, b: Expr): Expr => op('>', a, b)
export let ge = (a: Expr, b: Expr): Expr => op('>=', a, b)

/** The current instant, as SQLite formats it: the ISO form every `at`
 * property carries, so a time the engine writes reads like one a server
 * wrote. */
export let NOW: Expr = fn('strftime', lit('%Y-%m-%dT%H:%M:%fZ'), lit('now'))

export let TRUE: Expr = lit(true)
export let FALSE: Expr = lit(false)
let truth = (e: Expr): boolean | null => e.t == 'lit' ? !!e.v : null

/** AND, with its identity folded away: none is TRUE, one is itself, and a
 * FALSE among them is FALSE. */
export let and = (...parts: Expr[]): Expr => {
  if (parts.some((e) => truth(e) === false)) return FALSE
  let kept = parts.filter((e) => truth(e) !== true)
  return kept.length == 0 ? TRUE : kept.length == 1 ? kept[0] : op(
    'and',
    ...kept,
  )
}

/** OR, folded the same way: none is FALSE, and a TRUE among them is TRUE. */
export let or = (...parts: Expr[]): Expr => {
  if (parts.some((e) => truth(e) === true)) return TRUE
  let kept = parts.filter((e) => truth(e) !== false)
  return kept.length == 0 ? FALSE : kept.length == 1 ? kept[0] : op(
    'or',
    ...kept,
  )
}

export let not = (e: Expr): Expr => ({ t: 'not', e })
export let neg = (e: Expr): Expr => ({ t: 'neg', e })
export let isNull = (e: Expr): Expr => ({ t: 'null', e })
export let notNull = (e: Expr): Expr => ({ t: 'null', e, not: true })

/** `e in (…)`: a list of expressions, or a query. */
export let among = (e: Expr, set: Query | Expr[]): Expr => ({
  t: 'in',
  e,
  set,
})
export let exists = (q: Query): Expr => ({ t: 'exists', q })
export let sub = (q: Query): Expr => ({ t: 'sub', q })

/** `case when … then … else … end`; `of` makes it `case of when …`. */
export let when = (
  arms: [Expr, Expr][],
  otherwise?: Expr,
  of?: Expr,
): Expr => ({ t: 'case', of, arms, else: otherwise })

/** One condition, two outcomes. */
export let iff = (cond: Expr, then: Expr, otherwise: Expr): Expr =>
  when([[cond, then]], otherwise)

export let cast = (e: Expr, as: string): Expr => ({ t: 'cast', e, as })
export let as = (e: Expr, name: string): Expr => ({ t: 'as', e, name })
export let desc = (e: Expr): Expr => ({ t: 'desc', e })

/** A window function: `fn over (partition by … order by …)`. */
export let over = (
  f: Expr,
  partition?: Expr[],
  order?: Expr[],
): Expr => ({ t: 'over', fn: f, partition, order })

// ---- query builders ----

export let select = (s: Omit<Select, 't'>): Select => ({ t: 'select', ...s })
export let table = (name: string, as?: string): Source => ({
  t: 'table',
  name,
  as,
})
/** A table-valued function as a source: `json_each(?)`. */
export let call = (name: string, args: Expr[], as?: string): Source => ({
  t: 'table',
  name,
  args,
  as,
})
export let from = (q: Query, as?: string): Source => ({ t: 'from', q, as })
export let join = (src: Source, on: Expr): Join => ({ how: 'join', src, on })
export let left = (src: Source, on: Expr): Join => ({ how: 'left', src, on })
export let cross = (src: Source): Join => ({ how: 'cross', src })
export let union = (...parts: Query[]): Compound => ({
  t: 'compound',
  op: 'union',
  parts,
})
export let unionAll = (...parts: Query[]): Compound => ({
  t: 'compound',
  op: 'union all',
  parts,
})

/** The members of a JSON array bound as one parameter: `(select value from
 * json_each(?))`, as a set for {@link among}. A host caps how many parameters
 * one statement binds (a Durable Object's SQLite takes 100), so a list of any
 * length rides as one. */
export let each = (list: readonly Param[]): Query =>
  select({
    cols: [col('value')],
    from: call('json_each', [val(JSON.stringify(list))]),
  })

/** Rows written as objects, each value bound: the first row's keys are the
 * columns.
 *
 * ```ts
 * import { insert, render } from '@yaks/sql'
 *
 * render(insert('entity', { id: 1, eid: 'a' }, { id: 2, eid: 'b' })).sql
 * // 'insert into "entity" ("id", "eid") values (?, ?), (?, ?)'
 * ```
 */
export let insert = (
  into: string,
  ...rows: Record<string, Param>[]
): Insert => {
  let cols = Object.keys(rows[0] ?? {})
  return {
    t: 'insert',
    into,
    cols,
    rows: rows.map((r) => cols.map((c) => val(r[c] ?? null))),
  }
}

/** The rows whose columns hold these values, a null one null. */
export let by = (fields: Record<string, Param>): Expr =>
  and(
    ...Object.entries(fields).map(([k, v]) =>
      v === null ? isNull(col(k)) : eq(col(k), val(v))
    ),
  )
