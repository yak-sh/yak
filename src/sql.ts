// The filter grammar compiled to SQL (T-12042). A `Pred[]` becomes one
// statement over the component tables, so a query is answered by the index
// instead of by building the whole graph and filtering it in JS.
//
// Why it exists: `evalQuery` costs ~330ms on the live board — 190ms building a
// 22 MB snapshot, 130ms matching 10,618 rows — and it is synchronous, so every
// subscribe stalls the whole server for that long. The same question answered
// through the index takes 0.8ms.
//
// The contract is EXACTNESS OR NOTHING. `where()` returns null the moment it
// meets a predicate it cannot express with the same semantics query.ts gives
// it, and the caller falls back to the JS matcher. A compiler that answers
// *almost* the same question is worse than one that declines: the JS path is
// the definition, and `sql_test.ts` holds the two answers against each other
// over every predicate class rather than trusting this file's reading of them.
//
// What it declines today, all still served by the fallback: the shared-ref
// spelling (`comp: ''`, which reads whichever component happens to carry the
// column), and a substring too short for a useful index narrowing (see `grams`).
import { isRef, propAt } from './props.ts'
import {
  AGG,
  EDGES,
  EXISTS,
  fieldsOf,
  ftsTerm,
  NEVER,
  ORDER,
  type Pred,
  PROJECT,
  REACHES,
  refCols,
  TEXT,
  type Win,
  WINDOW,
} from './query.ts'
import { type Span, span } from './time.ts'
import { comps, stamped } from './types.ts'

// Bound values are only ever text or numbers — the grammar has no other
// literal, and saying so keeps every caller off a cast.
export type Bind = string | number
export type Sql = { sql: string; params: Bind[] }

// A tombstoned entity keeps its spine row so its int id can never recycle
// (D-18866), but it is DEAD — snapshot() drops it and the JS matcher never sees
// it. So every membership query over the spine excludes the graves, or it would
// return dead eids the fallback never would (a break of the exactness contract).
let LIVE = ` and "entity"."eid" not in (select eid from tombstone)`
let table = (name: string) =>
  name == 'doc' ? '"doc_value" as "doc"' : `"${name}"`
let source = (name: string) => name == 'doc' ? '"doc_value"' : `"${name}"`

// A column reference, quoted. The table is the component's own table, joined on
// the int owner key (D-18866), so `.task.status` is `"task"."status"`. Two
// columns need translation from the id-keyed storage back to the eids the
// grammar compares against: `eid` (the identity) reads off the owner key
// `entity`, and a `{eid}` REFERENCE column is an int id, so it is projected to
// its referent's eid through a correlated spine lookup — every predicate below
// (=, ~=, presence) then compares eids to eids exactly as the JS matcher does.
// The `entity` spine keeps its real `eid`/`id`/`num` columns.
let col = (comp: string, prop: string): string =>
  comp == 'entity'
    ? `"entity"."${prop}"`
    : prop == 'eid'
    ? `"${comp}"."entity"`
    : isRef(comp, prop)
    ? `(select __re.eid from entity __re where __re.id = "${comp}"."${prop}")`
    : `"${comp}"."${prop}"`

// The column as the MATCHER reads it. `updated.at` falls back to `created.at`
// for a row never touched since it was made (query.ts read(): being made IS the
// last time a thing changed) — so the compiled column has to say the same, or
// every window board silently omits everything filed and not revisited, which
// is exactly the class `.updated.at>=today` exists to show. The fallback needs
// `created` joined; build() adds it for any pred that reads this column.
let UPDATED_AT = `coalesce("updated"."at", "created"."at")`
let falls = (comp: string, prop: string) => comp == 'updated' && prop == 'at'
// task.status is DERIVED (D-24102), computed the same way statusOf does: a
// `cancelled` mark outranks a `completed` mark, then an active claim is wip,
// else open. The `entity` join build() adds for a task pred anchors it; the
// three marks are correlated EXISTS, so no extra joins. Mirrors UPDATED_AT: a
// column with no stored cell still reads as the value the matcher computes.
// The leading null guard mirrors a stored column: the task table is LEFT
// joined, so a non-task row has a null `task.entity` and must read NULL (not
// 'open'), or `.task.status=open` would match every entity that is not a task.
let STATUS = `(case when "task"."entity" is null then null` +
  ` when exists(select 1 from "cancelled" __s where __s."entity" = "task"."entity") then 'cancelled'` +
  ` when exists(select 1 from "completed" __s where __s."entity" = "task"."entity") then 'done'` +
  ` when exists(select 1 from "claim" __s where __s."entity" = "task"."entity") then 'wip'` +
  ` else 'open' end)`
let readCol = (comp: string, prop: string): string =>
  falls(comp, prop)
    ? UPDATED_AT
    : comp == 'task' && prop == 'status'
    ? STATUS
    : col(comp, prop)

