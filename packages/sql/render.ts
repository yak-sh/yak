// The one place SQL is written as text: a node from ./ast.ts in, a `Raw` out —
// the statement's text and the parameters it binds, in the order it binds
// them.
//
// Every name is quoted as an identifier. A value is a `?` and a parameter,
// except inside the statements SQLite keeps as text and runs later (a
// trigger, a view, a column default, a check, a partial index's condition),
// which bind nothing: there it is written as a literal, quoted the way SQLite
// reads one back. A statement binds no more parameters than its engine allows
// (`VARIABLES`); every value past that is written as a literal too, so no
// statement is too big to bind, however many values a query compiles to. Nor
// is it longer than its engine reads (`LENGTH`) for repeating itself: past
// that, a shared relation (./ast.ts `Cte`) written in several scopes is
// written once at the statement's top. The words a statement is built from
// that are not names — a function, an operator, a type, a pragma, a module —
// are checked against what such a word can be before they are written, so
// text a caller passes in is never taken for SQL.
//
// A statement names a component's table and columns by their labels, and is
// rendered with the vocabulary they are stored under (`Vocab.stored`): a
// component's table read as the relation of its stored columns renamed to
// their labels, which SQLite flattens into the query, and a write or schema
// statement's own table and columns by their stored names. Nothing above the
// renderer names storage.
//
// Operators are parenthesized where one sits inside another, so a tree renders
// with the precedence it was built with. AND and OR nest in halves: SQLite
// parses `a or b or c …` into a tree as deep as the list is long and refuses one
// deeper than 1000, and a delete's reverse read asks thousands.

import { related, stoodColumn, stored } from './layout.ts'
import type { Vocab } from '@yaks/vocab'
import {
  array,
  bounded,
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
  type Select,
  type Source,
  type Stmt,
  type Upsert,
} from './ast.ts'

// What one rendering accumulates: the parameters in the order their `?`s were
// written, whether values are being written as literals instead, whether the
// text must be stable whatever a collection's members (`renderStable`), and
// how many parameters the engine binds at most. `v` is the vocabulary names
// are stored under, and `at` the table a write or schema statement names its
// columns in (below).
type Ctx = {
  params: Param[]
  inline: boolean
  stable: boolean
  cap: number
  v?: Vocab
  at?: At
  fired?: At
  ctes?: ReadonlySet<string>
  reads?: Reads
}

// The table a write or schema statement is about: its component, the names a
// column of it is qualified by (the table, its alias, a trigger's `new` and
// `old`, an upsert's `excluded`), and whether an unqualified column is its
// own, which it is in the statement itself and never in a query inside it.
type At = { comp: string; names: Set<string>; bare: boolean }

// A component's stored properties: every one but those computed, which no
// column holds.
let columns = (v: Vocab, name: string): string[] => {
  let relation = related(v, name)
  let comp = relation?.comp ?? name
  return [
    ...v.props(comp).filter((p) => !v.prop(comp, p)!.computed).map((p) =>
      p == 'entity' ? '$entity' : p
    ),
    ...relation?.columns ?? [],
  ]
}

// Whether a name is a component's table the vocabulary stores apart from its
// labels, so a statement naming it is rewritten. Asked of every table a
// statement names, so answered once a vocabulary.
let renames = new WeakMap<Vocab, Map<string, boolean>>()
let renamed = (v: Vocab | undefined, comp: string): v is Vocab => {
  if (!v) return false
  let held = renames.get(v)
  if (!held) renames.set(v, held = new Map())
  let is = held.get(comp)
  if (is == null) {
    is = comp != 'entity' && (!!v.comp(comp) || !!related(v, comp)) &&
      (stored(v, comp) != comp ||
        columns(v, comp).some((k) => stored(v, comp, k) != k))
    held.set(comp, is)
  }
  return is
}

// A column of the table a write or schema statement is about.
let own = (c: Ctx, name: string): string =>
  c.at && c.v ? stored(c.v, c.at.comp, name) : name

// A column node's stored name, where it names one of the statement's own
// table or a trigger's `new` or `old`.
let ownColumn = (c: Ctx, e: { name: string; of?: string }): string => {
  let at = c.at && (e.of ? c.at.names.has(e.of) : c.at.bare)
    ? c.at
    : e.of && c.fired?.names.has(e.of)
    ? c.fired
    : undefined
  return at ? stored(c.v!, at.comp, e.name) : e.name
}

// The names a query's own sources take, which a column it qualifies by one
// means: no longer the write's table, where the write names it the same.
let shadowed = (c: Ctx, from: Source[], js: Join[] | undefined): Ctx => {
  if (!c.at && !c.fired) return c
  let mine = [...from, ...(js ?? []).map((j) => j.src)].flatMap((f) =>
    f.t == 'raw' ? [] : [f.as ?? (f.t == 'table' ? f.name : '')]
  )
  let less = (at?: At) =>
    at && mine.some((n) => at.names.has(n))
      ? {
        ...at,
        names: new Set([...at.names].filter((n) => !mine.includes(n))),
      }
      : at
  return { ...c, at: less(c.at), fired: less(c.fired) }
}

// The same statement's columns, past the statement itself: a query inside it
// names its own columns, though it may still qualify one of the statement's.
let inner = (c: Ctx): Ctx =>
  c.at?.bare ? { ...c, at: { ...c.at, bare: false } } : c

// A trigger's body: each of its writes is about its own table, and `new` and
// `old` stay the trigger's.
let triggered = (t: Ctx): Ctx =>
  t.at
    ? {
      ...t,
      at: undefined,
      fired: { comp: t.at.comp, names: new Set(['new', 'old']), bare: false },
    }
    : t

// A write or schema statement about `table`, its columns qualified by `names`.
let about = (c: Ctx, table: string, ...names: (string | undefined)[]): Ctx =>
  renamed(c.v, table)
    ? {
      ...c,
      at: {
        comp: table,
        names: new Set([table, ...names.filter((n) => n != null)]),
        bare: true,
      },
    }
    : c.at
    ? { ...c, at: undefined }
    : c

// A table a statement names, by its stored name.
let tableName = (c: Ctx, name: string): string =>
  q(c.v ? stored(c.v, name) : name)

/** How many parameters one statement may bind. Workerd, the SQLite under a
 * Durable Object, allows 100, the lowest of any supported engine, and so the
 * default: an engine that allows more passes its own. A value past it is
 * written as a literal. */
export let VARIABLES = 100

/** How long a statement's text may be, in UTF-8 bytes. Workerd allows
 * 100,000 (its SQLITE_MAX_SQL_LENGTH), the lowest of any supported engine. */
export let LENGTH = 100_000

