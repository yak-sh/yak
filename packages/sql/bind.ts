// The binding pass: an @yaks/query AST plus an @yaks/vocab schema, lowered to
// the relational IR. This is where a raw, unrouted query becomes a statement
// over real tables — every path routed through the vocab (`route`/`aim`), every
// value coerced by its column's category, every directive turned into a
// projection, a bound, or an ordering.
//
// The binder is dialect-agnostic: it asks the injected `Dialect` for every
// table name, join key and column expression, and composes them into the IR's
// algebraic condition tree. Swap the dialect and the same AST binds against a
// different store.
//
// Scope. The COMMON query path is here and exact: predicates (every operator),
// any-of lists, ranges, time phrases, boolean composition, reference-deref
// paths, reverse hops (`.reviews!`, `.reviews>=5`, `.reviews.stars=5`),
// full-text terms, the `.kind` scope, presence/absence, ordering,
// `.limit`/`.after` windows, `.count`/`.distinct`/`.tally` aggregates,
// `.fields` projections, and the `.refs=` backlink union. A column the schema
// marks computed (`persist: false`) reads through the DERIVED hook or, absent a
// registration, DECLINES — the binder never invents a value it cannot read.
//
// What is NOT here declines LOUDLY (an `Unsupported` throw, never a silent
// wrong answer): the `.near` KNN and the `.edges`/`.reaches` graph walks and the
// lazy partition they read (their edge-nature normalization is application
// logic the vocab does not carry).

import type {
  After,
  And,
  Clause,
  Count,
  Distinct,
  Fields,
  Limit,
  Or,
  Order,
  Pred,
  Range,
  Refs,
  Tally,
  Value,
} from '@yaks/query'
import type { Assoc, Hop, Vocab } from '@yaks/vocab'
import {
  and,
  type Cond,
  FALSE,
  type Frag,
  type Join,
  joined,
  or,
  raw,
  type Rel,
  rel,
  renderCond,
  TRUE,
} from './ir.ts'
import { type Dialect, sqlite, type Tag, tagOf } from './sqlite.ts'
import type { Derived } from './derived.ts'

// Thrown for a clause the binder cannot express EXACTLY. A caller catches it to
// fall back to a JS matcher, or to report the gap.
export class Unsupported extends Error {
  feature: string
  constructor(feature: string, detail = '') {
    super(`@yaks/sql cannot compile ${feature}${detail ? `: ${detail}` : ''}`)
    this.feature = feature
    this.name = 'Unsupported'
  }
}

export type BindOpts = {
  dialect?: Dialect
  derived?: Derived
  now?: number
}

// The mutable knot a single bind threads: the schema, the dialect, the derived
// registry, the reference moment, and the growing set of component tables to
// LEFT JOIN. Everything else is a pure function of a clause.
type Ctx = {
  v: Vocab
  d: Dialect
  derived: Derived
  now: number
  tables: Set<string>
}

// A structured @yaks/query value flattened back to the one string the dialect's
// lowering re-parses — a list to `a,b`, a range to `lo..hi` (inclusive) or
// `lo...hi` (exclusive end). The dialect's `eq` splits it again exactly as the
// JS matcher does, so a round trip through the string form is faithful.
let flat = (val: Value | null): string => {
  if (val == null) return ''
  if (val.kind == 'scalar' || val.kind == 'time') return val.raw
  if (val.kind == 'list') return val.items.map(flat).join(',')
  let r = val as Range
  return `${flat(r.lo)}..${r.exclusiveEnd ? '.' : ''}${flat(r.hi)}`
}

// The operator spelling a lowering switches on: '' equals (and, with an
// empty operand, absence — the dialect's eq() reads them as one road), '!'
// not-equals, '~' contains, the comparisons literal, 'exists' presence, 'want'
// the value-less projection request. This is the one translation from the
// @yaks/query operator set.
let EXISTS = 'exists'
let opOf = (p: Pred): string =>
  p.op == '!'
    ? EXISTS
    : p.op == '?'
    ? 'want'
    : p.op == '='
    ? ''
    : p.op == '!='
    ? '!'
    : p.op == '~='
    ? '~'
    : p.op