// Is this a column the graph actually has, STORED? A pred naming an unknown
// column would compile to broken SQL rather than to `false`, so it is refused —
// and so is a DERIVED column (D-24102: task.status has no table to read). Both
// decline here: a filter is refined in JS (partial narrowing), a projection or
// tally falls to the JS matcher that computes the value through query.ts read().
let derived = (comp: string, prop: string) => comp == 'task' && prop == 'status'
// task.status is derived, not stored, but it DOES compile: readCol() supplies
// the CASE expression (STATUS), so a filter over it stays in SQL rather than
// falling to a JS scan of every task (M-17862). Only a tally/projection of the
// derived value still declines (see aggregate()/derived below).
let known = (comp: string, prop: string) =>
  !!comp && (!prop ? comp in comps : !!propAt(comp, prop)) &&
  (comp in comps || comp in stamped)

let tagOf = (comp: string, prop: string) => {
  let t = propAt(comp, prop)?.type
  if (t == null) return undefined
  return typeof t == 'string'
    ? t
    : 'enum' in t
    ? 'enum'
    : 'eid' in t
    ? 'eid'
    : 'text'
}

// query.ts compares a bare `=` with `String(v) == value`, so the column is
// cast to text and the operand bound as text. That is what makes
// `.priority=1` match a stored number 1 without the caller knowing the
// column's affinity.
let asText = (c: string) => `cast(${c} as text)`

let numeric = (s: string) => /^-?\d+(\.\d+)?$/.test(s)

// Every comparison over a TIME column rests on the stored value BEING a stamp:
// query.ts reads one through Date.parse, so a value it cannot parse is NaN and
// matches nothing at all, while SQL would happily sort it — an empty string
// lands BELOW every date and would answer `<yesterday`. Bounding the column to
// the lexical band a canonical stamp lives in excludes exactly those, on both
// sides, and being a range over the same column it costs an index scan
// nothing. What it cannot exclude is a value inside the band that is still not
// a date ('2026-13-45T…'); that last inch rests on the canonicalization
// invariant (see `edge`), which is what makes any of this exact to begin with.
let LO = '0000-01-01T00:00:00.000Z'
let HI = '9999-12-31T23:59:59.999Z'
let stampish = (c: string, s: Sql): Sql => ({
  sql: `(${c} between ? and ? and ${s.sql})`,
  params: [LO, HI, ...s.params],
})

// eq(v, value): '' is absent-or-empty, 'x..y' / 'x...y' a range, 'a,b' any-of,
// anything else a string match. NULL is not equal to anything but absence.
//
// The plain match is `String(v) == value`, and on a NUMERIC column that is not
// `cast(col as text) = ?`: `priority` is REAL, so SQLite casts a stored 1 to
// '1.0' while JS stringifies the same value to '1'. So a numeric column is
// compared numerically — and only when the operand SURVIVES A ROUND TRIP
// through JS's own number formatting. `.priority=1.0` does not: no JS number
// stringifies to '1.0', so the JS answer is empty for every row, and the
// honest compilation is a constant false rather than a numeric 1.
let eq = (c: string, value: string, knownTag = tagFor(c)): Sql | null => {
  if (value == '') {
    return { sql: `(${c} is null or ${asText(c)} = '')`, params: [] }
  }
  let r = value.match(/^(.*?)\.\.(\.?)(.*)$/s)
  if (r) {
    let [, lo, excl, hi] = r
    let bound = cmp(c, '>=', lo, knownTag)
    let upper = cmp(c, excl ? '<' : '<=', hi, knownTag)
    if (!bound || !upper) return null
    return {
      sql: `(${c} is not null and ${bound.sql} and ${upper.sql})`,
      params: [...bound.params, ...upper.params],
    }
  }
  if (value.includes(',')) {
    let parts = value.split(',').map((p) => eq(c, p, knownTag))
    if (parts.some((p) => !p)) return null
    return {
      sql: `(${parts.map((p) => p!.sql).join(' or ')})`,
      params: parts.flatMap((p) => p!.params),
    }
  }
  if (NUMERIC_TAGS.includes(String(knownTag))) {
    return numeric(value) && String(Number(value)) === value
      ? { sql: `${c} = ?`, params: [Number(value)] }
      : { sql: '0', params: [] }
  }
  return { sql: `${asText(c)} = ?`, params: [value] }
}