// Whether text is past LENGTH, which the engine counts in UTF-8 bytes: up to
// three for each UTF-16 unit.
let utf8 = new TextEncoder()
let long = (sql: string) =>
  sql.length > LENGTH || sql.length * 3 > LENGTH &&
    utf8.encode(sql).length > LENGTH

/** What an embedded SQLite allows: the stock SQLITE_MAX_VARIABLE_NUMBER. */
export let STOCK_VARIABLES = 32766

// Whether a statement has bound all the parameters it may, so a value from
// here on is written as a literal.
let full = (c: Ctx, n = 1) => c.params.length + n > c.cap

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

// The text of each node rendered with nothing to bind, kept while the node
// lives. A node is a value, never changed once built, so a caller that keeps
// the tree of a statement it runs over and over (a read's projection of one
// component, asked thousands of times a session) renders only what changed
// since: the part holding its bound values. A leaf is cheaper to write than to
// look up, and short text is not worth keeping.
// Only the nodes asked for lately are kept: those of the last two generations
// of TEXTS, one found in the older moving to the newer. Every node of a tree
// keeps the text of all it holds, so a process that kept every tree it held
// (a test runtime holds hundreds of files' stores) kept hundreds of
// megabytes of text.
// Stable text writes collections its own way, so it is kept apart.
let TEXTS = 8192
let texts = () => {
  let now = new WeakMap<object, string>(), was = now, n = 0
  let set = (node: object, text: string) => {
    if (++n > TEXTS) was = now, now = new WeakMap(), n = 1
    now.set(node, text)
  }
  return {
    get: (node: object): string | undefined => {
      let text = now.get(node)
      if (text == null && (text = was.get(node)) != null) set(node, text)
      return text
    },
    set,
  }
}
let bare = [texts(), texts()]
let seen = new WeakMap<Vocab, ReturnType<typeof texts>[]>()
let textsOf = (c: Ctx) => {
  if (!c.v) return bare
  let held = seen.get(c.v)
  if (!held) seen.set(c.v, held = [texts(), texts()])
  return held
}
let LEAF = new Set(['col', 'val', 'lit', 'star', 'table'])
let kept =
  <N extends { t: string }>(write: (n: N, c: Ctx) => string) =>
  (n: N, c: Ctx): string => {
    if (c.inline || c.at || c.fired || c.ctes || LEAF.has(n.t) || full(c)) {
      return write(n, c)
    }
    let texts = textsOf(c)[c.stable ? 1 : 0]
    let text = texts.get(n)
    if (text != null) return text
    let bound = c.params.length
    text = write(n, c)
    if (c.params.length == bound && text.length >= 64) texts.set(n, text)
    return text
  }

