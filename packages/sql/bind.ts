// The binding pass: an @yaks/query AST plus an @yaks/vocab schema, lowered to
// the relational representation. This is where an unrouted query becomes a
// statement over actual tables — every path routed through the vocabulary
// (`route`/`aim`), every value coerced according to its column's category,
// every directive turned into a projected column, a limit, or an ORDER BY.
//
// The binder is backend-independent: it asks the injected `Dialect` for every
// table name, join key and column expression, and combines them into a
// condition tree. Swap the dialect and the same AST binds against a different
// database.
//
// A clause this compiler cannot handle alone may still be compiled by another
// package: an `Extension` (./extend.ts) claims a clause kind and lowers it to a
// condition over the same representation. Extensions are consulted before the
// built-in compilation, and a directive an extension claims is no longer
// refused.
//
// Scope. The common query path is here and exact: predicates (every operator),
// any-of lists, ranges, time phrases, boolean composition, paths that
// dereference a reference column, reverse hops (`.reviews!`, `.reviews>=5`,
// `.reviews.stars=5`), full-text terms, the `.kind` scope, presence and
// absence, ordering, `.limit`/`.after` windows (which page within a requested
// `.order`, by a keyset condition on the anchor entity's own place in it), the
// `.count`/`.distinct`/`.tally` aggregates, `.fields` projections, and the
// `.refs=` backlink union. A column the schema marks computed
// (`computed: true`) is read through the derived hook, or, if no expression was
// registered for it, declines — the binder never invents a value it cannot
// read.
//
// The walk (`.fork.from->S-7`) compiles here when its path is a reference
// column, or a chain of them (`.fork.from.session->S-1`, one step across the
// composed relation) — one recursive CTE over that step (./walk.ts). A path
// naming a relation belongs to @yaks/edge: extensions are consulted first, and
// that package owns the edge table and the types an edge can have, neither of
// which is in this vocabulary.
//
// What is NOT here fails loudly, by throwing `Unsupported` rather than
// returning a silently wrong answer: the `.edges` rider (edge-typed, so
// @yaks/edge's), a walk over neither a relation nor reference columns, and the
// `.near` nearest-neighbour search, which needs vectors this package does not
// hold — @yaks/embedding registers as an extension and compiles it, ordering
// included.

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
  Walk,
} from '@yaks/query'
import { bare } from '@yaks/query'
import type { Assoc, Hop, Presence, Vocab } from '@yaks/vocab'
import { Unknown } from '@yaks/vocab'
import {
  and,
  type Bind,
  type Cond,
  FALSE,
  type Frag,
  type Join,
  joined,
  or,
  raw,
  type Rel,
  rel,
  render,
  renderCond,
  TRUE,
} from './ir.ts'
import { type Arm, ARMS, arms, cut } from './compound.ts'
import { type Dialect, sqlite, type Tag, tagOf } from './sqlite.ts'
import type { Derived, DerivedCol } from './derived.ts'
import type { Extension, Site } from './extend.ts'
import { type Identity, identity } from './ident.ts'
import { walkSql } from './walk.ts'
import type { ArchetypeSet } from './archetype.ts'

// Thrown for a clause the binder cannot express exactly. A caller catches it to
// fall back to another evaluator, or to report the gap. `by` names the package
// that declined, so that another evaluator of the same grammar (@yaks/match
// compiles the AST to an in-memory predicate) can refuse through this same
// class, leaving every caller with one error type to catch.
export class Unsupported extends Error {
  feature: string
  by: string
  constructor(feature: string, detail = '', by = '@yaks/sql') {
    super(`${by} cannot compile ${feature}${detail ? `: ${detail}` : ''}`)
    this.feature = feature
    this.by = by
    this.name = 'Unsupported'
  }
}

export type BindOpts = {
  dialect?: Dialect
  derived?: Derived
  extend?: Extension[]
  now?: number
  /** Matching against a current snapshot of this database file's archetypes,
   * done while the statement is being compiled. */
  archetypes?: ArchetypeSet
}

// The mutable state one call to `bind` threads through: the schema, the
// dialect, the derived-column registry, the registered extensions, the moment
// time phrases resolve against, and the growing set of component tables to left
// join. Everything else is a pure function of a clause.
type Ctx = {
  v: Vocab
  d: Dialect
  derived: Derived
  ext: Extension[]
  now: number
  tables: Set<string>
  owner?: string
  archetypes?: ArchetypeSet
}

// Presence means the component row EXISTS, never that one of its columns is
// non-null. Matching an archetype needs no join to any of the component tables
// the test names.
let byArchetype = (
  ctx: Ctx,
  predicate: Presence,
  owner = ctx.owner,
  missing = false,
): Cond | null => {
  if (!ctx.archetypes || !ctx.d.archetype) return null
  let ids = ctx.archetypes(predicate)
  if (!ids) return null
  let key = ctx.d.archetype(owner)
  let sql = ids.length ? `${key} in (${ids.map(() => '?').join(', ')})` : '0'
  // A dereference that resolved to no entity has no components, so a test for
  // the absence of one succeeds. An ordinary owner — the row being selected, or
  // a child row — always exists.
  if (missing) sql = `(${key} is null or ${sql})`
  return raw({ sql, params: [...ids] })
}

