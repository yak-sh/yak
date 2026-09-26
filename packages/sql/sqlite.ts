// The SQLite dialect: the one place that knows how the data is laid out in
// SQLite, and how a value lowers to a comparison there. Everything above it
// (the binder, the relational representation) works in terms of a component and
// a property plus a condition tree; this module turns those into the table
// names, join keys and column expressions the database actually has, and into
// the `cast`/`instr`/`between` comparisons whose semantics match the JavaScript
// matcher exactly.
//
// A second backend (D1 is byte for byte this one; a Postgres port would not be)
// is another object of this shape. The representation does not change — only
// these lowerings.
//
// The layout, in one paragraph: every component has a table named for it, keyed
// by an integer `entity` column pointing at `entity(id)`. A reference column
// stores the referent's integer id, so reading it back as an eid is a
// correlated lookup in the entity table, and comparing an eid to it is an
// integer comparison after one lookup of the operand. A deleted entity keeps
// its row in the entity table — its eid, number and integer id, which a write
// that brings it back keeps — and is listed in the `tombstone` table, so every
// query excludes it.

import type { Prop, Scalar, Vocab } from '@yaks/vocab'
import { timeEdges } from '@yaks/query'
import type { Frag } from './ast.ts'
import { nest } from './render.ts'

// The type a value is coerced to before comparison — the vocabulary's property
// category flattened to the one name the lowerings switch on.
export type Tag = Scalar | 'enum' | 'eid'
export let tagOf = (c: Prop): Tag =>
  c.category == 'ref' ? 'eid' : c.category == 'enum' ? 'enum' : c.scalar!

// What the binder asks a dialect for. Everything is a pure function of the
// schema; nothing here reads global state.
export type Dialect = {
  name: string
  // A query selects from the entity table and returns one `eid` column.
  spine: string
  membership: string
  // The condition excluding deleted entities, ANDed into every query.
  live: () => Frag
  // The join source for a component and the on key.
  table: (comp: string) => string
  // The bare table expression for a component, with no alias — what a
  // correlated subquery refers to. A dialect that reads a component from
  // somewhere else (the CTEs @yaks/sqlite overlays a pending transaction with)
  // declares that here, and every subquery in the binder follows it.
  source?: (comp: string) => string
  ownerKey: (base: string) => string
  joinOn: (comp: string, base: string) => string
  // A column read expression. A reference column is projected to an eid; `eid`
  // reads the owner column; a column of `entity` is read from the entity table
  // directly. `null` if the schema has no such property.
  col: (comp: string, prop: string, v: Vocab) => string | null
  // The stored reference column, before it is projected to an eid. An equality
  // test can look the operand up once and then compare this indexed integer
  // column.
  refCol?: (comp: string, prop: string) => string
  presence: (comp: string) => Frag
  // The owner's archetype column; omitted by layouts that have no archetypes.
  // Passing an owner explicitly means a correlated child or dereference target
  // rather than the row being selected.
  archetype?: (owner?: string) => string
  // Value lowerings. Each returns a fragment, or null when it cannot be
  // expressed with exactly the semantics the JavaScript matcher has (the caller
  // then declines the whole compilation — exact or nothing).
  eq: (colExpr: string, value: string, tag: Tag) => Frag | null
  ne: (colExpr: string, value: string, tag: Tag) => Frag | null
  cmp: (colExpr: string, op: string, value: string, tag: Tag) => Frag | null
  contains: (colExpr: string, value: string) => Frag | null
  time: (colExpr: string, op: string, value: string, now: number) => Frag | null
  refEq: (colExpr: string, eids: string[], negate: boolean) => Frag
  refPresent: (colExpr: string, negate: boolean) => Frag
  // Membership in a list of any length. A host caps the parameters one
  // statement binds (a Durable Object's SQLite takes 100), and a list of eids
  // is as long as its caller made it, so the list is one parameter.
  among: (colExpr: string, vals: (string | number)[]) => Frag
}

let q = (name: string) => `"${name}"`

let table = (comp: string): string => q(comp)

let ownerKey = (base: string): string =>
  base == 'entity' ? '"entity"."id"' : `"${base}"."entity"`