// cmp(v, s) is numeric when BOTH sides parse as numbers and lexical otherwise,
// which is a per-ROW decision in JS. SQL cannot make it per row without
// re-implementing asNum in the query, so this compiles only the two cases
// where the whole column agrees: a numeric-typed column against a numeric
// operand, or a text-typed column against a non-numeric one. Anything else is
// refused rather than guessed.
let NUMERIC_TAGS = ['number', 'priority', 'bool']
// A compiled column is usually its own quoted name, so its type reads straight
// out of the expression. A DERIVED one is not a name any more, so it says what
// it means here and eq()/cmp() type it exactly as they type a plain column.
let DERIVED: Record<string, string> = { [UPDATED_AT]: 'time' }
let tagFor = (c: string) => {
  let m = c.match(/^"(.+)"\."(.+)"$/)
  return m ? tagOf(m[1], m[2]) : DERIVED[c]
}
let cmp = (
  c: string,
  op: string,
  value: string,
  knownTag = tagFor(c),
): Sql | null => {
  let tag = knownTag
  if (!tag) return null
  if (NUMERIC_TAGS.includes(tag)) {
    return numeric(value)
      ? { sql: `${c} ${op} ?`, params: [Number(value)] }
      : null
  }
  // A stamp never parses as a number, so query.ts's cmp() is lexical for EVERY
  // row of a time column however numeric the operand looks — which is the one
  // case where "both sides agree" needs no per-row decision. The canonical
  // spelling (see `edge`) is what makes that lexical order chronological, and
  // the column is declared text, so no cast stands between it and an index.
  if (tag == 'time') {
    return stampish(c, { sql: `${c} ${op} ?`, params: [value] })
  }
  return numeric(value)
    ? null
    : { sql: `${asText(c)} ${op} ?`, params: [value] }
}

// ---- time spans (T-22370) ----
//
// A time phrase names a RANGE and the op picks its edge (query.ts inTime). It
// compiles to a plain TEXT comparison because every time-typed column holds ONE
// spelling: `new Date(at).toISOString()`, stamped by props.ts `time()` for every
// wire write (normalizeChanges runs inside apply()) and by server code for the
// stamped half — and db.ts's heal pass re-parses stored scalars through the same
// door. Over that spelling lexicographic order IS chronological order, so
// `"updated"."at" >= ?` asks exactly what `Date.parse(at) >= start` asks, and an
// index can answer it. SQLite's own date functions would read an offset stamp
// too, but wrapping the column in one forfeits the index — and the invariant
// makes them unnecessary.
//
// Compiling these is what lets a windowed board answer WHOLE. While they
// declined, `.updated.at=today` sank the whole statement, the subscription fell
// to the capped newest-first candidate prefix, and "Updated Today" showed 290
// of its 1248 matches.
let iso = (ms: number) => new Date(ms).toISOString()
let bound = (c: string, op: string, ms: number): Sql => ({
  sql: `${c} ${op} ?`,
  params: [iso(ms)],
})
let all = (a: Sql, b: Sql): Sql => ({
  sql: `(${a.sql} and ${b.sql})`,
  params: [...a.params, ...b.params],
})
let any = (parts: Sql[]): Sql =>
  parts.length == 1 ? parts[0] : {
    sql: `(${parts.map((p) => p.sql).join(' or ')})`,
    params: parts.flatMap((p) => p.params),
  }

// inTime's edges, each reduced to the comparison it actually is. A span whose
// end is its start is an INSTANT (a phrase naming one moment), and there
// inTime's `t == s.start` arms carry the whole answer; over a proper range those
// arms are redundant, since `t == start` already satisfies `start <= t < end`.
let edge = (c: string, op: string, s: Span): Sql => {
  let point = s.end <= s.start
  return op == '<'
    ? bound(c, '<', s.start)
    : op == '<='
    ? point ? bound(c, '<=', s.start) : bound(c, '<', s.end)
    : op == '>'
    ? point ? bound(c, '>', s.start) : bound(c, '>=', s.end)
    : op == '>='
    ? bound(c, '>=', s.start)
    : point // '' — within
    ? bound(c, '=', s.start)
    : all(bound(c, '>=', s.start), bound(c, '<', s.end))
}

// The time road, mirroring query.ts test() branch for branch: a comma list of
// phrases is any-of under `=` (none-of under `!=`); anything else re-reads the
// WHOLE value as one phrase; a value that is no phrase at all declines here and
// takes the ordinary scalar road (an ISO range, an absence test), exactly as
// the matcher does.
let timeSql = (p: Pred, c: string, now: number): Sql | null => {
  let spans = p.value.split(',').map((v) => span(v, now))
  if (spans.every((s) => s) && (p.op == '' || p.op == '!')) {
    let hit = stampish(c, any(spans.map((s) => edge(c, '', s!))))
    // A null column is not a string, so the matcher never enters the time road
    // for it: `=` misses and `!=` holds. SQL's own NULL gives the first; the
    // second needs coalesce, or `not (null …)` would drop exactly the rows a
    // `!=` means to keep.
    return p.op == ''
      ? hit
      : { sql: `(coalesce(${hit.sql}, 0) = 0)`, params: hit.params }
  }
  let s = span(p.value, now)
  return s ? stampish(c, edge(c, p.op, s)) : null
}

