// The one place SQL is written as text: a node from ./ast.ts in, a `Raw` out —
// the statement's text and the parameters it binds, in the order it binds
// them.
//
// Every name is quoted as an identifier. A value is a `?` and a parameter,
// except inside the statements SQLite keeps as text and runs later (a
// trigger, a view, a column default, a check, a partial index's condition),
// which bind nothing: there it is written as a literal, quoted the way SQLite
// reads one back. The words a statement is built from that are not names — a
// function, an operator, a type, a pragma, a module — are checked against what
// such a word can be before they are written, so text a caller passes in is
// never taken for SQL.
//
// Operators are parenthesized where one sits inside another, so a tree renders
// with the precedence it was built with. AND and OR nest in halves: SQLite
// parses `a or b or c …` into a tree as deep as the list is long and refuses one
// deeper than 1000, and a delete's reverse read asks thousands.

import {
  type Column,
  type Cte,
  type Expr,
  type Join,
  type Key,
  type Param,
  type Query,
  type Raw,
  raw,
  type Ref,
  type Source,
  type Stmt,
  type Upsert,
} from './ast.ts'

// What one rendering accumulates: the parameters in the order their `?`s were
// written, and whether values are being written as literals instead.
type Ctx = { params: Param[]; inline: boolean }

/** An identifier, quoted. */
export let q = (name: string): string => `"${name.replaceAll('"', '""')}"`

let WORD = /^[A-Za-z_][A-Za-z0-9_]*$/
let TYPE = /^[A-Za-z][A-Za-z0-9_ ]*$/
let OPS = new Set([
  'and',
  'or',
  '=',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  'is',
  'is not',
  '+',
  '-',
  '*',
  '/',
  '%',
  '||',
  'like',
  'glob',
  'match',
  '->',
  '->>',
])

// A word that is written as it is, checked first.
let word = (w: string, what = 'name', shape = WORD): string => {
  if (!shape.test(w)) throw new Error(`not a SQL ${what}: ${JSON.stringify(w)}`)
  return w
}

let hex = (b: Uint8Array) =>
  [...b].map((x) => x.toString(16).padStart(2, '0')).join('')

/** A value as SQLite reads it back as a literal. */
export let literal = (v: Param): string => {
  if (v == null) return 'null'
  if (typeof v == 'boolean') return v ? '1' : '0'
  if (typeof v == 'bigint') return String(v)
  if (typeof v == 'number') {
    if (!Number.isFinite(v)) throw new Error(`not a SQL number: ${v}`)
    return String(v)
  }
  if (v instanceof Uint8Array) return `x'${hex(v)}'`
  return `'${v.replaceAll("'", "''")}'`
}

/** AND/OR over rendered parts, parenthesized, nested in halves past 64 so the
 * parse tree stays shallow. */
export let nest = (sqls: string[], joiner: string): string => {
  if (sqls.length <= 64) return `(${sqls.join(joiner)})`
  let half = sqls.length >> 1
  return `(${nest(sqls.slice(0, half), joiner)}${joiner}${
    nest(sqls.slice(half), joiner)
  })`
}