// One column's read expression and how a value types against it, resolved
// through the derived hook first (a computed column or a read override), then
// the dialect's storage lowering. `owner` is the SQL naming this entity's
// integer id — the anchor a derived expression builds on. Declines (null) a
// computed column with no registered expression.
type Read = { expr: string; tag: Tag } | null
let readCol = (ctx: Ctx, comp: string, prop: string, owner: string): Read => {
  let key = `${comp}.${prop}`
  let dc = ctx.derived[key]
  if (dc) {
    for (let dep of dc.deps ?? []) ctx.tables.add(dep)
    return { expr: dc.expr(owner), tag: dc.tag }
  }
  let col = ctx.v.column(comp, prop)
  if (col && !col.persist) return null // computed, no expression to read it
  let expr = ctx.d.col(comp, prop, ctx.v)
  if (expr == null) return null
  return {
    expr,
    tag: comp == 'entity' ? 'text' : prop == 'eid' ? 'eid' : tagOf(col!),
  }
}

// A scalar predicate over a resolved column expression, lowered branch by
// branch. Returns a Frag or null when it cannot be expressed with the matcher's
// exact semantics.
let lowerScalar = (
  ctx: Ctx,
  c: string,
  op: string,
  value: string,
  tag: Tag,
): Frag | null => {
  let d = ctx.d
  if (op == EXISTS) return { sql: `${c} is not null`, params: [] }
  if (tag == 'time' && op != '~') {
    let t = d.time(c, op, value, ctx.now)
    if (t) return t
  }
  if (op == '') return d.eq(c, value, tag)
  if (op == '!') return d.ne(c, value, tag)
  if (op == '~') return d.contains(c, value)
  if (['<', '<=', '>', '>='].includes(op)) {
    let inner = d.cmp(c, op, value, tag)
    return inner &&
      { sql: `(${c} is not null and ${inner.sql})`, params: inner.params }
  }
  return null
}

// A single-hop predicate: a direct column, or a component facet (an empty leaf
// prop — presence grammar). `.task!`/`.task~=` present, everything else absent.
let single = (ctx: Ctx, hop: Hop, p: Pred): Cond => {
  let op = opOf(p)
  if (op == 'want') return TRUE // a projection request; the door hydrates it
  if (!hop.prop) {
    ctx.tables.add(hop.comp)
    let eid = ctx.d.col(hop.comp, 'eid', ctx.v)!
    let present = op == '~' || op == EXISTS
    return raw({ sql: `${eid} is ${present ? 'not ' : ''}null`, params: [] })
  }
  if (hop.comp != 'entity') ctx.tables.add(hop.comp)
  let read = readCol(ctx, hop.comp, hop.prop, `"${hop.comp}"."entity"`)
  if (!read) {
    throw new Unsupported(
      'a computed column',
      `.${hop.comp}.${hop.prop} has no registered expression`,
    )
  }
  let frag = lowerScalar(ctx, read.expr, op, flat(p.value), read.tag)
  if (!frag) {
    throw new Unsupported('this predicate', `.${hop.comp}.${hop.prop} ${p.op}`)
  }
  return raw(frag)
}

// A reference-deref path: a chain of one-to-one lookups through reference
// columns, ending in a leaf column tested against op/value. Nested correlated
// scalar subqueries walk the chain without widening the candidate set. Every
// non-final hop must be a reference.
let source = (comp: string) => comp == 'doc' ? '"doc_value"' : `"${comp}"`
let isRef = (v: Vocab, comp: string, prop: string) =>
  v.column(comp, prop)?.category == 'ref'

let path = (ctx: Ctx, hops: Hop[], p: Pred): Cond => {
  let op = opOf(p)
  if (op == 'want') return TRUE
  let root = hops[0]
  if (!isRef(ctx.v, root.comp, root.prop)) {
    throw new Unsupported(
      'a path',
      `.${root.comp}.${root.prop} is not a reference`,
    )
  }
  ctx.tables.add(root.comp)
  let target = `"${root.comp}"."${root.prop}"`
  for (let i = 1; i < hops.length - 1; i++) {
    let h = hops[i]
    if (!isRef(ctx.v, h.comp, h.prop)) {
      throw new Unsupported('a path', `.${h.comp}.${h.prop} is not a reference`)
    }
    target =
      `(select "__p${i}"."${h.prop}" from ${source(h.comp)} as "__p${i}"` +
      ` where "__p${i}"."entity" = ${target})`
  }
  let leaf = hops[hops.length - 1]
  // A leaf facet: does the target wear this component?
  if (!leaf.prop) {
    let owner = leaf.comp == 'entity' ? `"__pl"."id"` : `"__pl"."entity"`
    let hit = `(select ${owner} from ${source(leaf.comp)} as "__pl"` +
      ` where ${owner} = ${target})`
    let present = op == '~' || op == EXISTS
    return raw({ sql: `${hit} is ${present ? 'not ' : ''}null`, params: [] })
  }
  // The leaf column, read from the target owner. Derived reads (status,
  // updated.at) build on `target` as their owner; a reference leaf projects to
  // its eid; a plain column is a correlated scalar read.
  let read = leafRead(ctx, leaf, target)
  if (!read) {
    throw new Unsupported('a computed path leaf', `.${leaf.comp}.${leaf.prop}`)
  }
  let frag = lowerScalar(ctx, read.expr, op, flat(p.value), read.tag)
  if (!frag) {
    throw new Unsupported(
      'this path predicate',
      `.${leaf.comp}.${leaf.prop} ${p.op}`,
    )
  }
  // The narrowing a rooted path keeps: the row must wear the root component,
  // which lets the planner drive from the root's table.
  let needsRoot = op == EXISTS || ['<', '<=', '>', '>='].includes(op) ||
    ((op == '' || op == '~') && flat(p.value) != '')
  return needsRoot
    ? raw({
      sql: `("${root.comp}"."entity" is not null and ${frag.sql})`,
      params: frag.params,
    })
    : raw(frag)
}