// `~=` is String(v ?? '').toLowerCase().includes(needle). instr() rather than
// LIKE so a '%' or '_' in the needle needs no escaping; coalesce so a missing
// column reads as '' exactly as the JS does. An empty needle is true of every
// string, including that ''.
//
// A NON-ASCII needle declines, because the two case foldings are not the same
// one: SQLite's lower() touches A-Z and nothing else, while JS's toLowerCase()
// is Unicode — so `~=café` finds a stored 'CAFÉ' in the matcher and misses it
// here. There is no unicode-aware lower() to compile to without ICU, and an
// almost-right answer is the thing this file exists not to give. (The mirror
// case — an ASCII needle against text holding U+212A or U+0130, whose JS
// lowercase IS ASCII — cannot be seen from a needle and stays uncompiled-for.)
let ascii = (s: string) => [...s].every((c) => c.charCodeAt(0) < 128)
let has = (c: string, value: string): Sql | null =>
  !ascii(value) ? null : value == '' ? { sql: '1', params: [] } : {
    sql: `instr(lower(coalesce(${asText(c)}, '')), lower(?)) > 0`,
    params: [value],
  }

// A substring over a body is the one predicate instr() cannot afford — it
// lowercases every body in the graph, ~60ms a pass. `doc_gram` (db.ts) is the
// index that fixes it: FTS5's trigram tokenizer, which is what lets SQLite
// answer `like '%x%'` from an index. doc_fts cannot stand in — it indexes
// TOKENS, so `idget` finds none of the rows holding `widget`, and narrowing a
// substring with it loses rows silently.
//
// The index NARROWS, it never decides. The needle rides into LIKE raw, its
// `%` and `_` still wildcards — a wildcard only ever WIDENS a pattern, so the
// candidates stay a superset and no escaping is needed — and has() re-tests
// each one with the same instr() the JS matcher agrees with. The answer is a
// scan's answer whatever the tokenizer folds.
//
// Fewer than three consecutive non-wildcard characters is no trigram at all:
// fts5 answers those by decoding the whole index, which is slower than the
// scan it replaced, so they decline and the JS matcher takes them.
let GRAM = 3
let grams = (needle: string) =>
  needle.split(/[%_]/).some((run) => [...run].length >= GRAM)

// Only doc's own columns are indexed, so the rowid is doc's.
let narrow = (cols: string[], needle: string, exact: Sql | null): Sql | null =>
  exact && grams(needle)
    ? {
      sql: `("doc"."rowid" in (${
        cols.map((c) => `select rowid from doc_gram where "${c}" like ?`)
          .join(' union ')
      }) and ${exact.sql})`,
      params: [...cols.map(() => `%${needle}%`), ...exact.params],
    }
    : null

// A bare word is an exact FTS membership test over doc title/body. The same
// quoted-term builder drives ranked retrieval, so an initial subscription
// cannot widen token matches into legacy substring matches.
let text = (value: string): Sql | null => {
  let term = ftsTerm(value)
  return term
    ? {
      sql: `"doc"."rowid" in (
        select rowid from doc_fts where doc_fts match ?
      )`,
      params: [term],
    }
    : { sql: '0', params: [] }
}

// A body is never scanned. `~=` over doc.body goes through the index; every
// other op, and every other body column (hook.payload, session.final_text —
// none of them indexed), declines and the JS matcher answers.
let body = (p: Pred, c: string): Sql | null =>
  p.op != '~' || p.comp != 'doc' || p.prop != 'body'
    ? null
    : p.value == ''
    ? has(c, p.value)
    : narrow(['body'], p.value, has(c, p.value))

// The ops query.ts routes to cmp(), spelled the same in SQL.
let CMP: Record<string, string> = { '<': '<', '<=': '<=', '>': '>', '>=': '>=' }