// The two halves of the extension point. `claims` reports whether any
// registered extension handles a clause kind, so that a directive that would
// otherwise be refused is not; `extended` runs them in registration order, and
// the first non-null result wins.
let claims = (ctx: Ctx, kind: Clause['kind']): boolean =>
  ctx.ext.some((e) => e.compile[kind])

// `owner` names the row a contributed compiler is being asked about. It
// defaults to the selected row's integer id; a `.after` cursor passes the anchor
// row's id instead, so an extension that supplies an ORDER BY expression
// supplies the anchor's place in that order through the same hook — a ranking
// is a pure function of the owner, so paging into one needs no second API.
let site = (ctx: Ctx, owner = ctx.owner ?? ctx.d.ownerKey('entity')): Site => ({
  vocab: ctx.v,
  dialect: ctx.d,
  now: ctx.now,
  owner,
  join: (comp) => {
    ctx.tables.add(comp)
    return ctx.d.ownerKey(comp)
  },
})

let extended = (ctx: Ctx, c: Clause): Cond | null => {
  for (let e of ctx.ext) {
    let cond = e.compile[c.kind]?.(c, site(ctx))
    if (cond) return cond
  }
  return null
}

// A structured @yaks/query value flattened back into the single string the
// dialect's lowering re-parses — a list into `a,b`, a range into `lo..hi`
// (inclusive) or `lo...hi` (exclusive end). The dialect's `eq` splits it again
// exactly as the JavaScript matcher does, so the round trip through the string
// form loses nothing.
let flat = (val: Value | null): string => {
  if (val == null) return ''
  if (val.kind == 'scalar' || val.kind == 'time') return val.raw
  if (val.kind == 'list') return val.items.map(flat).join(',')
  let r = val as Range
  return `${flat(r.lo)}..${r.exclusiveEnd ? '.' : ''}${flat(r.hi)}`
}

// The operator name a lowering switches on: '' for equals (and, with an empty
// operand, for absence — the dialect's eq() handles both in one branch), '!'
// for not-equals, '~' for contains, the comparison operators unchanged,
// 'exists' for presence, and 'want' for a request to project a value rather
// than filter on one. This is the one place the @yaks/query operator set is
// translated.
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

// A qualified path names its component as much as its column: `.session.status`
// asks about sessions. Every read in this compiler returns NULL for an entity
// that does not have the component — that is what the LEFT JOIN means, and what
// the in-memory matcher reads off a bundle — and a derived read is the one that
// can forget this: `session.status` is computed from the session's entries, so
// an entity with none returned `empty`, and `.session.status=empty` selected
// every such entity in the graph (T-37730). The condition is written once,
// here, rather than copied into every registered expression. `present` is the
// SQL that holds when the entity has the component; `worn: false` marks the
// read that returns a value without it — `updated.at` falling back to
// `created.at`, because being created is the last time an untouched row
// changed.
let guarded = (dc: DerivedCol, present: string, expr: string): string =>
  dc.worn === false ? expr : `(case when ${present} then ${expr} end)`

// One column's read expression, and the type a value is coerced to before it is
// compared with it. The derived hook is consulted first (for a computed column
// or a read override), then the dialect's own lowering. `owner` is the SQL
// naming this entity's integer id — what a derived expression is built on, and
// also the component table's own owner column, so the component is present
// exactly when that column is non-null. Returns null, declining, for a computed
// column with no registered expression.
type Read = { expr: string; tag: Tag } | null
let readCol = (ctx: Ctx, comp: string, prop: string, owner: string): Read => {
  let key = `${comp}.${prop}`
  let dc = ctx.derived[key]
  if (dc) {
    for (let dep of dc.deps ?? []) ctx.tables.add(dep)
    return {
      expr: guarded(dc, `${owner} is not null`, dc.expr(owner)),
      tag: dc.tag,
    }
  }
  let col = ctx.v.column(comp, prop)
  if (col?.computed) return null // computed, no expression to read it
  let expr = ctx.d.col(comp, prop, ctx.v)
  if (expr == null) return null
  return {
    expr,
    tag: comp == 'entity' ? 'text' : prop == 'eid' ? 'eid' : tagOf(col!),
  }
}

// A scalar predicate over an already-resolved column expression, lowered branch
// by branch. Returns a fragment, or null when it cannot be expressed with
// exactly the semantics the JavaScript matcher has.
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

// The entity table's identity columns as one set lookup:
// `"entity"."eid" in (?, ?)`, with a second term for the numbers a `.num=` or a
// human-readable id named. An operand list that names nothing at all compiles
// to a constant false.
let inSet = (ctx: Ctx, set: Identity): Frag => {
  let arm = (prop: string, vals: Bind[]): Frag => ({
    sql: `${ctx.d.col('entity', prop, ctx.v)} in (${
      vals.map(() => '?').join(', ')
    })`,
    params: vals,
  })
  let arms = [
    ...set.eids.length ? [arm('eid', set.eids)] : [],
    ...set.nums.length ? [arm('num', set.nums)] : [],
  ]
  if (!arms.length) return { sql: '0', params: [] }
  return arms.length == 1 ? arms[0] : {
    sql: `(${arms.map((a) => a.sql).join(' or ')})`,
    params: arms.flatMap((a) => a.params),
  }
}

