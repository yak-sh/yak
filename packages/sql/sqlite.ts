// The SQLite dialect: the one place that knows how the fleet graph is LAID OUT
// in SQLite and how a value LOWERS to a comparison there. Everything above it
// (the binder, the IR) speaks logical (comp, prop) and an algebraic condition
// tree; this module turns those into the table names, join keys and column
// expressions the store actually has, and into the `cast`/`instr`/`between`
// comparisons whose semantics match the JS matcher exactly.
//
// A second backend (D1 is byte-for-byte this; a Postgres port is not) is
// another object of this shape. The IR does not change — only these lowerings.
//
// The layout, in one paragraph: every component is a TABLE named for it, keyed
// by an integer `entity` owner column that points at the spine `entity(id)`;
// `doc` is read through the `doc_value` view; a reference column stores the
// referent's integer id, so reading it back as an eid is a correlated spine
// lookup, and comparing an eid to it is an integer compare after one spine
// lookup of the operand. A tombstoned entity keeps its spine row (its int id
// can never recycle) but is DEAD, so every membership excludes the graves.

import type { Column, Vocab } from '@yaks/vocab'
import { type Span as QSpan, timeSpan } from '@yaks/query'
import type { Frag } from './ir.ts'

// The tag a value coerces against — the vocab column category flattened to the
// word the lowering switches on, mirroring the fleet's tagOf().
export type Tag =
  | 'text'
  | 'body'
  | 'number'
  | 'priority'
  | 'bool'
  | 'query'
  | 'time'
  | 'url'
  | 'enum'
  | 'eid'
export let tagOf = (c: Column): Tag =>
  c.category == 'ref' ? 'eid' : c.category == 'enum' ? 'enum' : c.scalar!

// What the binder asks a dialect for. Everything is a pure function of the
// logical schema; nothing reads a global.
export type Dialect = {
  name: string
  // A membership statement selects the spine and answers with one `eid` column.
  spine: string
  membership: string
  // The tombstone guard every membership ANDs in.
  live: () => Frag
  // The join source for a component (doc → its view) and the ON key.
  table: (comp: string) => string
  ownerKey: (base: string) => string
  joinOn: (comp: string, base: string) => string
  // A column read expression. Refs project to an eid; `eid` reads the owner key;
  // `entity` reads the spine directly. `null` if the column is not in the schema.
  col: (comp: string, prop: string, v: Vocab) => string | null
  presence: (comp: string) => Frag
  // Value lowerings. Each returns a Frag or null when it cannot be expressed
  // with the matcher's exact semantics (the caller then declines the whole
  // compile — exactness or nothing).
  eq: (colExpr: string, value: string, tag: Tag) => Frag | null
  ne: (colExpr: string, value: string, tag: Tag) => Frag | null
  cmp: (colExpr: string, op: string, value: string, tag: Tag) => Frag | null
  contains: (colExpr: string, value: string) => Frag | null
  time: (colExpr: string, op: string, value: string, now: number) => Frag | null
  refEq: (colExpr: string, eids: string[], negate: boolean) => Frag
  refPresent: (colExpr: string, negate: boolean) => Frag
  text: (value: string) => Frag
}

let q = (name: string) => `"${name}"`

let table = (comp: string): string =>
  comp == 'doc' ? '"doc_value" as "doc"' : q(comp)

let ownerKey = (base: string): string =>
  base == 'entity' ? '"entity"."id"' : `"${base}"."entity"`

// A column read, quoted. `eid` of a component is its integer owner column; a
// reference column is an int id projected to the referent's eid through a
// correlated spine lookup so every predicate compares eids to eids.
let col = (comp: string, prop: string, v: Vocab): string | null => {
  if (comp == 'entity') return `"entity"."${prop}"`
  if (prop == 'eid') return `"${comp}"."entity"`
  let c = v.column(comp, prop)
  if (!c) return null
  return c.category == 'ref'
    ? `(select __re.eid from entity __re where __re.id = "${comp}"."${prop}")`
    : `"${comp}"."${prop}"`
}

let asText = (c: string) => `cast(${c} as text)`
let numeric = (s: string) => /^-?\d+(\.\d+)?$/.test(s)
let NUMERIC_TAGS: Tag[] = ['number', 'priority', 'bool']

// A time column holds one spelling (an ISO stamp), over which lexical order is
// chronological. Bounding a comparison to the band a canonical stamp lives in
// excludes stored non-stamps the JS matcher's Date.parse would drop as NaN.
let LO = '0000-01-01T00:00:00.000Z'
let HI = '9999-12-31T23:59:59.999Z'
let stampish = (c: string, s: Frag): Frag => ({
  sql: `(${c} between ? and ? and ${s.sql})`,
  params: [LO, HI, ...s.params],
})

// Numeric comparison only where the whole column agrees: a numeric column
// against a numeric operand. Anything else is refused rather than guessed.
let cmp = (
  c: string,
  op: string,
  value: string,
  tag: Tag,
): Frag | null => {
  if (NUMERIC_TAGS.includes(tag)) {
    return numeric(value)
      ? { sql: `${c} ${op} ?`, params: [Number(value)] }
      : null
  }
  if (tag == 'time') {
    return stampish(c, { sql: `${c} ${op} ?`, params: [value] })
  }
  return numeric(value)
    ? null
    : { sql: `${asText(c)} ${op} ?`, params: [value] }
}