// One scalar predicate, separated from where its value came from. A path leaf
// is a correlated scalar subquery rather than a joined column, but the value
// still has the leaf column's declared type and must take the exact same
// equality/range/time/absence roads as a direct column.
let scalar = (
  p: Pred,
  c: string,
  tag: string | undefined,
  now: number,
  path = false,
): Sql | null => {
  if (p.op == EXISTS) return { sql: `${c} is not null`, params: [] }
  // doc.body's trigram narrowing is tied to the outer doc row. A path body has
  // a different owner, so only the empty contains (which needs no index) can
  // compile here; every other body operation declines exactly as it does at
  // depth zero.
  if (tag == 'body') {
    if (path) return p.op == '~' && p.value == '' ? has(c, '') : null
    return body(p, c)
  }
  // A phrase takes the span road; `~=` never does (the matcher excludes it, so
  // a stamp's substring stays a literal contains), and a value that is no
  // phrase falls through to the ordinary scalar road below.
  if (tag == 'time' && p.op != '~') {
    let t = timeSql(p, c, now)
    if (t) return t
  }
  if (p.op == '') return eq(c, p.value, tag)
  if (p.op == '!') {
    // `!eq(v, value)`, and eq(null, …) is FALSE — but SQL's `not (null = ?)`
    // is NULL, which drops exactly the rows whose component is absent.
    let inner = eq(c, p.value, tag)
    return inner &&
      { sql: `(coalesce(${inner.sql}, 0) = 0)`, params: inner.params }
  }
  if (p.op == '~') return has(c, p.value)
  if (CMP[p.op]) {
    let inner = cmp(c, CMP[p.op], p.value, tag)
    return inner &&
      { sql: `(${c} is not null and ${inner.sql})`, params: inner.params }
  }
  return null
}

// A forward path is a chain of one-to-one reference lookups. Component rows
// and reference columns are both indexed by their integer owner/target ids, so
// nested correlated scalar subqueries walk the chain without widening the
// candidate set or scanning the graph. Missing intermediate rows yield NULL:
// equality/comparisons miss, `!=` holds, and an absent component leaf holds —
// exactly the matcher reading a broken link as an undefined bag.
let pathSql = (p: Pred, now: number): Sql | null => {
  if (!p.at?.length || !known(p.comp, p.prop) || !isRef(p.comp, p.prop)) {
    return null
  }
  let target = `"${p.comp}"."${p.prop}"`
  for (let [i, h] of p.at.slice(0, -1).entries()) {
    if (!known(h.comp, h.prop) || !isRef(h.comp, h.prop)) return null
    let a = `__path_${i}`
    target = `(select "${a}"."${h.prop}" from ${source(h.comp)} as "${a}"` +
      ` where "${a}"."entity" = ${target})`
  }
  let leaf = p.at[p.at.length - 1]
  if (!known(leaf.comp, leaf.prop)) return null
  let a = '__path_leaf'
  if (!leaf.prop) {
    let owner = leaf.comp == 'entity' ? `"${a}"."id"` : `"${a}"."entity"`
    let hit = `(select ${owner} from ${source(leaf.comp)} as "${a}"` +
      ` where ${owner} = ${target})`
    return {
      sql: `${hit} is ${p.op == '~' || p.op == EXISTS ? 'not ' : ''}null`,
      params: [],
    }
  }
  let c: string
  if (leaf.comp == 'updated' && leaf.prop == 'at') {
    c = `coalesce(` +
      `(select "${a}"."at" from "updated" as "${a}"` +
      ` where "${a}"."entity" = ${target}),` +
      `(select "__path_created"."at" from "created" as "__path_created"` +
      ` where "__path_created"."entity" = ${target}))`
  } else if (leaf.comp == 'task' && leaf.prop == 'status') {
    c = `(case when not exists(select 1 from task __path_task` +
      ` where __path_task.entity = ${target}) then null` +
      ` when exists(select 1 from cancelled __path_mark` +
      ` where __path_mark.entity = ${target}) then 'cancelled'` +
      ` when exists(select 1 from completed __path_mark` +
      ` where __path_mark.entity = ${target}) then 'done'` +
      ` when exists(select 1 from claim __path_mark` +
      ` where __path_mark.entity = ${target}) then 'wip'` +
      ` else 'open' end)`
  } else if (leaf.comp == 'entity') {
    c = `(select "${a}"."${leaf.prop}" from "entity" as "${a}"` +
      ` where "${a}"."id" = ${target})`
  } else if (isRef(leaf.comp, leaf.prop)) {
    c = `(select "__path_ref"."eid" from ${source(leaf.comp)} as "${a}"` +
      ` join entity __path_ref on __path_ref.id = "${a}"."${leaf.prop}"` +
      ` where "${a}"."entity" = ${target})`
  } else {
    c = `(select "${a}"."${leaf.prop}" from ${source(leaf.comp)} as "${a}"` +
      ` where "${a}"."entity" = ${target})`
  }
  return scalar(
    { ...p, comp: leaf.comp, prop: leaf.prop },
    c,
    tagOf(
      leaf.comp,
      leaf.prop,
    ),
    now,
    true,
  )
}