// A predicate one hop long: either a column of a component, or a presence test
// on the component itself (the leaf has no column name). `.task!` and `.task~=`
// test for presence; every other operator tests for absence.
let single = (ctx: Ctx, hop: Hop, p: Pred): Cond => {
  let op = opOf(p)
  if (op == 'want') return TRUE // a request to project the value, not a filter
  if (!hop.prop) {
    // An in-memory matcher can test for a component the vocabulary never
    // declared; SQL cannot, because it needs that component's table. Nothing
    // else can compile this either, so it is a refusal rather than a decline:
    // the component name is simply not in this vocabulary. The error is the
    // vocabulary's own — the same message `route()` produces, so the CLI, the
    // HTTP endpoint and the MCP server all report it identically.
    if (!ctx.v.comp(hop.comp)) throw new Unknown(hop.comp)
    let present = op == '~' || op == EXISTS
    let shape = hop.comp == 'entity' ? null : byArchetype(
      ctx,
      present ? { all: [hop.comp] } : { none: [hop.comp] },
    )
    if (shape) return shape
    ctx.tables.add(hop.comp)
    let eid = ctx.d.col(hop.comp, 'eid', ctx.v)!
    return raw({ sql: `${eid} is ${present ? 'not ' : ''}null`, params: [] })
  }
  // A reference column that several components share (`.client=<eid>` is a
  // column of `cursor`, of `camera` and of `fold`) routes with no owning
  // component (@yaks/vocab's route() returns comp ''), so there is no single
  // table to read it from. Equality is still one indexed lookup per owning
  // component, so it compiles the way `.refs=` does — a union over those
  // components' reference columns — rather than declining and falling back to a
  // scan of every row.
  if (!hop.comp) {
    let value = flat(p.value)
    if (op != '' || !value || value.includes(',') || value.includes('..')) {
      throw new Unsupported('a shared reference', `.${hop.prop} ${p.op}`)
    }
    return inRefs(
      ctx,
      ctx.v.refCols().filter(([, prop]) => prop == hop.prop),
      value,
    )
  }
  if (hop.comp != 'entity') ctx.tables.add(hop.comp)
  // On the entity table, `=` names entities instead of comparing a column.
  if (hop.comp == 'entity' && op == '') {
    let set = identity(hop.prop, flat(p.value))
    if (set) return raw(inSet(ctx, set))
  }
  let read = readCol(ctx, hop.comp, hop.prop, ctx.d.ownerKey(hop.comp))
  if (!read) {
    throw new Unsupported(
      'a computed column',
      `.${hop.comp}.${hop.prop} has no registered expression`,
    )
  }
  let value = flat(p.value)
  let col = ctx.v.column(hop.comp, hop.prop)
  if (
    op == '' && value && !value.includes('..') &&
    value.split(',').every(Boolean) && col?.category == 'ref' &&
    !col.computed &&
    !ctx.derived[`${hop.comp}.${hop.prop}`] && ctx.d.refCol
  ) {
    return raw(ctx.d.refEq(
      ctx.d.refCol(hop.comp, hop.prop),
      value.split(','),
      false,
    ))
  }
  let frag = lowerScalar(ctx, read.expr, op, flat(p.value), read.tag)
  if (!frag) {
    throw new Unsupported('this predicate', `.${hop.comp}.${hop.prop} ${p.op}`)
  }
  // A test that needs a value can only hold for an entity that has the
  // component — every read here is NULL without it, derived reads included
  // (`guarded`) — and stating that lets the query planner drive from the
  // component's table instead of scanning the entity table through a LEFT JOIN:
  // `.board.query~=<id>` read every entity (243 ms) where the boards are 22
  // rows (4 ms). path() applies the same narrowing. A test for absence (`=`
  // with an empty operand) or a not-equals must still see the rows without the
  // component. The one read left out is the one that returns a value for an
  // entity without it (`worn: false`): `updated.at` falls back to
  // `created.at`.
  let needsComp = hop.comp != 'entity' &&
    ctx.derived[`${hop.comp}.${hop.prop}`]?.worn !== false && (
      op == EXISTS || ['<', '<=', '>', '>='].includes(op) ||
      ((op == '' || op == '~') && flat(p.value) != '')
    )
  if (!needsComp) return raw(frag)
  let owner = ctx.d.col(hop.comp, 'eid', ctx.v)!
  return raw({
    sql: `(${owner} is not null and ${frag.sql})`,
    params: frag.params,
  })
}

// A path that dereferences references: a chain of one-to-one lookups through
// reference columns, ending in a leaf column tested against an operator and a
// value. Nested correlated scalar subqueries follow the chain without widening
// the set of candidate rows. Every hop but the last must be a reference column.
//
// The bare table a correlated subquery reads, asked of the dialect: a dialect
// that renames a component's table or reads it from somewhere else (the CTEs
// @yaks/sqlite overlays a pending transaction with) is followed here too, not
// only at the top-level joins. It must be the bare table expression with no
// alias of its own, because `as "__p1"` follows it.
let source = (ctx: Ctx, comp: string) => ctx.d.source?.(comp) ?? `"${comp}"`