// A path leaf's read expression, correlated on the target owner int.
let leafRead = (ctx: Ctx, leaf: Hop, target: string): Read => {
  let key = `${leaf.comp}.${leaf.prop}`
  let dc = ctx.derived[key]
  if (dc) return { expr: dc.expr(target), tag: dc.tag }
  let col = ctx.v.column(leaf.comp, leaf.prop)
  if (col && !col.persist) return null
  if (leaf.comp == 'entity') {
    return {
      expr:
        `(select "__pl"."${leaf.prop}" from "entity" as "__pl" where "__pl"."id" = ${target})`,
      tag: 'text',
    }
  }
  if (col?.category == 'ref') {
    return {
      expr: `(select "__pr"."eid" from ${source(leaf.comp)} as "__pl"` +
        ` join entity "__pr" on "__pr"."id" = "__pl"."${leaf.prop}"` +
        ` where "__pl"."entity" = ${target})`,
      tag: 'eid',
    }
  }
  return {
    expr: `(select "__pl"."${leaf.prop}" from ${source(leaf.comp)} as "__pl"` +
      ` where "__pl"."entity" = ${target})`,
    tag: col ? tagOf(col) : 'text',
  }
}

// `.kind=K`: the entity wears K and every kind that sorts before it is absent —
// the exact index-answerable form of "K is the most specific kind present".
// Plural folds in (`.kind=tasks` reads as `.kind=task`).
let kindScope = (ctx: Ctx, value: string): Cond => {
  let kinds = ctx.v.kinds
  let k = kinds.includes(value)
    ? value
    : value.endsWith('s') && kinds.includes(value.slice(0, -1))
    ? value.slice(0, -1)
    : null
  if (!k) throw new Unsupported('.kind', `${value} names no kind`)
  let i = kinds.indexOf(k)
  ctx.tables.add(k)
  let parts: Cond[] = [raw(ctx.d.presence(k))]
  for (let earlier of kinds.slice(0, i)) {
    ctx.tables.add(earlier)
    parts.push(raw({ sql: `"${earlier}"."entity" is null`, params: [] }))
  }
  return and(...parts)
}

// The multi-column reverse-union: the backlinks of `value`, the union of every
// reference column that equals it. Cleanly derivable from the vocab's ref-column
// list. Only the positive `.refs=X` compiles; presence/absence decline.
let refsUnion = (ctx: Ctx, r: Refs): Cond => {
  if (r.op != '=' || !r.value) {
    throw new Unsupported('.refs', 'only .refs=<id> compiles')
  }
  let cols = ctx.v.refCols()
  let subs = cols.map(([c, pr]) =>
    `select "${c}"."entity" from "${c}" where "${c}"."${pr}" = (select id from entity where eid = ?)`
  )
  return raw({
    sql: `"entity"."id" in (${subs.join(' union ')})`,
    params: cols.map(() => r.value),
  })
}

// The LEFT joins for the tables a bind touched, keyed on the row they hang off:
// the spine for a membership, the child table inside a reverse hop's subquery
// (which is the FROM there, so it is never re-joined).
let joinsOf = (ctx: Ctx, base = 'entity'): Join[] =>
  [...ctx.tables]
    .filter((t) => t != 'entity' && t != base)
    .map((t) => ({ source: ctx.d.table(t), on: ctx.d.joinOn(t, base) }))