let one = (p: Pred, now: number): Sql | null => {
  // The empty query's never-pred: a false condition, so the index answers
  // the empty set immediately — never a full scan, never a dropped pred.
  if (p.op == NEVER) return { sql: '0', params: [] }
  if (p.op == ORDER) return { sql: '1', params: [] } // a ranking, not a filter
  if (p.op == AGG) return { sql: '1', params: [] } // a projection; see aggregateSql
  if (p.op == PROJECT) return { sql: '1', params: [] } // fields; see select()
  if (p.op == WINDOW) return { sql: '1', params: [] } // a bound; see windowed()
  if (p.op == EDGES) return { sql: '1', params: [] } // a rider; see edgeRider()
  if (p.op == REACHES) return reachSql(p)
  if (p.op == TEXT) return text(p.value)
  if (p.refs) return refsSql(p) // multi-column reverse-union: an eid IN union
  if (p.rev) return revSql(p, now) // a reverse hop: a correlated EXISTS/count
  if (p.at) return pathSql(p, now)
  if (!known(p.comp, p.prop)) return null
  if (!p.prop) {
    return {
      sql: `${col(p.comp, 'eid')} is ${
        p.op == '~' || p.op == EXISTS ? 'not ' : ''
      }null`,
      params: [],
    }
  }
  let tag = tagOf(p.comp, p.prop)
  let c = readCol(p.comp, p.prop)
  return scalar(p, c, tag, now)
}

// The LEFT JOINs and AND-condition for a set of preds over a base entity whose
// component tables join on that base's eid. Shared by where() (base = the spine
// `entity`) and a reverse EXISTS subquery (base = the child ref table), so the
// same one() compiles a pred whether it screens the parent or a child. Declines
// (null) the moment a pred does — the exactness contract, unbroken across the
// join. The base table is the FROM, never re-joined; and a subquery may not join
// `entity` (its name is the correlation to the OUTER row), so a child pred naming
// the spine declines rather than silently shadow it.
//
// `drop` is the partial-narrowing mode (whereSome): a declining pred is SKIPPED
// rather than sinking the whole compile. Dropping a pred from a conjunction only
// WIDENS its result, so the compiled subset selects a SUPERSET that the caller's
// JS matcher then refines with the full pred list — never a superset that misses
// a true match. Only the top-level `entity` base uses it; reverse-EXISTS
// subqueries stay exact-or-decline, so a hop that cannot compile exactly drops
// WHOLE (its one() returns null) and is refined in JS, never compiled partially.
let build = (
  preds: Pred[],
  base: string,
  also: string[] = [],
  drop = false,
  now = Date.now(),
): { joins: string; cond: string; params: Bind[] } | null => {
  let parts: Sql[] = []
  let kept: Pred[] = []
  for (let p of preds) {
    let s = one(p, now)
    if (!s) {
      if (drop) continue // partial narrowing: refine this pred in JS
      return null
    }
    parts.push(s)
    kept.push(p)
  }
  let tables = new Set<string>()
  for (let p of kept) {
    if (p.rev) continue // its EXISTS is self-contained; nothing joins here
    if (p.op == TEXT) tables.add('doc')
    else if (p.comp) tables.add(p.comp)
    // the far half of the updated.at fallback (readCol)
    if (!p.at && falls(p.comp, p.prop)) tables.add('created')
  }
  // `also` carries the projected columns' components (select()): a projection may
  // name a table no filter joined, and it must still be LEFT JOINed to be read.
  for (let t of also) if (t) tables.add(t)
  tables.delete(base)
  if (base != 'entity' && tables.has('entity')) return null
  // Sibling component tables share one entity, so they join on the int owner
  // key: the spine's `id` when the base IS the spine, else the base table's own
  // `entity` owner.
  let key = base == 'entity' ? `"entity"."id"` : `"${base}"."entity"`
  let joins = [...tables]
    .filter((t) => t != 'entity')
    .map((t) => ` left join ${table(t)} on "${t}"."entity" = ${key}`)
    .join('')
  let cond = parts.length ? parts.map((p) => p.sql).join(' and ') : '1'
  return { joins, cond, params: parts.flatMap((p) => p.params) }
}

// The correlated-EXISTS half of a reverse hop. `.comments…` compiles to an
// EXISTS over the child ref table, correlated on the parent's eid and backed by
// the {eid}-ref index (T-17678: comment.target is `comment_target`, so the EXISTS
// is an index SEARCH, not a scan). The sub-filter rides the same build()/one()
// the top level does, evaluated over the CHILD — so anything where() cannot
// compile there (a time span, a nested path) declines the whole hop, exactness
// preserved. `not` negates (NONE / ALL). Cardinality (`.comments>=5`) is a
// correlated count() compared to the number.
let COUNT_OPS: Record<string, string> = {
  '': '=',
  '!': '!=',
  '<': '<',
  '<=': '<=',
  '>': '>',
  '>=': '>=',
}
let revSql = (p: Pred, now: number): Sql | null => {
  let r = p.rev!
  let base = r.comp
  // The child's int reference equals the parent spine's int id (both id-keyed),
  // so the correlation is a plain integer comparison — no eid projection.
  let corr = `"${base}"."${r.prop}" = "entity"."id"`
  if (r.count) {
    let op = COUNT_OPS[p.op]
    if (op == null || !/^\d+$/.test(p.value)) return null
    return {
      sql: `(select count(*) from "${base}" where ${corr}) ${op} ?`,
      params: [Number(p.value)],
    }
  }
  let inner = build(r.preds, base, [], false, now)
  if (!inner) return null
  let tail = inner.cond == '1' ? '' : ` and ${inner.cond}`
  return {
    sql: `${r.not ? 'not ' : ''}exists (select 1 from "${base}"${inner.joins}` +
      ` where ${corr}${tail})`,
    params: inner.params,
  }
}