// Whether a node, as an operand of an operator, needs parentheses to keep the
// precedence it was built with. A raw fragment that is only names and a
// placeholder does not.
let SIMPLE = /^[\w".?*]+$/
let compound = (e: Expr): boolean =>
  e.t == 'op'
    ? e.op != 'and' && e.op != 'or'
    : e.t == 'not' || e.t == 'null' || e.t == 'in' ||
      (e.t == 'raw' && !SIMPLE.test(e.sql))

let expr = (e: Expr, c: Ctx): string => {
  switch (e.t) {
    case 'raw':
      c.params.push(...e.params)
      return e.sql
    case 'col':
      return e.of ? `${q(e.of)}.${q(e.name)}` : q(e.name)
    case 'val':
      if (c.inline) return literal(e.v)
      c.params.push(e.v)
      return '?'
    case 'lit':
      return literal(e.v)
    case 'fn':
      return `${word(e.name, 'function')}(${e.distinct ? 'distinct ' : ''}${
        list(e.args, c)
      })`
    case 'star':
      return e.of ? `${q(e.of)}.*` : '*'
    case 'op': {
      if (!OPS.has(e.op)) throw new Error(`not a SQL operator: ${e.op}`)
      if (e.op == 'and' || e.op == 'or') {
        return nest(e.parts.map((p) => expr(p, c)), ` ${e.op} `)
      }
      return e.parts.map((p) => operand(p, c)).join(` ${e.op} `)
    }
    case 'not':
      return `not (${expr(e.e, c)})`
    case 'neg':
      return `-(${expr(e.e, c)})`
    case 'null':
      return `${operand(e.e, c)} is ${e.not ? 'not ' : ''}null`
    case 'in':
      return `${operand(e.e, c)} in (${
        Array.isArray(e.set) ? list(e.set, c) : query(e.set, c)
      })`
    case 'exists':
      return `exists (${query(e.q, c)})`
    case 'sub':
      return `(${query(e.q, c)})`
    case 'case':
      return `case${e.of ? ` ${expr(e.of, c)}` : ''} ${
        e.arms.map(([w, t]) => `when ${expr(w, c)} then ${expr(t, c)}`).join(
          ' ',
        )
      }${e.else ? ` else ${expr(e.else, c)}` : ''} end`
    case 'cast':
      return `cast(${expr(e.e, c)} as ${word(e.as, 'type', TYPE)})`
    case 'as':
      return `${expr(e.e, c)} as ${q(e.name)}`
    case 'desc':
      return `${expr(e.e, c)} desc`
    case 'over':
      return `${expr(e.fn, c)} over (${
        [
          e.partition?.length ? `partition by ${list(e.partition, c)}` : '',
          e.order?.length ? `order by ${list(e.order, c)}` : '',
        ].filter(Boolean).join(' ')
      })`
  }
}

let operand = (e: Expr, c: Ctx): string =>
  compound(e) ? `(${expr(e, c)})` : expr(e, c)

let list = (es: Expr[], c: Ctx): string => es.map((e) => expr(e, c)).join(', ')

let names = (ns: string[]): string => ns.map(q).join(', ')

let source = (s: Source, c: Ctx): string => {
  if (s.t == 'raw') return expr(s, c)
  let as = s.as ? ` as ${q(s.as)}` : ''
  if (s.t == 'from') return `(${query(s.q, c)})${as}`
  return `${q(s.name)}${s.args ? `(${list(s.args, c)})` : ''}${as}`
}

let HOW = { join: 'join', left: 'left join', cross: 'cross join' }
let joins = (js: Join[] | undefined, c: Ctx): string =>
  (js ?? []).map((j) =>
    ` ${HOW[j.how]} ${source(j.src, c)}${j.on ? ` on ${expr(j.on, c)}` : ''}`
  ).join('')

let withs = (ctes: Cte[] | undefined, c: Ctx): string =>
  ctes?.length
    ? `with ${ctes.some((t) => t.recursive) ? 'recursive ' : ''}${
      ctes.map((t) =>
        `${q(t.name)}${t.cols ? `(${names(t.cols)})` : ''} as ${
          t.materialized == null
            ? ''
            : t.materialized
            ? 'materialized '
            : 'not materialized '
        }(${query(t.q, c)})`
      ).join(', ')
    } `
    : ''

// The clauses after a query's body: ordering, then the window.
let tail = (
  s: { order?: Expr[]; limit?: Expr; offset?: Expr },
  c: Ctx,
): string =>
  (s.order?.length ? ` order by ${list(s.order, c)}` : '') +
  (s.limit ? ` limit ${expr(s.limit, c)}` : '') +
  (s.offset ? ` offset ${expr(s.offset, c)}` : '')

let query = (s: Query, c: Ctx): string => {
  if (s.t == 'raw') return expr(s, c)
  if (s.t == 'values') {
    return `values ${s.rows.map((r) => `(${list(r, c)})`).join(', ')}`
  }
  if (s.t == 'compound') {
    return withs(s.with, c) +
      s.parts.map((p) => query(p, c)).join(` ${s.op} `) + tail(s, c)
  }
  let from = s.from == null ? [] : Array.isArray(s.from) ? s.from : [s.from]
  return withs(s.with, c) +
    `select${s.distinct ? ' distinct' : ''} ` +
    (s.cols?.length ? list(s.cols, c) : '*') +
    (from.length ? ` from ${from.map((f) => source(f, c)).join(', ')}` : '') +
    joins(s.joins, c) +
    (s.where ? ` where ${expr(s.where, c)}` : '') +
    (s.group?.length ? ` group by ${list(s.group, c)}` : '') +
    (s.having ? ` having ${expr(s.having, c)}` : '') +
    tail(s, c)
}

let returning = (es: Expr[] | undefined, c: Ctx): string =>
  es?.length ? ` returning ${list(es, c)}` : ''

let sets = (set: Record<string, Expr>, c: Ctx): string =>
  Object.entries(set).map(([k, e]) => `${q(k)} = ${expr(e, c)}`).join(', ')

let upsert = (u: Upsert, c: Ctx): string =>
  ` on conflict${u.on ? ` (${list(u.on, c)})` : ''}` +
  (u.where ? ` where ${expr(u.where, c)}` : '') +
  (u.set
    ? ` do update set ${sets(u.set, c)}` +
      (u.when ? ` where ${expr(u.when, c)}` : '')
    : ' do nothing')

let ref = (r: Ref): string =>
  ` references ${q(r.table)}${r.cols ? `(${names(r.cols)})` : ''}` +
  (r.onDelete ? ` on delete ${r.onDelete}` : '')

// A default is written bare when it is a literal — `alter table … add column`
// refuses one in parentheses — and parenthesized when it is an expression.
let fallback = (e: Expr, c: Ctx): string =>
  e.t == 'lit' || e.t == 'val' ? expr(e, c) : `(${expr(e, c)})`

let column = (k: Column, c: Ctx): string =>
  [
    q(k.name),
    k.type ? word(k.type, 'type', TYPE) : '',
    k.pk ? 'primary key' : '',
    k.autoincrement ? 'autoincrement' : '',
    k.notNull ? 'not null' : '',
    k.unique ? 'unique' : '',
    k.default ? `default ${fallback(k.default, c)}` : '',
    k.check ? `check (${expr(k.check, c)})` : '',
  ].filter(Boolean).join(' ') + (k.ref ? ref(k.ref) : '')

let key = (k: Key, c: Ctx): string =>
  'pk' in k
    ? `primary key (${names(k.pk)})`
    : 'unique' in k
    ? `unique (${names(k.unique)})`
    : 'check' in k
    ? `check (${expr(k.check, c)})`
    : `foreign key (${names(k.fk)})${ref(k.ref)}`

let ifNot = (b?: boolean) => b ? 'if not exists ' : ''

let stmt = (s: Stmt, c: Ctx): string => {
  switch (s.t) {
    case 'insert': {
      // SQLite cannot tell an upsert's `on conflict` from a join's `on` after
      // a bare select, so the select source of an upsert always has a where.
      let src = s.q && s.upsert?.length && s.q.t == 'select' && !s.q.where
        ? { ...s.q, where: { t: 'lit' as const, v: true } }
        : s.q
      return withs(s.with, c) +
        `insert${s.or ? ` or ${s.or}` : ''} into ${q(s.into)}` +
        (s.cols ? ` (${names(s.cols)})` : '') +
        (src
          ? ` ${query(src, c)}`
          : s.rows
          ? ` values ${s.rows.map((r) => `(${list(r, c)})`).join(', ')}`
          : ' default values') +
        (s.upsert ?? []).map((u) => upsert(u, c)).join('') +
        returning(s.returning, c)
    }
    case 'update': {
      let from = s.from == null ? [] : Array.isArray(s.from) ? s.from : [s.from]
      return withs(s.with, c) +
        `update${s.or ? ` or ${s.or}` : ''} ${q(s.table)}` +
        (s.as ? ` as ${q(s.as)}` : '') +
        ` set ${sets(s.set, c)}` +
        (from.length
          ? ` from ${from.map((f) => source(f, c)).join(', ')}`
          : '') +
        (s.where ? ` where ${expr(s.where, c)}` : '') +
        returning(s.returning, c)
    }
    case 'delete':
      return withs(s.with, c) +
        `delete from ${q(s.from)}${s.as ? ` as ${q(s.as)}` : ''}` +
        (s.where ? ` where ${expr(s.where, c)}` : '') +
        returning(s.returning, c)
    case 'create table':
      return `create table ${ifNot(s.ifNot)}${q(s.name)} (${
        [
          ...s.cols.map((k) => column(k, lit(c))),
          ...(s.keys ?? []).map((k) => key(k, lit(c))),
        ].join(', ')
      })`
    case 'create index':
      return `create ${s.unique ? 'unique ' : ''}index ${ifNot(s.ifNot)}${
        q(s.name)
      } on ${q(s.on)} (${list(s.cols, lit(c))})` +
        (s.where ? ` where ${expr(s.where, lit(c))}` : '')
    case 'create view':
      return `create view ${ifNot(s.ifNot)}${q(s.name)}` +
        (s.cols ? ` (${names(s.cols)})` : '') + ` as ${query(s.q, lit(c))}`
    case 'create virtual table':
      return `create virtual table ${ifNot(s.ifNot)}${q(s.name)} using ${
        word(s.using, 'module')
      }(${
        s.args.map((a) =>
          typeof a == 'string'
            ? q(a)
            : `${word(a[0], 'option')}=${literal(a[1])}`
        ).join(', ')
      })`
    case 'create trigger':
      return `create trigger ${ifNot(s.ifNot)}${q(s.name)} ${s.timing} ${
        s.event == 'update' && s.of ? `update of ${names(s.of)}` : s.event
      } on ${q(s.on)}` +
        (s.when ? ` when ${expr(s.when, lit(c))}` : '') +
        ` begin ${s.body.map((b) => `${stmt(b, lit(c))};`).join(' ')} end`
    case 'alter table':
      return `alter table ${q(s.table)} ` +
        ('add' in s
          ? `add column ${column(s.add, lit(c))}`
          : 'drop' in s
          ? `drop column ${q(s.drop)}`
          : `rename to ${q(s.rename)}`)
    case 'drop':
      return `drop ${s.kind} ${s.ifExists ? 'if exists ' : ''}${q(s.name)}`
    case 'pragma':
      return `pragma ${s.schema ? `${q(s.schema)}.` : ''}${
        word(s.name, 'pragma')
      }` +
        (s.arg != null ? `(${q(s.arg)})` : '') +
        (s.value == null
          ? ''
          : ` = ${
            typeof s.value == 'number'
              ? literal(s.value)
              : word(s.value, 'pragma value')
          }`)
    case 'begin':
      return `begin${s.mode ? ` ${s.mode}` : ''}`
    case 'commit':
      return 'commit'
    case 'rollback':
      return `rollback${s.to ? ` to ${q(s.to)}` : ''}`
    case 'savepoint':
      return `savepoint ${q(s.name)}`
    case 'release':
      return `release ${q(s.name)}`
    default:
      return query(s, c)
  }
}

// The same accumulator, writing values as literals: what a statement SQLite
// stores as text needs, since nothing will be bound to it when it runs.
let lit = (c: Ctx): Ctx => c.inline ? c : { params: c.params, inline: true }

/**
 * A statement, or an expression, as the text SQLite runs and the parameters
 * it binds.
 *
 * ```ts
 * import { col, eq, render, val } from '@yaks/sql'
 *
 * let s = render({
 *   t: 'select',
 *   cols: [col('v')],
 *   from: { t: 'table', name: 'meta' },
 *   where: eq(col('k'), val('epoch')),
 * })
 * // s.sql == 'select "v" from "meta" where "k" = ?', s.params == ['epoch']
 * ```
 */
export let render = (node: Stmt | Expr): Raw => {
  let c: Ctx = { params: [], inline: false }
  let sql = isExpr(node) ? expr(node, c) : stmt(node, c)
  return raw(sql, c.params)
}

/** An expression written with every value as a literal, parenthesized where an
 * operator around it would take it apart: what an ORDER BY term or a derived
 * read is spliced into the binder's text as. */
export let inline = (e: Expr): string =>
  operand(e, { params: [], inline: true })

let EXPRS = new Set([
  'col',
  'val',
  'lit',
  'fn',
  'star',
  'op',
  'not',
  'neg',
  'null',
  'in',
  'exists',
  'sub',
  'case',
  'cast',
  'as',
  'desc',
  'over',
])
let isExpr = (n: Stmt | Expr): n is Expr => EXPRS.has(n.t)