// The operators a cardinality test compares its count with.
let COUNT_OPS: Record<string, string> = {
  '=': '=',
  '!=': '!=',
  '<': '<',
  '<=': '<=',
  '>': '>',
  '>=': '>=',
}

// A REVERSE HOP: the entities whose child rows point back at them, named by the
// vocab's derived association (`.reviews` = the reviews whose `book` is this
// row). `.reviews!` is presence, `.reviews=` absence, `.reviews>=5` a
// cardinality test, and `.reviews.stars=5` an existential over a filtered child.
//
// Each compiles to a correlated EXISTS (or count) over the child's reference
// column — an index search per candidate rather than a join that widens the
// selection. A child filter rides the SAME clause compiler over the child row,
// so anything that declines there declines the whole hop and exactness holds
// across the correlation. A child predicate naming the spine declines outright:
// inside the subquery `entity` is the correlation to the OUTER row, so binding
// it there would silently ask a different question.
let reverse = (ctx: Ctx, name: string, a: Assoc, p: Pred): Cond => {
  let child = ctx.d.table(a.comp)
  let corr = `"${a.comp}"."${a.prop}" = "entity"."id"`
  let rest = p.path.slice(1)
  let value = flat(p.value)
  if (!rest.length) {
    if (p.op == '!' || (p.op == '~=' && !value)) {
      return raw({
        sql: `exists (select 1 from ${child} where ${corr})`,
        params: [],
      })
    }
    if (p.op == '=' && !value) {
      return raw({
        sql: `not exists (select 1 from ${child} where ${corr})`,
        params: [],
      })
    }
    let op = COUNT_OPS[p.op]
    if (!op || !/^\d+$/.test(value)) {
      throw new Unsupported(
        'a reverse hop',
        `.${name}${p.op}${value} is neither a count nor a child filter`,
      )
    }
    return raw({
      sql: `(select count(*) from ${child} where ${corr}) ${op} ?`,
      params: [Number(value)],
    })
  }
  if (ctx.v.aim(rest.join('.')).some((h) => h.comp == 'entity')) {
    throw new Unsupported(
      'a reverse hop through the spine',
      `.${name}.${rest.join('.')}`,
    )
  }
  let sub: Ctx = { ...ctx, tables: new Set() }
  let inner = renderCond(clause(sub, { ...p, path: rest }))
  return raw({
    sql: `exists (select 1 from ${child}${joined(joinsOf(sub, a.comp))}` +
      ` where ${corr}${inner.sql == '1' ? '' : ` and ${inner.sql}`})`,
    params: inner.params,
  })
}

// One filter clause to a condition. Directives are stripped before this runs.
let clause = (ctx: Ctx, c: Clause): Cond => {
  if (c.kind == 'never') return FALSE
  if (c.kind == 'text') {
    ctx.tables.add('doc')
    return raw(ctx.d.text(c.value))
  }
  if (c.kind == 'and') return and(...c.clauses.map((x) => clause(ctx, x)))
  if (c.kind == 'or') return or(...(c as Or).clauses.map((x) => clause(ctx, x)))
  if (c.kind == 'refs') return refsUnion(ctx, c)
  if (c.kind == 'pred') {
    if (c.path[0] == 'kind' && c.path.length == 1) {
      return kindScope(ctx, flat(c.value))
    }
    // A plural leading the path is a reverse association, read from the far
    // side; anything else routes forward through the vocab.
    let assoc = ctx.v.assoc(c.path[0])
    if (assoc) return reverse(ctx, c.path[0], assoc, c)
    let hops = ctx.v.aim(c.path.join('.'))
    return hops.length == 1 ? single(ctx, hops[0], c) : path(ctx, hops, c)
  }
  throw new Unsupported(`the ${(c as Clause).kind} directive`)
}

// The directives, read off the top-level clause list. Order/limit/after ride a
// membership; count/distinct/tally reshape it; near/edges/reaches decline.
let DIRECTIVES = new Set([
  'order',
  'near',
  'count',
  'distinct',
  'tally',
  'fields',
  'limit',
  'after',
  'edges',
  'reaches',
])
let find = <T extends Clause>(cs: Clause[], kind: string): T | undefined =>
  cs.find((c) => c.kind == kind) as T | undefined

// A path resolved for a directive value (order, fields): its column expression.
let resolveField = (
  ctx: Ctx,
  pathStr: string,
): { expr: string; comp: string } => {
  let hops = ctx.v.aim(pathStr)
  if (hops.length != 1) {
    throw new Unsupported('a projected/ordered path', pathStr)
  }
  let h = hops[0]
  ctx.tables.add(h.comp)
  let read = readCol(ctx, h.comp, h.prop, `"${h.comp}"."entity"`)
  if (!read) throw new Unsupported('a computed column here', pathStr)
  return { expr: read.expr, comp: h.comp }
}