// The bounded traversal compiled: `.reaches[requires,<=3]=T-42` is a recursive
// CTE that walks the dependency table BACKWARD from the target — each step reads
// `d.child = <current>`, which is the `dependency_child` index (the reverse
// endpoint's own index, db.ts depIndex), so the closure is a sequence of index
// SEARCHES and never a scan of the edge table. The depth cap is the recursion's
// own guard, so a cycle terminates by arithmetic rather than by SQLite's
// dedupe alone. `depth > 0` excludes the target: reaching is at least one hop.
//
// `+d.type` is not decoration. Both terms are indexable and the planner picks
// ONE; on the live graph it picks `type` and builds an automatic index over the
// whole edge table per step — a scan wearing an index's name — because the
// stored ANALYZE stats for `dependency_child` are stale (they claim 205 rows per
// child where the graph has 9). The `+` says which term this walk is ABOUT: the
// endpoint, whose index makes every step a seek regardless of what stats say.
let reachSql = (p: Pred): Sql | null => {
  let r = p.reach
  if (!r || !p.value) return null
  return {
    sql: `"entity"."id" in (with recursive __reach(id, depth) as (` +
      ` select id, 0 from entity where eid = ?` +
      ` union select d.parent, __reach.depth + 1 from dependency d` +
      ` join __reach on d.child = __reach.id` +
      ` where __reach.depth < ? and +d.type = ?` +
      `) select id from __reach where depth > 0)`,
    params: [p.value, r.depth, r.type],
  }
}

// The multi-column reverse-union compiled: the backlinks of `value` are the
// UNION of every ref column that equals it, each an index search (T-17678), so
// the whole thing is `eid in (select … union select …)` — no wide join, the
// `narrow()` doc_gram shape. Only the positive equality compiles; presence and
// absence admit rows in no reverse map, so they decline and the matcher answers.
let refsSql = (p: Pred): Sql | null => {
  if (p.op != '' || !p.value) return null
  // Each backlink is an int-id search: the child rows whose ref column equals
  // the target's id, yielding their owner ids, unioned — the parent matches if
  // its id is among them.
  let subs = refCols.map(([c, pr]) =>
    `select "${c}"."entity" from "${c}"
       where "${c}"."${pr}" = (select id from entity where eid = ?)`
  )
  return {
    sql: `"entity"."id" in (${subs.join(' union ')})`,
    params: refCols.map(() => p.value),
  }
}

// An aggregate query: the distinct values of a column, or a per-value tally,
// over the entities the rest of the preds select. build() joins the column's
// component (its AGG pred names it, one() compiling to '1') and every filter
// beside it, so the projection rides the same exact WHERE as a membership query.
// Empties (null and '') are dropped to match tally(); a numeric/time column
// declines, since cast-to-text would disagree with the matcher's String(v).
// How MANY entities a filter selects — the `.count!` statement, and the TOTAL a
// windowed reply states its page is a prefix of. One indexed count over the same
// WHERE a membership query runs, so the two can never disagree about what the
// selection is. null when any predicate declined.
export let countSql = (preds: Pred[], now = Date.now()): Sql | null => {
  let built = build(preds, 'entity', [], false, now)
  if (!built) return null
  return {
    sql: `select '' as value, count(*) as n from "entity"${built.joins}` +
      ` where ${built.cond}${LIVE}`,
    params: built.params,
  }
}

export let aggregateSql = (preds: Pred[], now = Date.now()): Sql | null => {
  let agg = preds.find((p) => p.op == AGG)
  if (!agg) return null
  // `.count!` reduces the SELECTION, not a column: one indexed count over the
  // same WHERE, answered under the empty key so every aggregate — count, tally,
  // distinct — comes back as one value→count shape.
  if (agg.agg == 'count') return countSql(preds, now)
  if (!agg.comp || !agg.prop) return null
  // A DERIVED column (D-24102: task.status) has no table to select — decline so
  // the caller tallies/distincts it in JS through query.ts read(), exactly as a
  // declining filter falls to the matcher.
  if (derived(agg.comp, agg.prop)) return null
  let tag = tagOf(agg.comp, agg.prop)
  if (!['text', 'enum', 'eid'].includes(String(tag))) return null
  let built = build(preds, 'entity', [], false, now)
  if (!built) return null
  let c = col(agg.comp, agg.prop)
  let cond = `${c} is not null and ${asText(c)} != '' and ${built.cond}`
  let sel = agg.agg == 'tally'
    ? `select ${asText(c)} as value, count(*) as n`
    : `select distinct ${asText(c)} as value`
  return {
    sql: `${sel} from "entity"${built.joins} where ${cond}${LIVE}` +
      (agg.agg == 'tally' ? ' group by value' : '') + ' order by value',
    params: built.params,
  }
}