// A column read, quoted. The `eid` of a component is its integer owner column;
// a reference column holds an integer id, projected to the referent's eid
// through a correlated lookup in the entity table, so that every predicate
// compares eids with eids.
let col = (comp: string, prop: string, v: Vocab): string | null => {
  if (comp == 'entity' && v.prop(comp, prop)?.category != 'ref') {
    return `"entity"."${prop}"`
  }
  if (prop == 'eid') return `"${comp}"."entity"`
  let c = v.prop(comp, prop)
  if (!c) return null
  return c.category == 'ref'
    ? `(select __re.eid from entity __re where __re.id = "${comp}"."${prop}")`
    : `"${comp}"."${prop}"`
}

/**
 * Reference equality, reading the entity table from `from`. A reference column
 * stores an integer id, so comparing it to an eid means looking that eid up —
 * and where the entity table is read from is the dialect's business, not this
 * lowering's: @yaks/sqlite's `prefixed` passes the CTE that overlays a pending
 * transaction, so the comparison also finds entities that transaction has not
 * committed yet.
 *
 * A list is one parameter however long it is, for the reason {@link
 * Dialect.among} gives: the reverse read behind a delete names every entity it
 * deleted (T-38059).
 */
export let refEqAt = (from: string): Dialect['refEq'] => (c, eids, negate) => {
  let hit = eids.length == 1
    ? { sql: `${c} = (select id from ${from} where eid = ?)`, params: eids }
    : {
      sql: `${c} in (select id from ${from} where eid in ` +
        `(select value from json_each(?)))`,
      params: [JSON.stringify(eids)],
    }
  return negate
    ? { sql: `(${c} is null or not ${hit.sql})`, params: hit.params }
    : hit
}

let asText = (c: string) => `cast(${c} as text)`
let numeric = (s: string) => /^-?\d+(\.\d+)?$/.test(s)
let NUMERIC_TAGS: Tag[] = ['number', 'priority', 'bool']

/** An operand as a property of type `tag` holds it: a boolean is stored as 0
 * or 1, and `true` and `false` name those. Any other operand is as written. */
export let held = (value: string, tag: Tag): string =>
  tag != 'bool' ? value : value == 'true' ? '1' : value == 'false' ? '0' : value

// A time column holds one format (an ISO timestamp), for which lexical order is
// chronological. Restricting a comparison to the range a canonical timestamp
// falls in excludes stored values that are not timestamps, which the JavaScript
// matcher's Date.parse would drop as NaN. The unary `+` keeps that guard from
// the index: SQLite seeks by one bound on each side, and the guard's would
// displace the comparison's own, walking every stamp in the column.
let LO = '0000-01-01T00:00:00.000Z'
let HI = '9999-12-31T23:59:59.999Z'
let stampish = (c: string, s: Frag): Frag => ({
  sql: `(+${c} between ? and ? and ${s.sql})`,
  params: [LO, HI, ...s.params],
})

// Any of several predicates. Equalities of one expression are one `in`, which
// reads the expression once where `or` reads it once per value; a derived
// property's expression is a whole subquery.
let anyOf = (parts: Frag[]): Frag => {
  let lhs = parts[0].sql.match(/^(.*) = \?$/s)?.[1]
  let params = parts.flatMap((p) => p.params)
  return parts.length == 1
    ? parts[0]
    : lhs && parts.every((p) => p.sql == parts[0].sql)
    ? { sql: `(${lhs} in (${params.map(() => '?').join(', ')}))`, params }
    : { sql: nest(parts.map((p) => p.sql), ' or '), params }
}

// A numeric comparison only where both sides are numeric: a numeric column
// against a numeric operand. Anything else is refused rather than guessed at.
let cmp = (
  c: string,
  op: string,
  value: string,
  tag: Tag,
): Frag | null => {
  if (NUMERIC_TAGS.includes(tag)) {
    let n = held(value, tag)
    return numeric(n) ? { sql: `${c} ${op} ?`, params: [Number(n)] } : null
  }
  if (tag == 'time') {
    return stampish(c, { sql: `${c} ${op} ?`, params: [value] })
  }
  return numeric(value)
    ? null
    : { sql: `${asText(c)} ${op} ?`, params: [value] }
}