// AST → IR. The one function `compile` renders.
export let bind = (ast: And, vocab: Vocab, opts: BindOpts = {}): Rel => {
  let ctx: Ctx = {
    v: vocab,
    d: opts.dialect ?? sqlite,
    derived: opts.derived ?? {},
    now: opts.now ?? Date.now(),
    tables: new Set(),
  }
  let cs = ast.clauses
  for (let c of cs) {
    if (c.kind == 'near' || c.kind == 'edges' || c.kind == 'reaches') {
      throw new Unsupported(`.${c.kind}`)
    }
  }
  let filters = cs.filter((c) => !DIRECTIVES.has(c.kind))
  let where = and(...filters.map((c) => clause(ctx, c)), raw(ctx.d.live()))

  let count = find<Count>(cs, 'count')
  let distinct = find<Distinct>(cs, 'distinct')
  let tally = find<Tally>(cs, 'tally')

  // `.count!`: how many entities the filter selects, under the empty key so
  // every aggregate comes back as one value→count shape.
  if (count) {
    return rel(ctx.d.spine, {
      cols: [`'' as value`, 'count(*) as n'],
      joins: joinsOf(ctx),
      where,
    })
  }
  // `.distinct`/`.tally`: the non-empty values of a column (a text/enum/eid
  // column only — a numeric or time cast would disagree with the matcher), or a
  // per-value count. Empties dropped.
  if (distinct || tally) {
    let agg = (distinct ?? tally)!
    let { expr } = resolveField(ctx, agg.path.join('.'))
    // decline a numeric/time/derived column: only text/enum/eid tally exactly
    let hop = ctx.v.aim(agg.path.join('.'))[0]
    let tag = ctx.derived[`${hop.comp}.${hop.prop}`]?.tag ??
      (hop.prop == 'eid'
        ? 'eid'
        : (hop.comp == 'entity'
          ? 'text'
          : tagOf(ctx.v.column(hop.comp, hop.prop)!)))
    if (!['text', 'enum', 'eid'].includes(tag)) {
      throw new Unsupported('.distinct/.tally', `over a ${tag} column`)
    }
    let value = `cast(${expr} as text) as value`
    let nonEmpty = and(
      raw({ sql: `${expr} is not null`, params: [] }),
      raw({ sql: `cast(${expr} as text) != ''`, params: [] }),
      where,
    )
    return tally
      ? rel(ctx.d.spine, {
        cols: [value, 'count(*) as n'],
        joins: joinsOf(ctx),
        where: nonEmpty,
        group: 'value',
        order: ['value'],
      })
      : rel(ctx.d.spine, {
        cols: [value],
        uniq: true,
        joins: joinsOf(ctx),
        where: nonEmpty,
        order: ['value'],
      })
  }

  // A membership or field-projected selection.
  let fields = find<Fields>(cs, 'fields')
  let cols = [ctx.d.membership]
  if (fields) {
    for (let f of fields.fields) {
      let { expr } = resolveField(ctx, f.path.join('.'))
      cols.push(`${expr} as "${f.path.join('.')}"`)
    }
  }
  let out = rel(ctx.d.spine, { cols, joins: joinsOf(ctx), where })

  // Ordering, then the window. `.order=-field` is descending. The window is
  // newest-first by spine num, with `.after` continuing below a num cursor.
  let order = find<Order>(cs, 'order')
  if (order) out.order.push(orderExpr(ctx, order.value))
  let limit = find<Limit>(cs, 'limit')
  let after = find<After>(cs, 'after')
  if (limit || after) {
    if (after) {
      out.where = and(
        out.where,
        raw({ sql: `"entity"."num" < ?`, params: [after.n] }),
      )
    }
    out.order = [`"entity"."num" desc`]
    if (limit) out.limit = limit.n
  }
  return out
}

// An order value to an ORDER BY expression. A leading '-' is descending; the
// rest routes to a column. (An in-memory matcher would sort these in JS;
// compiling them into the statement is a capability this IR adds.)
let orderExpr = (ctx: Ctx, value: string): string => {
  let desc = value.startsWith('-')
  let field = desc ? value.slice(1) : value
  let { expr } = resolveField(ctx, field)
  return `${expr}${desc ? ' desc' : ''}`
}