let expr: (e: Expr, c: Ctx) => string = kept((e: Expr, c: Ctx): string => {
  switch (e.t) {
    case 'raw':
      if (e.params.length && (c.inline || full(c, e.params.length))) {
        return literals(e)
      }
      c.params.push(...e.params)
      return e.sql
    case 'col': {
      let name = c.v ? ownColumn(c, e) : e.name
      let of = e.of
      let target = c.at
      if (of && target?.names.has(of) && of == target.comp) {
        of = stored(c.v!, of)
      }
      return of ? `${q(of)}.${q(name)}` : q(name)
    }
    case 'val':
      if (c.inline || full(c)) return literal(e.v)
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
        Array.isArray(e.set)
          ? list(e.set, c)
          : e.set.t == 'each'
          ? written(e.set.list, c) ?? query(array(e.set.list), c)
          : query(e.set, inner(c))
      })`
    case 'exists':
      return `exists (${query(e.q, inner(c))})`
    case 'sub':
      return `(${query(e.q, inner(c))})`
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
    case 'raise':
      return `raise(${word(e.how, 'refusal')}${
        e.msg == null ? '' : `, ${literal(e.msg)}`
      })`
    case 'interval':
      throw new Error('SQLite has no interval: ./analytics.ts writes one')
  }
})

let operand = (e: Expr, c: Ctx): string =>
  compound(e) ? `(${expr(e, c)})` : expr(e, c)

let list = (es: Expr[], c: Ctx): string => es.map((e) => expr(e, c)).join(', ')

let names = (ns: string[]): string => ns.map(q).join(', ')

let source: (s: Source, c: Ctx) => string = kept((s: Source, c: Ctx) => {
  if (s.t == 'raw') return expr(s, c)
  let as = s.as ? ` as ${q(s.as)}` : ''
  if (s.t == 'from') return `(${query(s.q, inner(c))})${as}`
  let schema = s.schema ? `${q(s.schema)}.` : ''
  let indexed = s.indexed === false
    ? ' not indexed'
    : s.indexed
    ? ` indexed by ${q(s.indexed)}`
    : ''
  if (
    !s.args && !s.physical && (s.schema || !c.ctes?.has(s.name)) &&
    renamed(c.v, s.name)
  ) {
    let as = s.as ?? s.name
    return `${relationOf(c.v, s.name, indexed, schema, c.reads?.(as))} as ${
      q(as)
    }`
  }
  return `${schema}${s.physical ? tableName(c, s.name) : q(s.name)}${
    s.args ? `(${list(s.args, c)})` : ''
  }${as}` +
    indexed
})

/** A component's table as a statement reads it, before any alias: its name,
 * or, where the vocabulary stores it apart from its labels, the relation of
 * its stored columns under their labels. SQLite flattens the subquery, so a
 * read of it seeks the table and its indexes as a read of the plain name
 * would. `indexed` is the table's own `indexed by` or `not indexed`; `read`
 * says which columns the statement may read, and the relation lists only
 * those (`reading`).
 *
 * ```ts
 * import { relationOf } from '@yaks/sql/core'
 * import { loadVocab } from '@yaks/vocab'
 * import { equal } from '@yaks/testing'
 *
 * let [note, body] = [crypto.randomUUID(), crypto.randomUUID()]
 * let v = loadVocab({ $defs: { note: {
 *   $id: `urn:uuid:${note}`, component: true,
 *   properties: { body: { $id: `urn:uuid:${body}`, type: 'string' } },
 * } } })
 * equal(
 *   relationOf(v, 'note'),
 *   `(select "entity", "${body}" as "body" from "${note}")`,
 * )
 * equal(relationOf(v, 'meta'), '"meta"')
 * ```
 */
export let relationOf = (
  v: Vocab | undefined,
  comp: string,
  indexed = '',
  schema = '',
  read: (column: string) => boolean = () => true,
): string => {
  if (!renamed(v, comp)) return `${schema}${q(comp)}${indexed}`
  let named = columns(v, comp).filter(read).map((k) => {
    if (!stoodColumn(v, comp, k)) return `null as ${q(k)}`
    let at = stored(v, comp, k)
    return at == k ? q(k) : `${q(at)} as ${q(k)}`
  })
  // Its owner alone is the stored table's own column.
  if (!named.length && !indexed) return `${schema}${q(stored(v, comp))}`
  return `(select ${['"entity"', ...named].join(', ')} from ${schema}${
    q(stored(v, comp))
  }${indexed})`
}

/** {@link relationOf} under the component's name, as a statement joins it. */
export let tableOf = (
  v: Vocab | undefined,
  comp: string,
  indexed = '',
  read?: (column: string) => boolean,
): string =>
  renamed(v, comp)
    ? `${relationOf(v, comp, indexed, '', read)} as ${q(comp)}`
    : `${q(comp)}${indexed}`

// Which columns of each of a select's sources it may read, by the source's
// name in it: a renamed component's relation lists only those
// (`relationOf`), so a statement repeating a relation repeats no column it
// never names. A column is read where a column node or raw text names it,
// qualified by the source or by nothing; every column, where the select reads
// all of a source (`*`, `"source".*`). Any other word in raw text is read as
// an unqualified column. Reading too much costs only text; a column left out
// would be refused by the engine, never misread.
type Reads = (source: string) => (column: string) => boolean
// Each name raw text reads, quoted or a bare word: its qualifier where it
// follows one and a dot, and `*` for a source's every column. A name given
// after `as` is defined there, not read, and a keyword or a string is no name.
let MENTION =
  /'(?:[^']|'')*'|(?:"((?:[^"]|"")*)"|(\w+))(?:\s*\.\s*(?:"((?:[^"]|"")*)"|(\w+)|(\*)))?/g
let KEYWORDS = new Set(
  ('select from where and or not is null as in exists on join left cross ' +
    'inner case when then else end by order group having limit offset union ' +
    'all distinct like glob between asc desc collate escape cast values with ' +
    'materialized indexed using').split(' '),
)
let mentions = function* (
  sql: string,
): Generator<[string | undefined, string]> {
  let unquote = (s: string) => s.replaceAll('""', '"')
  let defining = false
  for (let [, q1, w1, q2, w2, all] of sql.matchAll(MENTION)) {
    let named = !defining
    let word = w1?.toLowerCase()
    defining = word == 'as'
    if (!named || q1 == null && w1 == null) continue
    let first = q1 != null ? unquote(q1) : w1!
    let second = q2 != null ? unquote(q2) : w2 ?? all
    if (second != null) yield [first, second]
    else if (!word || !KEYWORDS.has(word)) yield [undefined, first]
  }
}
let readings = new WeakMap<Select, Reads>()
let reading = (s: Select): Reads => {
  let held = readings.get(s)
  if (held) return held
  let by = new Map<string, Set<string> | true>()
  let bare = new Set<string>()
  let all = !s.cols?.length || s.cols.some((e) => e.t == 'star' && !e.of)
  let add = (of: string, name: string | true) => {
    let at = by.get(of)
    if (at === true) return
    if (name === true) by.set(of, true)
    else if (at) at.add(name)
    else by.set(of, new Set([name]))
  }
  let walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node != 'object') return
    let n = node as Record<string, unknown>
    if (n.t == 'col') {
      if (typeof n.of == 'string') add(n.of, String(n.name))
      else bare.add(String(n.name))
      return
    }
    if (n.t == 'star' && typeof n.of == 'string') return add(n.of, true)
    if (n.t == 'raw') {
      for (let [of, column] of mentions(String(n.sql))) {
        if (of == null) bare.add(column)
        else add(of, column == '*' || column)
      }
      return
    }
    for (let v of Object.values(n)) walk(v)
  }
  walk(s)
  let reads: Reads = (source) => {
    let named = all ? true : by.get(source)
    return (column) =>
      named === true || column == 'entity' || bare.has(column) ||
      !!named?.has(column)
  }
  readings.set(s, reads)
  return reads
}

let HOW = { join: 'join', left: 'left join', cross: 'cross join' }
let joins = (js: Join[] | undefined, c: Ctx): string =>
  (js ?? []).map((j) =>
    ` ${HOW[j.how]} ${source(j.src, c)}${j.on ? ` on ${expr(j.on, c)}` : ''}`
  ).join('')

let within = (c: Ctx, ctes?: Cte[]): Ctx =>
  c.v && ctes?.length
    ? { ...c, ctes: new Set([...c.ctes ?? [], ...ctes.map((t) => t.name)]) }
    : c

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

// The clauses after a query's body: ordering, then the window. A limit that is
// a whole number is written into the text: SQLite plans with a bound limit's
// value, so it prepares a statement again each time its limit is bound, which
// is every time it runs, and a statement the size of a pool's due read takes
// longer to prepare than to answer.
let tail = (
  s: { order?: Expr[]; limit?: Expr; offset?: Expr },
  c: Ctx,
): string =>
  (s.order?.length ? ` order by ${list(s.order, c)}` : '') +
  (s.limit ? ` limit ${whole(s.limit) ?? expr(s.limit, c)}` : '') +
  (s.offset ? ` offset ${expr(s.offset, c)}` : '')

let whole = (e: Expr): string | undefined =>
  e.t == 'val' && Number.isSafeInteger(e.v) ? literal(e.v) : undefined

// A collection's members as VALUES rows, unless it is one JSON array: one too
// large to write out, or any in stable text (./ast.ts `each`).
let written = (list: readonly Param[], c: Ctx): string | undefined =>
  !c.stable && bounded(list)
    ? `values ${list.map((v) => `(${literal(v)})`).join(', ')}`
    : undefined

let query: (s: Query, c: Ctx) => string = kept((s: Query, c: Ctx) => {
  if (s.t == 'raw') return expr(s, c)
  if (s.t == 'each') {
    let rows = written(s.list, c)
    return rows
      ? `select "column1" as "value" from (${rows})`
      : query(array(s.list), c)
  }
  if (s.t == 'values') {
    return `values ${s.rows.map((r) => `(${list(r, c)})`).join(', ')}`
  }
  c = within(c, s.with)
  if (s.t == 'compound') {
    return withs(s.with, c) +
      s.parts.map((p) => query(p, c)).join(` ${s.op} `) + tail(s, c)
  }
  let from = s.from == null ? [] : Array.isArray(s.from) ? s.from : [s.from]
  c = shadowed(c, from, s.joins)
  let own = c.v ? { ...c, reads: reading(s) } : c
  return withs(s.with, c) +
    `select${s.distinct ? ' distinct' : ''} ` +
    (s.cols?.length ? list(s.cols, c) : '*') +
    (from.length ? ` from ${from.map((f) => source(f, own)).join(', ')}` : '') +
    joins(s.joins, own) +
    (s.where ? ` where ${expr(s.where, c)}` : '') +
    (s.group?.length ? ` group by ${list(s.group, c)}` : '') +
    (s.having ? ` having ${expr(s.having, c)}` : '') +
    tail(s, c)
})

// What a write returns, each column of its own table under the name the
// statement asked for it by.
let returning = (es: Expr[] | undefined, c: Ctx): string =>
  es?.length
    ? ` returning ${
      es.map((e) => {
        let text = expr(e, c)
        return e.t == 'col' && c.v && ownColumn(c, e) != e.name
          ? `${text} as ${q(e.name)}`
          : text
      }).join(', ')
    }`
    : ''

let sets = (set: Record<string, Expr>, c: Ctx): string =>
  Object.entries(set).map(([k, e]) => `${q(own(c, k))} = ${expr(e, c)}`)
    .join(', ')

// Columns of the table a statement is about, by their stored names.
let owns = (ns: string[], c: Ctx): string =>
  ns.map((n) => q(own(c, n))).join(
    ', ',
  )

let upsert = (u: Upsert, c: Ctx): string =>
  ` on conflict${u.on ? ` (${list(u.on, c)})` : ''}` +
  (u.where ? ` where ${expr(u.where, c)}` : '') +
  (u.set
    ? ` do update set ${sets(u.set, c)}` +
      (u.when ? ` where ${expr(u.when, c)}` : '')
    : ' do nothing')

let ref = (r: Ref, c: Ctx): string =>
  ` references ${tableName(c, r.table)}${
    r.cols ? `(${owns(r.cols, about(c, r.table))})` : ''
  }` +
  (r.onDelete ? ` on delete ${r.onDelete}` : '')

// A default is written bare when it is a literal — `alter table … add column`
// refuses one in parentheses — and parenthesized when it is an expression.
let fallback = (e: Expr, c: Ctx): string =>
  e.t == 'lit' || e.t == 'val' ? expr(e, c) : `(${expr(e, c)})`

let column = (k: Column, c: Ctx): string =>
  [
    q(own(c, k.name)),
    k.type ? word(k.type, 'type', TYPE) : '',
    k.pk ? 'primary key' : '',
    k.autoincrement ? 'autoincrement' : '',
    k.notNull ? 'not null' : '',
    k.unique ? 'unique' : '',
    k.default ? `default ${fallback(k.default, c)}` : '',
    k.check ? `check (${expr(k.check, c)})` : '',
  ].filter(Boolean).join(' ') + (k.ref ? ref(k.ref, c) : '')

let key = (k: Key, c: Ctx): string =>
  'pk' in k
    ? `primary key (${owns(k.pk, c)})`
    : 'unique' in k
    ? `unique (${owns(k.unique, c)})`
    : 'check' in k
    ? `check (${expr(k.check, c)})`
    : `foreign key (${owns(k.fk, c)})${ref(k.ref, c)}`

let ifNot = (b?: boolean) => b ? 'if not exists ' : ''

let stmt = (s: Stmt, top: Ctx): string => {
  let c = within(
    top.at ? { ...top, at: undefined } : top,
    'with' in s ? s.with : undefined,
  )
  switch (s.t) {
    case 'insert': {
      let t = about(c, s.into, 'excluded')
      // SQLite cannot tell an upsert's `on conflict` from a join's `on` after
      // a bare select, so the select source of an upsert always has a where.
      let src = s.q && s.upsert?.length && s.q.t == 'select' && !s.q.where
        ? { ...s.q, where: { t: 'lit' as const, v: true } }
        : s.q
      return withs(s.with, c) +
        `insert${s.or ? ` or ${s.or}` : ''} into ${tableName(c, s.into)}` +
        (s.cols ? ` (${owns(s.cols, t)})` : '') +
        (src
          ? ` ${query(src, inner(t))}`
          : s.rows
          ? ` values ${s.rows.map((r) => `(${list(r, inner(t))})`).join(', ')}`
          : ' default values') +
        (s.upsert ?? []).map((u) => upsert(u, t)).join('') +
        returning(s.returning, t)
    }
    case 'update': {
      let from = s.from == null ? [] : Array.isArray(s.from) ? s.from : [s.from]
      let t = about(c, s.table, s.as)
      return withs(s.with, c) +
        `update${s.or ? ` or ${s.or}` : ''} ${tableName(c, s.table)}` +
        (s.as ? ` as ${q(s.as)}` : '') +
        ` set ${sets(s.set, t)}` +
        (from.length
          ? ` from ${from.map((f) => source(f, inner(t))).join(', ')}`
          : '') +
        (s.where ? ` where ${expr(s.where, t)}` : '') +
        returning(s.returning, t)
    }
    case 'delete': {
      let t = about(c, s.from, s.as)
      return withs(s.with, c) +
        `delete from ${tableName(c, s.from)}${s.as ? ` as ${q(s.as)}` : ''}` +
        (s.where ? ` where ${expr(s.where, t)}` : '') +
        returning(s.returning, t)
    }
    case 'create table': {
      let t = lit(about(c, s.name))
      return `create ${s.temp ? 'temp ' : ''}table ${ifNot(s.ifNot)}${
        tableName(c, s.name)
      } (${
        [
          ...s.cols.map((k) => column(k, t)),
          ...(s.keys ?? []).map((k) => key(k, t)),
        ].join(', ')
      })${s.withoutRowid ? ' without rowid' : ''}`
    }
    case 'create index': {
      let t = lit(about(c, s.on))
      return `create ${s.unique ? 'unique ' : ''}index ${ifNot(s.ifNot)}${
        q(s.name)
      } on ${tableName(c, s.on)} (${list(s.cols, t)})` +
        (s.where ? ` where ${expr(s.where, t)}` : '')
    }
    case 'create view':
      return `create ${s.temp ? 'temp ' : ''}view ${ifNot(s.ifNot)}${
        q(s.name)
      }` +
        (s.cols ? ` (${names(s.cols)})` : '') + ` as ${query(s.q, lit(c))}`
    case 'create virtual table':
      return `create virtual table ${ifNot(s.ifNot)}${q(s.name)} using ${
        word(s.using, 'module')
      }(${
        s.args.map((a) =>
          typeof a == 'string' ? q(a) : `${word(a[0], 'option')}=${
            literal(
              s.using == 'fts5' && a[0] == 'content' &&
                typeof a[1] == 'string' && c.v
                ? stored(c.v, a[1])
                : a[1],
            )
          }`
        ).join(', ')
      })`
    case 'create trigger': {
      let t = lit(about(c, s.on, 'new', 'old'))
      return `create trigger ${ifNot(s.ifNot)}${q(s.name)} ${s.timing} ${
        s.event == 'update' && s.of ? `update of ${owns(s.of, t)}` : s.event
      } on ${tableName(c, s.on)}` +
        (s.when ? ` when ${expr(s.when, t)}` : '') +
        ` begin ${s.body.map((b) => `${stmt(b, triggered(t))};`).join(' ')} end`
    }
    case 'alter table': {
      let t = lit(about(c, s.table))
      return `alter table ${tableName(c, s.table)} ` +
        ('add' in s
          ? `add column ${column(s.add, t)}`
          : 'drop' in s
          ? `drop column ${q(own(t, s.drop))}`
          : typeof s.rename == 'string'
          ? `rename to ${tableName(c, s.rename)}`
          : `rename column ${q(s.rename.column)} to ${q(s.rename.to)}`)
    }
    case 'drop':
      return `drop ${s.kind} ${s.ifExists ? 'if exists ' : ''}${
        s.kind == 'table' ? tableName(c, s.name) : q(s.name)
      }`
    case 'pragma':
      return `pragma ${s.schema ? `${q(s.schema)}.` : ''}${
        word(s.name, 'pragma')
      }` +
        (s.arg == null
          ? ''
          : `(${
            typeof s.arg == 'number' ? literal(s.arg) : tableName(c, s.arg)
          })`) +
        (s.value == null
          ? ''
          : ` = ${
            typeof s.value == 'number'
              ? literal(s.value)
              : word(s.value, 'pragma value')
          }`)
    case 'catalogued':
      return s.sql
    case 'analyze':
      return s.table == null ? 'analyze' : `analyze ${tableName(c, s.table)}`
    case 'vacuum':
      return s.into == null
        ? 'vacuum'
        : `vacuum into ${expr({ t: 'val', v: s.into }, c)}`
    case 'explain query plan':
      return `explain query plan ${stmt(s.of, c)}`
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
let lit = (c: Ctx): Ctx => c.inline ? c : { ...c, inline: true }

/**
 * A statement, or an expression, as the text SQLite runs and the parameters
 * it binds: at most `cap`, the engine's limit, and every value past it written
 * as a literal. An engine that counts a statement's common table expressions
 * passes `most`, its {@link DEPTH}: past it they are written where they are
 * named.
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
export let render = (
  node: Stmt | Expr,
  cap = VARIABLES,
  most = Infinity,
  v?: Vocab,
): Raw => rendered(node, false, cap, most, v)

/** {@link render} for a host that keeps prepared statements by their text:
 * every collection (`each`) is bound as one JSON array, so a statement's text
 * is stable whatever its members.
 *
 * ```ts
 * import { col, each, renderStable, select } from '@yaks/sql'
 *
 * renderStable(select({ cols: [col('value')], from: { t: 'from', q: each([1, 2]) } })).sql
 * // 'select "value" from (select "value" from "json_each"(?))'
 * ```
 */
export let renderStable = (
  node: Stmt | Expr,
  cap = VARIABLES,
  most = Infinity,
  v?: Vocab,
): Raw => rendered(node, true, cap, most, v)

let rendered = (
  node: Stmt | Expr,
  stable: boolean,
  cap: number,
  most: number,
  v?: Vocab,
  hoist = true,
): Raw => {
  let c: Ctx = { params: [], inline: false, stable, cap, v }
  let sql = isExpr(node) ? expr(node, c) : stmt(node, c)
  let top = hoist && long(sql) && !isExpr(node) &&
    hoisted(node, (q) => rendered(q, stable, cap, most, v, false))
  if (top) return rendered(top, stable, cap, most, v, false)
  return flat(
    raw(
      sql,
      c.params,
      node.t == 'raw' ? node.table : undefined,
      node.t == 'raw' ? node.origin : isExpr(node) ? undefined : node,
    ),
    cap,
    most,
  )
}

// One piece of a statement's text: a quoted name (`text` is the name), a
// string, a placeholder, a parenthesis, a word (`text` in lower case) or any
// other character.
type Piece = {
  kind: 'name' | 'string' | 'mark' | 'open' | 'close' | 'word' | 'other'
  at: number
  end: number
  text: string
}
let wordy = (c: number) =>
  c == 95 || digit(c) || c >= 65 && c <= 90 || c >= 97 && c <= 122
// A statement's text in pieces, or nothing where a placeholder is numbered:
// its parameters are then not in the order of its text. `counting` reads one
// anyway, for a reader that moves no parameter.
let pieces = (sql: string, counting = false): Piece[] | undefined => {
  let out: Piece[] = []
  for (let i = 0; i < sql.length;) {
    let c = sql.charCodeAt(i), end = i + 1
    let kind: Piece['kind'] = 'other'
    if (c == 32 || c == 10 || c == 9 || c == 13) {
      i++
      continue
    }
    if (c == QUOTE || c == NAME) {
      end = quoted(sql, i, c)
      kind = c == NAME ? 'name' : 'string'
    } else if (c == 63) {
      if (digit(sql.charCodeAt(end)) && !counting) return undefined
      kind = 'mark'
    } else if (c == 40) kind = 'open'
    else if (c == 41) kind = 'close'
    else if (wordy(c)) {
      while (end < sql.length && wordy(sql.charCodeAt(end))) end++
      kind = 'word'
    }
    let text = kind == 'name'
      ? sql.slice(i + 1, end - 1).replaceAll('""', '"')
      : kind == 'word'
      ? sql.slice(i, end).toLowerCase()
      : kind == 'other'
      ? sql[i]
      : ''
    out.push({ kind, at: i, end, text })
    i = end
  }
  return out
}

/** How many cursors a statement may open before it names a common table
 * expression on workerd, the SQLite under a Durable Object and D1
 * ({@link cursors}): its SQLITE_LIMIT_EXPR_DEPTH, 100. The library this
 * toolkit embeds holds SQLite's default of 1000. */
export let DEPTH = 100
export let STOCK_DEPTH = 1000

// The words that end a FROM clause's list of sources at their level.
let ENDS = new Set([
  'where',
  'group',
  'having',
  'order',
  'limit',
  'window',
  'union',
  'intersect',
  'except',
  'on',
  'using',
  'returning',
  'set',
  'values',
  'select',
])

/**
 * How many cursors SQLite opens on a statement's sources before it is done
 * naming its common table expressions. SQLite 3.54.1 (workerd's since
 * 2026-11-05) refuses to name one once the statement holds
 * SQLITE_LIMIT_EXPR_DEPTH cursors, with "VIEWs and/or subqueries nested too
 * deep" (select.c `resolveFromTermToCte`, check-in e68aa6e1), and does not
 * count the error back down, so every naming after it is refused too.
 *
 * A source in any FROM clause, a table, a table-valued function or a
 * subquery, is a cursor. A naming of a common table expression is one, and
 * its body's sources again, since SQLite expands a copy of the body at each
 * naming, materialized or not. The count is of the whole statement, which is
 * at least what SQLite holds at its last naming. A statement that names none
 * is never refused for it, however many sources it reads.
 *
 * ```ts
 * import { cursors } from '@yaks/sql'
 * import { equal } from '@yaks/testing'
 *
 * equal(cursors('select 1 from "a" join (select 1 from "b") on 1'), 0)
 * equal(cursors('with "c" as (select 1 from "a") select 1 from "c"'), 2)
 * equal(
 *   cursors(
 *     'with "c" as (select 1 from "a" join "b") ' +
 *       'select exists (select 1 from "c" where exists (select 1 from "c"))',
 *   ),
 *   6,
 * )
 * ```
 */
export let cursors = (sql: string): number => {
  if (!sql.includes('with')) return 0
  let t = pieces(sql, true)!
  let is = (i: number, kind: Piece['kind'], text?: string) =>
    t[i]?.kind == kind && (text == null || t[i].text == text)
  let closes = new Map<number, number>(), opens = new Map<number, number>()
  let open: number[] = []
  t.forEach((p, i) => {
    if (p.kind == 'open') open.push(i)
    else if (p.kind == 'close' && open.length) {
      closes.set(open.at(-1)!, i)
      opens.set(i, open.pop()!)
    }
  })
  let called = (i: number) => is(i, 'name') || is(i, 'word')
  // Each CTE's body, as the pieces it spans: `name [(columns)] as [[not]
  // materialized] (select …)`.
  let bodies = new Map<number, { name: string; from: number; to: number }>()
  for (let i = 1; i < t.length; i++) {
    if (!is(i, 'word', 'as')) continue
    let j = i + 1
    if (is(j, 'word', 'not')) j++
    if (is(j, 'word', 'materialized')) j++
    if (
      !is(j, 'open') ||
      !['select', 'with', 'values'].some((w) => is(j + 1, 'word', w))
    ) continue
    let at = is(i - 1, 'close') ? opens.get(i - 1)! - 1 : i - 1
    if (!called(at)) continue
    bodies.set(j, { name: t[at].text, from: j, to: closes.get(j) ?? t.length })
  }
  if (!bodies.size) return 0
  let names = new Map<string, { from: number; to: number }[]>()
  for (let b of bodies.values()) {
    names.set(b.name, [...names.get(b.name) ?? [], b])
  }
  let named = false
  // The cursors the pieces from `from` to `to` open, a body defined among
  // them counting only where it is named; `inside` holds the names whose
  // bodies are being counted, whose naming of themselves is a recursion.
  let count = (from: number, to: number, inside: Set<string>): number => {
    let n = 0
    // Per parenthesis: whether a source comes next, or a comma brings one.
    let state: ('next' | 'list' | 'none')[] = ['none']
    for (let i = from; i < to; i++) {
      let p = t[i]
      if (bodies.has(i)) {
        i = bodies.get(i)!.to
        continue
      }
      let at = state.length - 1
      if (p.kind == 'open') {
        let sub = ['select', 'with', 'values'].some((w) => is(i + 1, 'word', w))
        // A source in parentheses, a subquery or a list of joined ones; after
        // a source, a function's arguments or a list of columns.
        let source = state[at] == 'next'
        if (source) state[at] = 'list'
        if (source && sub) n++
        state.push(source && !sub ? 'next' : 'none')
        continue
      }
      if (p.kind == 'close') {
        if (state.length > 1) state.pop()
        continue
      }
      if (p.kind == 'word' && ENDS.has(p.text)) {
        state[at] = 'none'
        continue
      }
      if (state[at] == 'next' && called(i)) {
        state[at] = 'list'
        n++
        let defs = names.get(p.text)
        let cte = !is(i + 1, 'open') && !is(i + 1, 'other', '.')
        if (defs && cte && !inside.has(p.text)) {
          named = true
          let deeper = new Set([...inside, p.text])
          n += Math.max(...defs.map((d) => count(d.from + 1, d.to, deeper)))
        }
        continue
      }
      if (p.kind == 'word') {
        if (p.text == 'from' || p.text == 'join') state[at] = 'next'
        else if (p.text == 'update' || p.text == 'into') state[at] = 'next'
      } else if (p.kind == 'other' && p.text == ',' && state[at] == 'list') {
        state[at] = 'next'
      }
    }
    return n
  }
  let n = count(0, t.length, new Set())
  return named ? n : 0
}

/** Whether workerd refuses `sql` for naming a common table expression past
 * {@link DEPTH} cursors ({@link cursors}). */
export let deep = (sql: string): boolean => cursors(sql) >= DEPTH

// An engine counting CTE cursors gets a `not materialized` relation as a
// subquery wherever it is named: the planner reads it so either way, and a
// statement naming no CTE is never refused for its cursors (`cursors`). An
// engine with no cursor limit keeps the relation as written. Each copy binds
// its own parameters while the engine's `cap` has room, then writes them as
// literals past it. For an engine that refuses a naming past `most` cursors, a
// statement still past it has its other relations written out too, one at a
// time until it is under: a materialized one is then read once for each
// naming, which answers the same rows where the engine would answer none; a
// statement that cannot be brought under stays as it was. One named in a way
// this cannot read (a recursive one, a list of columns, a name another body
// takes) stays as it was written, and so does a statement that would run past
// LENGTH.
let HINT = ' as not materialized ('
// How far under `most` a statement is written: `cursors` counts the whole
// statement, at least what the engine holds at its last naming, but an
// UPDATE or DELETE opens a cursor on each index of its table before it reads
// its WHERE.
let MARGIN = 10
// The texts found to need nothing, since a kept statement is rendered again
// each time it runs.
let settled = new Set<string>()
let flat = (r: Raw, cap: number, most: number): Raw => {
  if (most == Infinity || !r.sql.includes('with')) return r
  let key = `${most}:${cap}:${r.sql}`
  if (settled.has(key)) return r
  let under = (sql: string) => cursors(sql) <= most - MARGIN
  let native = most == STOCK_DEPTH
  // Only workerd imposes the 100 KB statement limit.
  let fits = (sql: string) => native || !long(sql)
  // The embedded driver keeps the planner hints of statements that fit.
  if (native && under(r.sql)) {
    settle(key)
    return r
  }
  let out = r, left = new Set<string>()
  for (let turn = 0; turn < 64 && out.sql.includes(HINT); turn++) {
    let next = unfolded(out, cap, left, false)
    if (!next) break
    out = next
  }
  if (out != r && !fits(out.sql)) out = r
  if (!under(out.sql)) {
    let whole = out
    for (let turn = 0; turn < 64 && !under(whole.sql); turn++) {
      let next = unfolded(whole, cap, left, true)
      if (!next) break
      whole = next
    }
    if (under(whole.sql) && fits(whole.sql)) out = whole
  }
  if (out == r) settle(key)
  return out
}

let settle = (key: string) => {
  if (settled.size >= 512) settled.clear()
  settled.add(key)
}

// The statement with the first relation it can write out written out, or
// nothing when none is left: one written `not materialized`, or with `every`
// one written any way. `left` holds those found unreadable.
let unfolded = (
  r: Raw,
  cap: number,
  left: Set<string>,
  every: boolean,
): Raw | undefined => {
  let t = pieces(r.sql)
  if (!t) return undefined
  let closes = new Map<number, number>(), open: number[] = []
  t.forEach((p, i) => {
    if (p.kind == 'open') open.push(i)
    else if (p.kind == 'close' && open.length) closes.set(open.pop()!, i)
  })
  let is = (i: number, kind: Piece['kind'], text?: string) =>
    t[i]?.kind == kind && (text == null || t[i].text == text)
  // A definition that starts at piece `i`: its body's parentheses, and
  // whether it is one this can write out.
  let defined = (i: number) => {
    if (!is(i, 'name')) return undefined
    let j = i + 1, columns = is(j, 'open')
    if (columns) j = closes.get(j)! + 1
    if (!is(j++, 'word', 'as')) return undefined
    let not = is(j, 'word', 'not')
    if (not) j++
    let hinted = is(j, 'word', 'materialized')
    if (hinted) j++
    else if (not) return undefined
    if (!is(j, 'open') || !closes.has(j)) return undefined
    let to = closes.get(j)!
    return { name: t[i].text, i, from: j, to, hinted: not, plain: !columns }
  }
  for (let w = 0; w < t.length; w++) {
    if (!is(w, 'word', 'with')) continue
    let recursive = is(w + 1, 'word', 'recursive')
    let list: NonNullable<ReturnType<typeof defined>>[] = []
    for (let i = recursive ? w + 2 : w + 1;;) {
      let d = defined(i)
      if (!d) break
      list.push(d)
      if (!is(d.to + 1, 'other', ',')) break
      i = d.to + 2
    }
    if (!list.length) continue
    // The relation stands until the parentheses its `with` is in close.
    let outer = [...closes].filter(([from, to]) => from < w && w < to)
      .sort((a, b) => b[0] - a[0])[0]
    let until = outer ? outer[1] : t.length
    for (let [n, d] of list.entries()) {
      let body = r.sql.slice(t[d.from].end, t[d.to].at)
      let key = `${d.name} ${body}`
      if (!d.plain || !(every || d.hinted) || left.has(key)) continue
      let uses = named(t, r.sql, d, body, until, defined)
      if (!uses) {
        left.add(key)
        continue
      }
      // The definition goes with the comma beside it, or with the `with`.
      let gone = list.length == 1
        ? [t[w].at, t[d.to].end + 1]
        : n == 0
        ? [t[d.i].at, t[list[1].i].at]
        : [t[list[n - 1].to].end, t[d.to].end]
      return spliced(r, t, gone, [t[d.from].end, t[d.to].at], uses, cap)
    }
  }
  return undefined
}

// One naming of a relation as a source: its name's place, whether the source
// is given another name there, and the place of a `not indexed` after it.
type Use = { at: number; end: number; alias: boolean; hint?: number[] }

// Where the statement names `d` as a source before piece `until`, each with
// whether it gives the source another name there, or nothing where it is
// named in a way that is not read.
let named = (
  t: Piece[],
  sql: string,
  d: { name: string; from: number; to: number },
  body: string,
  until: number,
  defined: (i: number) => { from: number; to: number } | undefined,
): Use[] | undefined => {
  let uses: Use[] = []
  for (let k = d.from; k < until; k++) {
    let p = t[k]
    if (p.kind != 'name' || p.text != d.name) continue
    // Its own body naming it is a recursion.
    if (k < d.to) return undefined
    let before = t[k - 1], after = t[k + 1]
    if (after?.kind == 'other' && after.text == '.') continue
    let source = before.kind == 'word' &&
      (before.text == 'from' || before.text == 'join')
    if (source && after?.kind != 'open') {
      let alias = after?.kind == 'name' ||
        after?.kind == 'word' && after.text == 'as'
      // `not indexed` is said of a table, and a subquery has no index.
      let hint = k + (!alias ? 1 : after.kind == 'name' ? 2 : 3)
      let unindexed = t[hint]?.kind == 'word' && t[hint].text == 'not' &&
        t[hint + 1]?.kind == 'word' && t[hint + 1].text == 'indexed'
      uses.push({
        at: p.at,
        end: p.end,
        alias,
        ...unindexed ? { hint: [t[hint - 1].end, t[hint + 1].end] } : {},
      })
      continue
    }
    if (before.kind == 'word' && before.text == 'as') continue
    // The same relation defined again in a scope below reads the same rows.
    let again = defined(k)
    if (again && sql.slice(t[again.from].end, t[again.to].at) == body) {
      k = again.to
      continue
    }
    return undefined
  }
  return uses
}

// The statement without the text at `gone`, and with the text at `body` in
// parentheses at each of `uses`.
let spliced = (
  r: Raw,
  t: Piece[],
  gone: number[],
  body: number[],
  uses: Use[],
  cap: number,
): Raw => {
  let marks = t.filter((p) => p.kind == 'mark').map((p) => p.at)
  // How many parameters the text before `at` binds.
  let bound = (at: number) => {
    let lo = 0, hi = marks.length
    while (lo < hi) {
      let mid = (lo + hi) >> 1
      if (marks[mid] < at) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  let part = (from: number, to: number): Raw =>
    raw(r.sql.slice(from, to), r.params.slice(bound(from), bound(to)))
  let copy = part(body[0], body[1])
  let name = r.sql.slice(uses[0]?.at, uses[0]?.end)
  // What the statement binds apart from the relation, then each copy's own.
  let room = cap - (r.params.length - copy.params.length)
  let sql = '', params: Param[] = [], at = 0
  let keep = (to: number) => {
    let kept = part(at, to)
    sql += kept.sql
    params.push(...kept.params)
  }
  keep(gone[0])
  at = gone[1]
  for (let use of uses) {
    keep(use.at)
    at = use.end
    let binds = copy.params.length <= room
    if (binds) room -= copy.params.length
    sql += `(${binds ? copy.sql : literals(copy)})${
      use.alias ? '' : ` as ${name}`
    }`
    if (binds) params.push(...copy.params)
    if (use.hint) {
      keep(use.hint[0])
      at = use.hint[1]
    }
  }
  keep(r.sql.length)
  return raw(sql, params, r.table, r.origin)
}

// The statements that open with their own `with`.
let WITH = new Set(['select', 'compound', 'insert', 'update', 'delete'])
type Topped = Extract<Stmt, { with?: Cte[] }>

let plain = (v: unknown): v is Record<string, unknown> =>
  typeof v == 'object' && v != null && !Array.isArray(v) &&
  Object.getPrototypeOf(v) == Object.prototype

/**
 * The statement with every shared relation it holds below its top written
 * once at its top instead, or null when none is written twice or one cannot
 * move. They move only where each name means one relation throughout the
 * statement: two different bodies under one name, or a name given to a shared
 * relation and to one that is not, leave the statement as it is. They move in
 * the order their uses need them, each after those its body holds. A raw
 * fragment is text, and is left as it stands.
 */
let hoisted = (s: Stmt, write: (q: Query) => Raw): Topped | null => {
  if (!WITH.has(s.t)) return null
  let top = s as Topped
  let same = (a: Cte, b: Cte) => {
    if (a == b) return true
    let [x, y] = [write(a.q), write(b.q)]
    let rest = (c: Cte, r: Raw) =>
      JSON.stringify([c.cols, c.recursive, c.materialized, r.sql, r.params])
    return rest(a, x) == rest(b, y)
  }
  let moving = new Map<string, Cte>()
  let plainNames = new Set<string>()
  let twice = false, mixed = false
  let note = (cte: Cte) => {
    if (!cte.shared) return void plainNames.add(cte.name)
    let held = moving.get(cte.name)
    if (!held) return void moving.set(cte.name, cte)
    twice = true
    if (!same(held, cte)) mixed = true
  }
  let visit = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(visit)
    if (!plain(v) || v.t == 'raw') return
    for (let [k, x] of Object.entries(v)) {
      if (k != 'with' || !Array.isArray(x)) visit(x)
      else for (let cte of x as Cte[]) visit(cte.q), note(cte)
    }
  }
  let { with: ctes = [], ...body } = top
  for (let cte of ctes) visit(cte.q)
  visit(body)
  // A name the top already defines is dropped below it, not moved.
  let dropped = new Set(moving.keys())
  for (let cte of ctes) {
    let held = moving.get(cte.name)
    if (held && !same(held, cte)) mixed = true
    if (held) twice = true
    moving.delete(cte.name)
  }
  for (let name of plainNames) if (dropped.has(name)) mixed = true
  if (mixed || !twice) return null
  let strip = <T>(v: T): T => {
    if (Array.isArray(v)) {
      let out = v.map(strip)
      return (out.some((x, i) => x !== v[i]) ? out : v) as T
    }
    if (!plain(v) || v.t == 'raw') return v
    let out: Record<string, unknown> = {}, changed = false
    for (let [k, x] of Object.entries(v)) {
      let kept = k == 'with' && Array.isArray(x)
        ? (x as Cte[]).filter((cte) => !dropped.has(cte.name))
        : undefined
      let y = strip(kept && kept.length < (x as Cte[]).length ? kept : x)
      out[k] = y
      changed ||= y !== x
    }
    return (changed ? out : v) as T
  }
  return {
    ...strip(body),
    with: [...moving.values(), ...ctes].map(strip),
  } as Topped
}

/** The statement's SQL shape, without values. Bound parameters were never in
 * the SQL text; literals are masked here too, including those inside a
 * fragment lowered by this package. Identifiers stay visible for diagnosis.
 * Reading stops once `limit` characters are written, for a caller that keeps
 * only the start. */
export let shape = (rendered: Raw, limit = Infinity): string => {
  let sql = rendered.sql, out = '', from = 0, i = 0
  // Runs of plain text are copied whole; each literal becomes one `?`.
  let mask = (to: number) => {
    out += sql.slice(from, i) + '?'
    from = i = to
  }
  while (i < sql.length && out.length + i - from < limit) {
    let c = sql.charCodeAt(i)
    if (c == QUOTE) mask(quoted(sql, i, QUOTE))
    else if (c == NAME) i = quoted(sql, i, NAME)
    else if (digit(c)) {
      let j = i + 1
      while (j < sql.length && numeric(sql.charCodeAt(j))) j++
      mask(j)
    } else i++
  }
  return out + sql.slice(from, i)
}
let QUOTE = 39, NAME = 34
let digit = (c: number) => c >= 48 && c <= 57
// A number's characters after its first digit: digits, `.`, `e`, `E`, `+`, `-`.
let numeric = (c: number) =>
  digit(c) || c == 46 || c == 101 || c == 69 || c == 43 || c == 45
// Where a quoted run that opens at `i` ends: past its closing quote, a
// doubled quote inside it being one quote.
let quoted = (sql: string, i: number, q: number): number => {
  for (i++; i < sql.length;) {
    if (sql.charCodeAt(i++) != q) continue
    if (sql.charCodeAt(i) == q) i++
    else break
  }
  return i
}

// A compiled fragment is still a value when it is embedded in an inline
// expression. Substitute its parameters outside quoted strings and names.
let literals = ({ sql, params }: Raw): string => {
  let out = '', start = 0, value = 0
  for (let i = 0; i < sql.length;) {
    let c = sql.charCodeAt(i)
    if (c == QUOTE || c == NAME) i = quoted(sql, i, c)
    else if (c == 63) {
      let end = i + 1
      while (end < sql.length && digit(sql.charCodeAt(end))) end++
      let position = end == i + 1 ? value++ : Number(sql.slice(i + 1, end)) - 1
      value = Math.max(value, position + 1)
      out += sql.slice(start, i) + literal(params[position])
      start = i = end
    } else i++
  }
  return out + sql.slice(start)
}

/** A statement as a trace keeps it: its shape, and when that runs past `max`
 * characters, its start and how many parameters it binds, so a long batched
 * write still says what it is and how big it was. */
export let excerpt = (rendered: Raw, max = 512): string => {
  let { sql } = rendered, memo = excerpts.get(max)
  let had = memo?.get(sql)
  if (had != null) return had
  let text = shape(rendered, max + 1)
  if (text.length > max) {
    let n = rendered.params.length
    let size = ` … (${n} parameter${n == 1 ? '' : 's'})`
    text = text.slice(0, max - size.length) + size
  }
  if (sql.length > MEMO_TEXT) return text
  if (!memo) excerpts.set(max, memo = new Map())
  if (memo.size >= MEMO_SIZE) memo.clear()
  memo.set(sql, text)
  return text
}
// A trace runs the same statements over and over: each text is shaped once,
// and every span that ran it holds the one excerpt. Bounded by count and by
// the length of a text kept.
let excerpts = new Map<number, Map<string, string>>()
let MEMO_SIZE = 1024, MEMO_TEXT = 4096

/** An expression written with every value as a literal, parenthesized where an
 * operator around it would take it apart: what an ORDER BY term or a derived
 * read is spliced into the binder's text as. */
export let inline = (e: Expr, v?: Vocab): string =>
  operand(e, { params: [], inline: true, stable: false, cap: 0, v })

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