// A reference column's stored integer column, asked of the dialect — which is
// what lets a dialect that renames its tables (the per-pattern prefix a rule
// uses, @yaks/sqlite's `prefixed`) reach the same column under the name it gave
// it.
let refKey = (ctx: Ctx, comp: string, prop: string): string =>
  ctx.d.refCol?.(comp, prop) ?? `"${comp}"."${prop}"`
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
  let target = refKey(ctx, root.comp, root.prop)
  for (let i = 1; i < hops.length - 1; i++) {
    let h = hops[i]
    if (!isRef(ctx.v, h.comp, h.prop)) {
      throw new Unsupported('a path', `.${h.comp}.${h.prop} is not a reference`)
    }
    target =
      `(select "__p${i}"."${h.prop}" from ${source(ctx, h.comp)} as "__p${i}"` +
      ` where "__p${i}"."entity" = ${target})`
  }
  let leaf = hops[hops.length - 1]
  // A leaf column that several components share belongs to no one component
  // (@yaks/vocab's route() returns comp '' — the leaf of
  // `.claim.session.actor`), so there is no table to read it from. Decline,
  // exactly as the same column name declines on a single hop, and let the
  // in-memory matcher, which can read every owner, evaluate it instead.
  // Lowered anyway, `source('')` wrote the table name as `""` and SQLite
  // rejected the whole statement with `no such table:` (S-37088).
  if (!leaf.comp) {
    throw new Unsupported('a shared reference leaf', `.${leaf.prop}`)
  }
  // A presence test on the leaf: does the entity the path reached have this
  // component?
  if (!leaf.prop) {
    let present = op == '~' || op == EXISTS
    let shape = leaf.comp == 'entity' ? null : byArchetype(
      ctx,
      present ? { all: [leaf.comp] } : { none: [leaf.comp] },
      target,
      !present,
    )
    if (shape) return shape
    let owner = leaf.comp == 'entity' ? `"__pl"."id"` : `"__pl"."entity"`
    let hit = `(select ${owner} from ${source(ctx, leaf.comp)} as "__pl"` +
      ` where ${owner} = ${target})`
    return raw({ sql: `${hit} is ${present ? 'not ' : ''}null`, params: [] })
  }
  // The leaf column, read from the entity the path reached. Derived reads
  // (status, updated.at) are built on `target` as their owner; a leaf that is
  // itself a reference column is projected to an eid; a plain column is a
  // correlated scalar read.
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
  // The narrowing a rooted path keeps: the row must have the component the path
  // starts from, which lets the query planner drive from that component's
  // table.
  let needsRoot = op == EXISTS || ['<', '<=', '>', '>='].includes(op) ||
    ((op == '' || op == '~') && flat(p.value) != '')
  return needsRoot
    ? raw({
      sql: `(${ctx.d.presence(root.comp).sql} and ${frag.sql})`,
      params: frag.params,
    })
    : raw(frag)
}

// A path leaf's read expression, correlated on the integer id the path
// reached.
let leafRead = (ctx: Ctx, leaf: Hop, target: string): Read => {
  let key = `${leaf.comp}.${leaf.prop}`
  let dc = ctx.derived[key]
  // The same condition, applied to the target: here the owner is another
  // entity's id, so having the component means a row of its own exists, not
  // that a joined column is non-null.
  if (dc) {
    let present = leaf.comp == 'entity' ? `${target} is not null` : `exists ` +
      `(select 1 from ${source(ctx, leaf.comp)} as "__pw"` +
      ` where "__pw"."entity" = ${target})`
    return { expr: guarded(dc, present, dc.expr(target)), tag: dc.tag }
  }
  let col = ctx.v.column(leaf.comp, leaf.prop)
  if (col?.computed) return null
  if (leaf.comp == 'entity') {
    return {
      expr: `(select "__pl"."${leaf.prop}" from ${
        source(ctx, 'entity')
      } as "__pl" where "__pl"."id" = ${target})`,
      tag: 'text',
    }
  }
  if (col?.category == 'ref') {
    return {
      expr: `(select "__pr"."eid" from ${source(ctx, leaf.comp)} as "__pl"` +
        ` join ${
          source(ctx, 'entity')
        } "__pr" on "__pr"."id" = "__pl"."${leaf.prop}"` +
        ` where "__pl"."entity" = ${target})`,
      tag: 'eid',
    }
  }
  return {
    expr:
      `(select "__pl"."${leaf.prop}" from ${source(ctx, leaf.comp)} as "__pl"` +
      ` where "__pl"."entity" = ${target})`,
    tag: col ? tagOf(col) : 'text',
  }
}

// `.kind=K`: the entity has the component K, and every kind that sorts before
// it is absent — the exact, index-searchable form of "K is the most specific
// kind present". A plural is accepted (`.kind=tasks` reads as `.kind=task`).
let kindScope = (ctx: Ctx, value: string): Cond => {
  let kinds = ctx.v.kinds
  let k = kinds.includes(value)
    ? value
    : value.endsWith('s') && kinds.includes(value.slice(0, -1))
    ? value.slice(0, -1)
    : null
  if (!k) throw new Unsupported('.kind', `${value} names no kind`)
  let i = kinds.indexOf(k)
  let shape = byArchetype(ctx, { all: [k], none: kinds.slice(0, i) })
  if (shape) return shape
  ctx.tables.add(k)
  let parts: Cond[] = [raw(ctx.d.presence(k))]
  for (let earlier of kinds.slice(0, i)) {
    ctx.tables.add(earlier)
    parts.push(raw({ sql: `"${earlier}"."entity" is null`, params: [] }))
  }
  return and(...parts)
}