// eq: '' is absent-or-empty; 'x..y' / 'x...y' a range; 'a,b' any-of; else a
// match. On a numeric column the operand must survive a round trip through JS
// number formatting, or the honest compilation is a constant false.
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
    if (parts.some((p) => !p)) return null
    return {
      sql: `(${parts.map((p) => p!.sql).join(' or ')})`,
      params: parts.flatMap((p) => p!.params),
    }
  }
  if (NUMERIC_TAGS.includes(tag)) {
    return numeric(value) && String(Number(value)) === value
      ? { sql: `${c} = ?`, params: [Number(value)] }
      : { sql: '0', params: [] }
  }
  return { sql: `${asText(c)} = ?`, params: [value] }
}

// != is `not eq`, and eq(null, …) is FALSE — but SQL's `not (null = ?)` is
// NULL, which drops the rows whose component is absent. coalesce restores them.
let ne = (c: string, value: string, tag: Tag): Frag | null => {
  let inner = eq(c, value, tag)
  return inner &&
    { sql: `(coalesce(${inner.sql}, 0) = 0)`, params: inner.params }
}

// ~= is String(v).toLowerCase().includes(needle). instr() so a wildcard needs
// no escaping; coalesce so a missing column reads as ''. A non-ASCII needle
// declines — SQLite's lower() is ASCII-only while JS's is Unicode, so the two
// case foldings are not the same one and an almost-right answer is refused.
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

// ---- time spans (a phrase names a range; the op picks its edge) ----
// The band, and the edges, ported from the fleet compiler: a span whose end is
// its start is an INSTANT, where the `= start` arm carries the whole answer.
type Span = { start: number; end: number }
// The span recognizer is @yaks/query's, narrowed to the {start,end} this file
// reads; the binder passes `now` so a phrase is placed at one fixed moment.
let spanFn = (s: string, now: number): Span | null => {
  let sp: QSpan | null = timeSpan(s, now)
  return sp ? { start: sp.start, end: sp.end } : null
}
// The safe FTS MATCH spelling: user text is a quoted phrase, never operator
// syntax; only a trailing `*` prefix-matches the final token. Reproduced from
// the fleet's ftsTerm so the package needs no src import.
let ftsTerm = (value: string): string => {
  let prefix = /\*+$/.test(value)
  let phrase = value.replace(/\*+$/, '').replaceAll('"', '').trim()
  return phrase ? `"${phrase}"${prefix ? '*' : ''}` : ''
}
let iso = (ms: number) => new Date(ms).toISOString()
let bound = (c: string, op: string, ms: number): Frag => ({
  sql: `${c} ${op} ?`,
  params: [iso(ms)],
})
let both = (a: Frag, b: Frag): Frag => ({
  sql: `(${a.sql} and ${b.sql})`,
  params: [...a.params, ...b.params],
})
let anyOf = (parts: Frag[]): Frag =>
  parts.length == 1 ? parts[0] : {
    sql: `(${parts.map((p) => p.sql).join(' or ')})`,
    params: parts.flatMap((p) => p.params),
  }
let edge = (c: string, op: string, s: Span): Frag => {
  let point = s.end <= s.start
  return op == '<'
    ? bound(c, '<', s.start)
    : op == '<='
    ? point ? bound(c, '<=', s.start) : bound(c, '<', s.end)
    : op == '>'
    ? point ? bound(c, '>', s.start) : bound(c, '>=', s.end)
    : op == '>='
    ? bound(c, '>=', s.start)
    : point
    ? bound(c, '=', s.start)
    : both(bound(c, '>=', s.start), bound(c, '<', s.end))
}

export let sqlite: Dialect = {
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
  eq,
  ne,
  cmp,
  contains,
  time: (c, op, value, now) => {
    // Mirrors the fleet's timeSql branch for branch. A comma list of phrases is
    // any-of under `=` (none-of under `!`); anything else re-reads the whole
    // value as one phrase; a value that is no phrase declines (the scalar road
    // takes it). `op` is the fleet spelling: '' equals, '!' not-equals, else a
    // comparison. The span recognizer is @yaks/query's, placed at `now`.
    let phrase = (s: string): Span | null => spanFn(s, now)
    let spans = value.split(',').map(phrase)
    if (spans.every((s) => s) && (op == '' || op == '!')) {
      let hit = stampish(c, anyOf(spans.map((s) => edge(c, '', s!))))
      return op == ''
        ? hit
        : { sql: `(coalesce(${hit.sql}, 0) = 0)`, params: hit.params }
    }
    let s = phrase(value)
    return s ? stampish(c, edge(c, op, s)) : null
  },
  refEq: (c, eids, negate) => {
    let hit = `(${
      eids.map(() => `${c} = (select id from entity where eid = ?)`).join(
        ' or ',
      )
    })`
    return negate
      ? { sql: `(${c} is null or not ${hit})`, params: eids }
      : { sql: hit, params: eids }
  },
  refPresent: (c, negate) => ({
    sql: `${c} is ${negate ? '' : 'not '}null`,
    params: [],
  }),
  text: (value) => {
    let term = ftsTerm(value)
    return term
      ? {
        sql:
          `"doc"."rowid" in (select rowid from doc_fts where doc_fts match ?)`,
        params: [term],
      }
      : { sql: '0', params: [] }
  },
}