// The whole filter as one statement, or null if any predicate declined.
// Every component a pred names is LEFT JOINed, so "the column is absent"
// and "the component is absent" are the same NULL — which is what query.ts's
// `read()` already says by returning undefined for both. The spine is already
// the FROM table, so `.entity.num=13882` must not join it to itself (SQLite
// refuses "ambiguous column name: entity.eid") — build() drops it.
export let where = (preds: Pred[], now = Date.now()): Sql | null => {
  let built = build(preds, 'entity', [], false, now)
  if (!built) return null
  return {
    sql: `select "entity"."eid" as eid from "entity"${built.joins}` +
      ` where ${built.cond}${LIVE}`,
    params: built.params,
  }
}

// The partial-narrowing statement: like where(), but a predicate the compiler
// cannot express EXACTLY is DROPPED from the SQL instead of sinking the whole
// compile (build's `drop` mode). Because every query is a conjunction, dropping
// a pred only WIDENS the result, so this selects a SUPERSET of the true matches;
// the caller reads those candidate rows and refines them in JS with the full
// pred list (graph_query.ts evalQuery). This is what lets a query mixing a
// compilable pred (`.status=open`) with a declining one (`.assignee.title~=j`, a
// time span) read only the narrow candidate set rather than the whole graph.
// When NOTHING compiles, the candidate set is every live entity — still read
// through the index, never a materialized snapshot. Never null: the top-level
// `entity` base cannot reach build's only null branch (the entity-self-join
// guard, which fires solely inside a reverse-EXISTS subquery).
export let whereSome = (preds: Pred[], now = Date.now()): Sql => {
  let built = build(preds, 'entity', [], true, now)!
  return {
    sql: `select "entity"."eid" as eid from "entity"${built.joins}` +
      ` where ${built.cond}${LIVE}`,
    params: built.params,
  }
}

// A PROJECTED membership query: the eids `where()` selects, PLUS the columns each
// row carries beyond its eid (`.fields=pin.x,pin.z`). The projected columns'
// components are LEFT JOINed like a filter's and selected aliased `comp.prop`; a
// `~`-volatile field is projected identically — volatility is a change-signal
// concern the caller reads off fieldsOf(), invisible to SQL. A query naming no
// projection IS `where()` (eid only), and so is the EIDS-ONLY projection
// (`.fields=eid`, an empty field list) — the two ask SQL for the same statement
// and differ only in what the caller then believes about the rows. null if a
// projected column is unknown or any filter declined — the exactness contract,
// unbroken.
export let select = (preds: Pred[], now = Date.now()): Sql | null => {
  let fields = fieldsOf(preds)
  if (!fields?.length) return where(preds, now)
  for (let f of fields) if (!known(f.comp, f.prop)) return null
  let built = build(preds, 'entity', fields.map((f) => f.comp), false, now)
  if (!built) return null
  let cols = fields.map((f) =>
    `${col(f.comp, f.prop)} as "${f.comp}.${f.prop}"`
  )
  return {
    sql: `select "entity"."eid" as eid, ${cols.join(', ')} from "entity"` +
      `${built.joins} where ${built.cond}${LIVE}`,
    params: built.params,
  }
}

// A statement bounded to a WINDOW: the newest `limit` rows by spine num, and —
// with `after` — only those below a num cursor, so paging is `.limit=N` then
// the same line carrying the last num it answered. The order is the window's
// definition, not a presentation choice: "newest first" is what makes a prefix
// mean something and a cursor able to continue it.
//
// This may only ride a statement whose result needs no JS refinement — an EXACT
// where(), over screened() preds — because a filter applied after the LIMIT
// under-fills the page. That is why the quarantine and entry screens moved into
// the compiled preds (query.ts screened) rather than staying post-filters.
export let windowed = (base: Sql, w: Win): Sql => ({
  sql: base.sql +
    (w.after != null ? ` and "entity"."num" < ?` : '') +
    ` order by "entity"."num" desc` +
    (w.limit != null ? ` limit ?` : ''),
  params: [
    ...base.params,
    ...w.after != null ? [w.after] : [],
    ...w.limit != null ? [w.limit] : [],
  ],
})