// The backlink union across every reference column: the entities that point at
// `value`, taken as the union of every reference column equal to it. It follows
// directly from the vocabulary's list of reference columns. Only the positive
// `.refs=X` compiles; presence and absence decline.
//
// A union of every reference column in a wide vocabulary is a compound SELECT
// with more terms than workerd allows (./compound.ts), so the columns are
// grouped by table and cut into unions of {@link ARMS} terms — and the groups
// are combined with OR, because or has no such limit and each `in` starts its
// own compound SELECT. A vocabulary with no reference columns has no backlinks
// to find.
let refsUnion = (ctx: Ctx, r: Refs): Cond => {
  if (r.op != '=' || !r.value) {
    throw new Unsupported('.refs', 'only .refs=<id> compiles')
  }
  return inRefs(ctx, ctx.v.refCols(), r.value)
}

// The rows from which some reference column among `cols` points at `value`: one
// `in` per group of terms, each term a table's reference columns combined with
// OR, cut to what one compound SELECT may carry (compound.ts). An empty column
// list selects nothing.
let inRefs = (ctx: Ctx, cols: [string, string][], value: string): Cond => {
  if (!cols.length) return FALSE
  let at = `(select id from ${source(ctx, 'entity')} where eid = ?)`
  let sub = ([c, props]: Arm) =>
    `select ${ctx.d.ownerKey(c)} from ${ctx.d.table(c)} where ` +
    props.map((p) => `${refKey(ctx, c, p)} = ${at}`).join(' or ')
  return or(
    ...cut(arms(cols), ARMS).map((group) =>
      raw({
        sql: `${ctx.d.ownerKey('entity')} in (${
          group.map(sub).join(' union ')
        })`,
        params: group.flatMap(([, props]) => props.map(() => value)),
      })
    ),
  )
}

// An OR compiles to a UNION of selections, never to a disjunction in the WHERE
// clause. SQLite can use indexes for an OR only when every branch is on the
// from table; a branch on a left-joined component (`.settled.at>=…`) turns the
// whole disjunction into a scan of the joined rows (5,301 sessions, 8 ms for
// one strip of the app on the live graph, T-37445). Each alternative compiled
// on its own is one indexed selection of entity ids, and the outer statement
// then seeks those ids. The joins are the tables touched so far, which after
// the alternatives are compiled is every table they name; an extra LEFT JOIN on
// the entity key is an index lookup, never a scan.
//
// Cut to {@link ARMS} terms and combined with OR, the same way inRefs above is:
// workerd refuses a sixth term (./compound.ts), and a seven-way or in the app
// is what forced this shape. Each group is still one indexed `in`, so the cut
// costs nothing that the scan it replaced did not.
let union = (ctx: Ctx, alts: Clause[]): Cond => {
  let conds = alts.map((x) => clause(ctx, x))
  let joins = joinsOf(ctx)
  // Over the entity table alone (presence tests answered by the archetype
  // column, and columns of the entity table itself) a disjunction can already
  // use an index, and a tree of presence tests keeps its boolean shape.
  if (!joins.length) return or(...conds)
  let picks = conds.map((where) =>
    render(rel(ctx.d.spine, { cols: [ctx.d.ownerKey('entity')], joins, where }))
  )
  return or(
    ...cut(picks, ARMS).map((group) =>
      raw({
        sql: `${ctx.d.ownerKey('entity')} in (${
          group.map((a) => a.sql).join(' union ')
        })`,
        params: group.flatMap((a) => a.params),
      })
    ),
  )
}

// The left JOINs for the tables this bind touched, keyed on the row they hang
// off: the entity table for an ordinary query, or the child table inside a
// reverse hop's subquery (which is the from there, so it is never joined to
// itself).
let joinsOf = (ctx: Ctx, base = 'entity'): Join[] =>
  [...ctx.tables]
    .filter((t) => t != 'entity' && t != base)
    .map((t) => ({ source: ctx.d.table(t), on: ctx.d.joinOn(t, base) }))

// The operators a count test may use.
let COUNT_OPS: Record<string, string> = {
  '=': '=',
  '!=': '!=',
  '<': '<',
  '<=': '<=',
  '>': '>',
  '>=': '>=',
}