// eq: '' means absent or empty; 'x..y' / 'x...y' is a range; 'a,b' is any-of;
// anything else is an equality test. On a numeric column the operand must
// survive a round trip through JavaScript number formatting, or the only
// correct compilation is a constant false.
let eq = (c: string, value: string, tag: Tag): Frag | null => {
  if (value == '') {
    return { sql: `(${c} is null or ${asText(c)} = '')`, params: [] }
  }
  let r = value.match(/^(.*?)\.\.(\.?)(.*)$/s)
  if (r) {
    let [, lo, excl, hi] = r
    let bound = cmp(c, '>=', lo, tag)
    let upper = cmp(c, excl ? '<' : '<=', hi, tag)
    if (!bound || !upper) return null
    return {
      sql: `(${c} is not null and ${bound.sql} and ${upper.sql})`,
      params: [...bound.params, ...upper.params],
    }
  }
  if (value.includes(',')) {
    let parts = value.split(',').map((p) => eq(c, p, tag))
    let frags = parts.filter((p) => p != null)
    return frags.length == parts.length ? anyOf(frags) : null
  }
  if (NUMERIC_TAGS.includes(tag)) {
    let n = held(value, tag)
    return numeric(n) && String(Number(n)) === n
      ? { sql: `${c} = ?`, params: [Number(n)] }
      : { sql: '0', params: [] }
  }
  return { sql: `${asText(c)} = ?`, params: [value] }
}

// != is `not eq`, and eq(null, …) is false — but SQL's `not (null = ?)` is
// NULL, which drops the rows whose component is absent. coalesce brings them
// back.
let ne = (c: string, value: string, tag: Tag): Frag | null => {
  let inner = eq(c, value, tag)
  return inner &&
    { sql: `(coalesce(${inner.sql}, 0) = 0)`, params: inner.params }
}

// ~= is String(v).toLowerCase().includes(needle). instr() is used so that a
// wildcard character needs no escaping, and coalesce so that a missing column
// reads as ''. A non-ASCII search string declines — SQLite's lower() is
// ASCII-only while JavaScript's is Unicode, so the two case foldings are not
// the same, and an almost-right answer is refused.
let ascii = (s: string) => [...s].every((ch) => ch.charCodeAt(0) < 128)
let contains = (c: string, value: string): Frag | null =>
  !ascii(value)
    ? null
    : value == ''
    ? { sql: `${c} is not null`, params: [] }
    : {
      sql: `instr(lower(coalesce(${asText(c)}, '')), lower(?)) > 0`,
      params: [value],
    }

// ---- time phrases (@yaks/query resolves the edges; this lowers them) ----
let iso = (ms: number) => new Date(ms).toISOString()
let all = (parts: Frag[]): Frag =>
  parts.length == 1 ? parts[0] : {
    sql: nest(parts.map((p) => p.sql), ' and '),
    params: parts.flatMap((p) => p.params),
  }

export let sqlite: Dialect = {
  refCol: (comp, prop) => `${q(comp)}.${q(prop)}`,
  among: (c, vals) => ({
    sql: `${c} in (select value from json_each(?))`,
    params: [JSON.stringify(vals)],
  }),
  name: 'sqlite',
  spine: '"entity"',
  membership: '"entity"."eid" as eid',
  live: () => ({
    sql:
      `not exists (select 1 from tombstone "t" where "t"."entity" = "entity"."id")`,
    params: [],
  }),
  table,
  ownerKey,
  joinOn: (comp, base) => `"${comp}"."entity" = ${ownerKey(base)}`,
  col,
  presence: (comp) => ({ sql: `"${comp}"."entity" is not null`, params: [] }),
  archetype: (owner) =>
    owner == null
      ? '"entity"."archetype"'
      : `(select "__a"."archetype" from entity "__a" where "__a".id = ${owner})`,
  eq,
  ne,
  cmp,
  contains,
  time: (c, op, value, now) => {
    // `op` is '' for equals, '!' for not-equals (none of what equals selects),
    // otherwise a comparison. What each asks of a stamp is @yaks/query's
    // `timeEdges`, resolved against `now`; an operand that is not made of
    // phrases declines, and the ordinary scalar path handles it.
    let arms = timeEdges(op == '' || op == '!' ? '=' : op, value, now)
    if (!arms) return null
    let hit = stampish(
      c,
      anyOf(
        arms.map((a) =>
          all(a.map(([o, ms]) => ({ sql: `${c} ${o} ?`, params: [iso(ms)] })))
        ),
      ),
    )
    return op == '!'
      ? { sql: `(coalesce(${hit.sql}, 0) = 0)`, params: hit.params }
      : hit
  },
  refEq: refEqAt('"entity"'),
  refPresent: (c, negate) => ({
    sql: `${c} is ${negate ? '' : 'not '}null`,
    params: [],
  }),
}