// A reverse hop: the entities that child rows point back at, named by the
// association @yaks/vocab derives (`.reviews` is the reviews whose `book` is
// this row). `.reviews!` tests presence, `.reviews=` absence, `.reviews>=5`
// counts, and `.reviews.stars=5` tests that a matching child exists.
//
// Each compiles to a correlated EXISTS (or count) over the child's reference
// column — one index search per candidate row, rather than a join that widens
// the result. A filter on the child runs through the same clause compiler over
// the child row, so anything that declines there declines the whole hop, and
// exactness holds across the correlation. A child predicate naming a column of
// the entity table declines outright: inside the subquery, `entity` is the
// correlation with the outer row, so compiling it there would silently ask a
// different question.
let reverse = (ctx: Ctx, name: string, a: Assoc, p: Pred): Cond => {
  if (ctx.owner) throw new Unsupported('a nested reverse association')
  let child = ctx.d.table(a.comp)
  let corr = `${refKey(ctx, a.comp, a.prop)} = ${ctx.d.ownerKey('entity')}`
  let rest = p.path.slice(1)
  let value = flat(p.value)
  if (!rest.length && !p.where) {
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
  if (
    rest.length && ctx.v.aim(rest.join('.')).some((h) => h.comp == 'entity')
  ) {
    throw new Unsupported(
      'a reverse hop through the spine',
      `.${name}.${rest.join('.')}`,
    )
  }
  let sub: Ctx = { ...ctx, tables: new Set(), owner: ctx.d.ownerKey(a.comp) }
  let inner = renderCond(
    clause(sub, p.where ?? { ...p, path: rest, not: undefined }),
  )
  return raw({
    sql:
      `${p.not ? 'not ' : ''}exists (select 1 from ${child}${
        joined(joinsOf(sub, a.comp))
      }` +
      ` where ${corr}${inner.sql == '1' ? '' : ` and ${inner.sql}`})`,
    params: inner.params,
  })
}

// The column walk: `.fork.from->S-7` follows one reference column of one
// component, so the step is that component's own rows read as (owner, referent)
// pairs. A path of several reference columns composes into one step — the hops
// joined to each other (`.fork.from.session` is `fork` joined to the `entry`
// its `from` names) — so `from` is the first component's owner and `to` is the
// last hop's referent, and one rung of the CTE crosses the whole chain. A path
// that names a relation was an extension's to claim first; a path with a hop
// that is not a reference column is refused, never answered with an empty
// result.
let walk = (ctx: Ctx, c: Walk): Cond => {
  let spelled = `.${c.path.join('.')}`
  let hops: Hop[] = []
  try {
    hops = ctx.v.aim(c.path.join('.'))
  } catch { /* a name this vocabulary does not have: refused below */ }
  let ref = (h: Hop) => h.prop && isRef(ctx.v, h.comp, h.prop)
  if (!hops.length || !hops.every(ref)) {
    throw new Unsupported(
      'a walk',
      `${spelled} is neither a relation nor a chain of reference columns`,
    )
  }
  let root = hops[0]
  let from = ctx.d.table(root.comp)
  let to = refKey(ctx, root.comp, root.prop)
  hops.slice(1).forEach((h, i) => {
    let a = `__w${i + 1}`
    from += ` join ${source(ctx, h.comp)} as "${a}" on "${a}"."entity" = ${to}`
    to = `"${a}"."${h.prop}"`
  })
  let step = `select ${ctx.d.ownerKey(root.comp)} as "from", ${to} as "to"` +
    ` from ${from}`
  return walkSql(ctx.d.ownerKey('entity'), c, step)
}

// A presence test the archetype column can answer, or null for every other
// clause. It reads a bare one-name predicate the same way `single()` does, so
// that folding several of them together and compiling them one at a time give
// the same result.
let facetOf = (
  ctx: Ctx,
  c: Clause,
): { comp: string; present: boolean } | null => {
  if (c.kind != 'pred' || c.path.length != 1) return null
  if (c.not || c.where || claims(ctx, 'pred')) return null
  let name = c.path[0]
  if (name == 'kind' || name == 'entity' || ctx.v.assoc(name)) return null
  let op = opOf(c)
  if (op == 'want') return null
  let hop: Hop
  try {
    hop = c.facet ? { comp: name, prop: '' } : ctx.v.aim(name, bare(c))[0]
  } catch {
    return null // a name that does not route: clause() owns the refusal
  }
  if (hop.prop || hop.comp == 'entity' || !ctx.v.comp(hop.comp)) return null
  return { comp: hop.comp, present: op == '~' || op == EXISTS }
}

// A conjunction of presence tests is one lookup on the archetype column.
// Compiled one clause at a time, what `.kind=memory` expands to — the kind
// present and every earlier kind absent — bound its own list of archetype ids
// per test: kinds × archetypes parameters, past both SQLite's limit on bound
// variables and V8's argument limit for a spread (`task list memory yaks`,
// T-37437). Compiled together it binds at most one id per archetype.
let conjuncts = (ctx: Ctx, cs: Clause[]): Cond[] => {
  let all: string[] = []
  let none: string[] = []
  let rest: Clause[] = []
  for (let c of cs) {
    let f = facetOf(ctx, c)
    if (!f) rest.push(c)
    else (f.present ? all : none).push(f.comp)
  }
  let shape = all.length + none.length > 1
    ? byArchetype(ctx, { all, none })
    : null
  if (!shape) return cs.map((x) => clause(ctx, x))
  return [shape, ...rest.map((x) => clause(ctx, x))]
}

// One filter clause compiled to a condition. Directives are removed before this
// runs.
let clause = (ctx: Ctx, c: Clause): Cond => {
  if (
    ctx.owner && (c.kind == 'refs' || c.kind == 'walk' ||
      c.kind == 'pred' && c.path[0] == 'kind')
  ) {
    throw new Unsupported('a reverse child clause through the spine')
  }
  let ext = extended(ctx, c)
  if (ext) return ext
  if (c.kind == 'never') return FALSE
  if (c.kind == 'and') return and(...conjuncts(ctx, c.clauses))
  if (c.kind == 'or') return union(ctx, (c as Or).clauses)
  if (c.kind == 'refs') return refsUnion(ctx, c)
  if (c.kind == 'walk') return walk(ctx, c)
  if (c.kind == 'pred') {
    if (c.path[0] == 'kind' && c.path.length == 1) {
      return kindScope(ctx, flat(c.value))
    }
    // A request to project a component this vocabulary does not declare is a
    // question, not an assertion: `.loan!` over an unknown component name must
    // be refused, because an empty result would state that there are none.
    // `.loan?` only asks for the component to be returned beside the filtered
    // rows — a database that has none returns none, and reports that by leaving
    // it off the row. That is what lets one query be sent to every database in
    // a fan-out (workers/yak/reach.ts) instead of writing one query per
    // database. Only the bare one-name form is forgiven; a path or a column
    // name still routes, and is still refused.
    let unplanted = opOf(c) == 'want' && c.path.length == 1 &&
      !ctx.v.all.includes(c.path[0])
    // A plural at the head of the path is a reverse association, read from the
    // far side; anything else routes forward through the vocabulary.
    let assoc = ctx.v.assoc(c.path[0])
    if (assoc) return reverse(ctx, c.path[0], assoc, c)
    if (c.not || c.where) throw new Unsupported('a reverse hop', c.path[0])
    let hops: Hop[]
    try {
      hops = c.facet
        ? [
          ...(c.path.length > 1
            ? ctx.v.aim(c.path.slice(0, -1).join('.'))
            : []),
          { comp: c.path.at(-1)!, prop: '' },
        ]
        : ctx.v.aim(c.path.join('.'), bare(c))
    } catch (e) {
      if (!unplanted) throw e
      return TRUE
    }
    if (ctx.owner && hops.some((h) => h.comp == 'entity')) {
      throw new Unsupported('a reverse hop through the spine')
    }
    return hops.length == 1 ? single(ctx, hops[0], c) : path(ctx, hops, c)
  }
  throw new Unsupported(`the ${(c as Clause).kind} directive`)
}

// The directives, read off the top-level clause list. order/limit/after modify
// an ordinary query; count/distinct/tally change what it selects; fields and
// `*` add projected columns; near/edges are refused unless an extension claims
// them, in which case they filter like any other clause.
let UNREACHED = new Set(['near', 'edges'])
let DIRECTIVES = new Set([
  'order',
  'near',
  'count',
  'distinct',
  'tally',
  'fields',
  'every',
  'limit',
  'after',
  'edges',
])
let find = <T extends Clause>(cs: Clause[], kind: string): T | undefined =>
  cs.find((c) => c.kind == kind) as T | undefined

// The rest of the query, as a statement selecting the eids it admits — what an
// extension that ranks is given (./extend.ts `Screen`). This extension's own
// clauses are left out, because they are what is being resolved; the directives
// are left out, because a window or an ordering shapes an answer rather than
// narrowing it. What is left is every filter and every other package's clause,
// compiled through the same extensions.
//
// Those extensions are passed on without their `begin` hook: this statement is
// a query inside a query, and telling an extension that a new one had begun
// would wipe out what it remembered about the outer one — and have it ask for a
// screen of a screen.
let screen = (
  ast: And,
  vocab: Vocab,
  opts: BindOpts,
  e: Extension,
): Frag | null => {
  let mine = new Set(Object.keys(e.compile))
  let rest = ast.clauses.filter((c) =>
    !mine.has(c.kind) && !DIRECTIVES.has(c.kind)
  )
  if (!rest.length) return null
  let quiet = (opts.extend ?? []).map(({ begin: _begin, ...rest }) => rest)
  return render(
    bind({ ...ast, clauses: rest }, vocab, { ...opts, extend: quiet }),
  )
}

// A path resolved for a directive's value (order, fields): its column
// expression.
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

// AST to relational representation. This is the one function `compile`
// renders.
export let bind = (ast: And, vocab: Vocab, opts: BindOpts = {}): Rel => {
  let ctx: Ctx = {
    v: vocab,
    d: opts.dialect ?? sqlite,
    derived: opts.derived ?? {},
    ext: opts.extend ?? [],
    now: opts.now ?? Date.now(),
    tables: new Set(),
    archetypes: opts.archetypes,
  }
  // A new query, and what the rest of it selects. An extension that remembers
  // what it resolved for one query is told here, before any clause compiles, so
  // that what a long-lived extension remembers is always this query's; one that
  // ranks asks for the screen and ranks among the rows the other clauses admit
  // (./extend.ts `Begin`, `Screen`).
  for (let e of ctx.ext) e.begin?.(() => screen(ast, vocab, opts, e))
  let cs = ast.clauses
  for (let c of cs) {
    if (UNREACHED.has(c.kind) && !claims(ctx, c.kind)) {
      throw new Unsupported(`.${c.kind}`)
    }
  }
  let filters = cs.filter((c) => !DIRECTIVES.has(c.kind) || claims(ctx, c.kind))
  let where = and(...conjuncts(ctx, filters), raw(ctx.d.live()))

  let count = find<Count>(cs, 'count')
  let distinct = find<Distinct>(cs, 'distinct')
  let tally = find<Tally>(cs, 'tally')

  // `.count!`: how many entities the filter selects, returned under an empty
  // key so that every aggregate comes back in the same value-and-count shape.
  if (count) {
    return rel(ctx.d.spine, {
      cols: [`'' as value`, 'count(*) as n'],
      joins: joinsOf(ctx),
      where,
    })
  }
  // `.distinct`/`.tally`: the non-empty values of a column (only a text, enum
  // or eid column — casting a numeric or time column would disagree with the
  // JavaScript matcher), or a count per value. Empty values are dropped.
  if (distinct || tally) {
    let agg = (distinct ?? tally)!
    let { expr } = resolveField(ctx, agg.path.join('.'))
    // decline a numeric, time or derived column: only text, enum and eid
    // columns tally exactly
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

  // An ordinary query, with projected columns if `.fields` asked for any.
  let fields = find<Fields>(cs, 'fields')
  let cols = [ctx.d.membership]
  if (fields) {
    for (let f of fields.fields) {
      let { expr } = resolveField(ctx, f.path.join('.'))
      cols.push(`${expr} as "${f.path.join('.')}"`)
    }
  }
  // Ordering, then the window within it. `.order=-field` is descending, and an
  // explicit order survives a `.limit`/`.after` window: a window states how much
  // of a sequence to return, never which sequence — so a page of
  // `.order=price&.limit=5` is the five cheapest, not the five newest. With no
  // `.order` the sequence is newest first by entity num, as it has always been.
  // @yaks/match applies a window the same way (its parity_test pins the two
  // together). The ordered column is resolved before the joins are read off:
  // ordering by a column no filter mentions is what pulls its table in, and a
  // join list taken any earlier would not have it.
  let order = find<Order>(cs, 'order')
  let sort = order ? sortOf(ctx, order.value) : null
  let limit = find<Limit>(cs, 'limit')
  let after = find<After>(cs, 'after')
  let out = rel(ctx.d.spine, {
    cols,
    joins: joinsOf(ctx),
    where: after ? and(where, raw(keyset(ctx, sort, after.n))) : where,
  })
  if (sort) out.order.push(`${sort.row}${sort.desc ? ' desc' : ''}`)
  // A window is newest first, which is what makes taking a prefix meaningful
  // and lets a `.after` cursor continue it. A complete result is oldest first:
  // it is not a page of anything, and the order the rows were written in is the
  // one sequence a caller can predict — a list reads down in the order it was
  // made. Either way the order is stated, never left to the query planner: two
  // engines, or one engine with a different index, must not return a bare
  // `.doc!` in two different orders.
  out.order.push(`"entity"."num"${sort || limit || after ? ' desc' : ''}`)
  if (limit) out.limit = limit.n
  return out
}

// One `.order=` value, read two ways: over the selected row (through the joins
// the binder already made) and over the `.after` anchor row (a correlated read
// on its owner id). Both come from one place, so a cursor can never page down a
// different sequence from the one being ordered.
//
// A leading '-' means descending; the rest is offered to the extensions first —
// a ranking (`.order=similar`) names no column, so only the package holding the
// ranks can express it — and routes to a column when no extension claims it.
// (An in-memory matcher would sort these in JavaScript; compiling them into the
// statement is what this representation adds.)
type Sort = { row: string; at: (owner: string) => string; desc: boolean }
let sortOf = (ctx: Ctx, value: string): Sort => {
  let desc = value.startsWith('-')
  let field = desc ? value.slice(1) : value
  let rank = ranked(ctx, field)
  if (rank) return { row: rank, at: (o) => ranked(ctx, field, o)!, desc }
  let row = resolveField(ctx, field).expr
  let hop = ctx.v.aim(field)[0]
  return {
    row,
    at: (o) => {
      let read = leafRead(ctx, hop, o)
      if (!read) throw new Unsupported('a computed column here', field)
      return read.expr
    },
    desc,
  }
}

let ranked = (ctx: Ctx, field: string, owner?: string): string | null => {
  for (let e of ctx.ext) {
    let expr = e.order?.(field, site(ctx, owner))
    if (expr) return expr
  }
  return null
}

// The `.after` anchor as an owner id. The cursor names an entity by its entity
// num — written the same way however the results are ordered, so a client pages
// without ever learning the order key — and the num is a whole number the
// grammar has already validated, written into the SQL directly because an order
// expression carries no bound parameters (Site.owner is a string, and the order
// by in this representation holds none).
let anchor = (ctx: Ctx, n: number) =>
  `(select "__cur"."id" from ${ctx.d.spine} as "__cur" where "__cur"."num" = ${n})`

// `.after` as a keyset condition over the effective order: the rows strictly
// past the anchor's own place in it, with the entity num breaking ties
// (descending, so that an unordered window still reads newest first). Absent
// values sort first when ascending — SQLite puts NULLs first, and @yaks/match
// does the same — and comparing anything to NULL yields NULL rather than a
// boolean, so each null case is written out.
//
// The fallbacks follow from the keyset rather than being special cases: an
// anchor that no longer matches the query still has an order value to page
// from, one with no value pages by its num alone (the tie branch), and one that
// names no entity leaves the condition true, which is the first page.
let keyset = (ctx: Ctx, sort: Sort | null, n: number): Frag => {
  let tie = { sql: `"entity"."num" < ?`, params: [n] as Bind[] }
  if (!sort) return tie
  let a = sort.at(anchor(ctx, n))
  let v = sort.row
  let past = sort.desc
    ? `(${v} is null and ${a} is not null) or ${v} < ${a}`
    : `(${a} is null and ${v} is not null) or ${v} > ${a}`
  return {
    sql:
      `(not exists (select 1 from ${ctx.d.spine} as "__cur" where "__cur"."num" = ${n})` +
      ` or ${past} or (${v} is ${a} and ${tie.sql}))`,
    params: tie.params,
  }
}
