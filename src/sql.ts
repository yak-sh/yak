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
// What it declines today, all still served by the fallback: time phrases (the
// span is a moving window, and inTime's edge cases deserve their own pass),
// path predicates (`.assignee.title~=j`, a second join), the shared-ref
// spelling (`comp: ''`, which reads whichever component happens to carry the
// column), and a substring too short for a trigram (see `grams`).
import { propAt } from './props.ts'
import { AGG, EXISTS, ORDER, type Pred, refCols, TEXT } from './query.ts'
import { comps, stamped } from './types.ts'

// Bound values are only ever text or numbers — the grammar has no other
// literal, and saying so keeps every caller off a cast.
export type Bind = string | number
export type Sql = { sql: string; params: Bind[] }

// A column reference, quoted. The table is the component's own table, joined
// on eid, so `.task.status` is `"task"."status"`.
let col = (comp: string, prop: string) => `"${comp}"."${prop}"`

// Is this a column the graph actually has? A pred naming an unknown column
// would compile to broken SQL rather than to `false`, so it is refused.
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
let eq = (c: string, value: string): Sql | null => {
  if (value == '') {
    return { sql: `(${c} is null or ${asText(c)} = '')`, params: [] }
  }
  let r = value.match(/^(.*?)\.\.(\.?)(.*)$/s)
  if (r) {
    let [, lo, excl, hi] = r
    let bound = cmp(c, '>=', lo)
    let upper = cmp(c, excl ? '<' : '<=', hi)
    if (!bound || !upper) return null
    return {
      sql: `(${c} is not null and ${bound.sql} and ${upper.sql})`,
      params: [...bound.params, ...upper.params],
    }
  }
  if (value.includes(',')) {
    let parts = value.split(',').map((p) => eq(c, p))
    if (parts.some((p) => !p)) return null
    return {
      sql: `(${parts.map((p) => p!.sql).join(' or ')})`,
      params: parts.flatMap((p) => p!.params),
    }
  }
  if (isNum(c)) {
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
let tagFor = (c: string) => {
  let m = c.match(/^"(.+)"\."(.+)"$/)
  return m ? tagOf(m[1], m[2]) : undefined
}
let isNum = (c: string) => NUMERIC_TAGS.includes(String(tagFor(c)))
let cmp = (c: string, op: string, value: string): Sql | null => {
  let tag = tagFor(c)
  if (!tag) return null
  if (NUMERIC_TAGS.includes(tag)) {
    return numeric(value)
      ? { sql: `${c} ${op} ?`, params: [Number(value)] }
      : null
  }
  if (tag == 'time') return null // spans are their own pass
  return numeric(value)
    ? null
    : { sql: `${asText(c)} ${op} ?`, params: [value] }
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

// A bare word is a TEXT pred: contains over the doc, title OR body, the one
// pred with two columns. JS reads a missing doc as no match at all — which is
// the only thing an empty needle can turn on, since it is true of every string.
let text = (value: string): Sql | null => {
  if (value == '') return { sql: `"doc"."eid" is not null`, params: [] }
  let cols = ['title', 'body']
  let [t, b] = cols.map((p) => has(col('doc', p), value))
  return t && b
    ? narrow(cols, value, {
      sql: `(${t.sql} or ${b.sql})`,
      params: [...t.params, ...b.params],
    })
    : null
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

let one = (p: Pred): Sql | null => {
  if (p.op == ORDER) return { sql: '1', params: [] } // a ranking, not a filter
  if (p.op == AGG) return { sql: '1', params: [] } // a projection; see aggregateSql
  if (p.op == TEXT) return text(p.value)
  if (p.refs) return refsSql(p) // multi-column reverse-union: an eid IN union
  if (p.rev) return revSql(p) // a reverse hop: a correlated EXISTS/count
  if (p.at) return null // path preds need a second join
  if (!known(p.comp, p.prop)) return null
  if (!p.prop) {
    return {
      sql: `${col(p.comp, 'eid')} is ${
        p.op == '~' || p.op == EXISTS ? 'not ' : ''
      }null`,
      params: [],
    }
  }
  // query.ts reads an untouched entity's created.at as updated.at. Compiling
  // this would need that second join; the exact fallback already has it.
  if (p.op == EXISTS && p.comp == 'updated' && p.prop == 'at') return null
  if (p.op == EXISTS) {
    return { sql: `${col(p.comp, p.prop)} is not null`, params: [] }
  }
  let tag = tagOf(p.comp, p.prop)
  if (tag == 'time') return null // spans are their own pass
  let c = col(p.comp, p.prop)
  if (tag == 'body') return body(p, c)
  if (p.op == '') return eq(c, p.value)
  if (p.op == '!') {
    // `!eq(v, value)`, and eq(null, …) is FALSE — but SQL's `not (null = ?)`
    // is NULL, which drops exactly the rows whose component is absent. Those
    // are the rows a `!=` most often means to keep, and nothing about the
    // result would have looked wrong.
    let inner = eq(c, p.value)
    return inner &&
      { sql: `(coalesce(${inner.sql}, 0) = 0)`, params: inner.params }
  }
  if (p.op == '~') return has(c, p.value)
  if (CMP[p.op]) {
    // JS: `if (v == null) return false` before comparing.
    let inner = cmp(c, CMP[p.op], p.value)
    return inner &&
      { sql: `(${c} is not null and ${inner.sql})`, params: inner.params }
  }
  return null
}

// The LEFT JOINs and AND-condition for a set of preds over a base entity whose
// component tables join on that base's eid. Shared by where() (base = the spine
// `entity`) and a reverse EXISTS subquery (base = the child ref table), so the
// same one() compiles a pred whether it screens the parent or a child. Declines
// (null) the moment a pred does — the exactness contract, unbroken across the
// join. The base table is the FROM, never re-joined; and a subquery may not join
// `entity` (its name is the correlation to the OUTER row), so a child pred naming
// the spine declines rather than silently shadow it.
let build = (
  preds: Pred[],
  base: string,
): { joins: string; cond: string; params: Bind[] } | null => {
  let parts: Sql[] = []
  for (let p of preds) {
    let s = one(p)
    if (!s) return null
    parts.push(s)
  }
  let tables = new Set<string>()
  for (let p of preds) {
    if (p.rev) continue // its EXISTS is self-contained; nothing joins here
    if (p.op == TEXT) tables.add('doc')
    else if (p.comp && !p.at) tables.add(p.comp)
  }
  tables.delete(base)
  if (base != 'entity' && tables.has('entity')) return null
  let eid = col(base, 'eid')
  let joins = [...tables]
    .filter((t) => t != 'entity')
    .map((t) => ` left join "${t}" on "${t}"."eid" = ${eid}`)
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
let revSql = (p: Pred): Sql | null => {
  let r = p.rev!
  let base = r.comp
  let corr = `${col(base, r.prop)} = "entity"."eid"`
  if (r.count) {
    let op = COUNT_OPS[p.op]
    if (op == null || !/^\d+$/.test(p.value)) return null
    return {
      sql: `(select count(*) from "${base}" where ${corr}) ${op} ?`,
      params: [Number(p.value)],
    }
  }
  let inner = build(r.preds, base)
  if (!inner) return null
  let tail = inner.cond == '1' ? '' : ` and ${inner.cond}`
  return {
    sql: `${r.not ? 'not ' : ''}exists (select 1 from "${base}"${inner.joins}` +
      ` where ${corr}${tail})`,
    params: inner.params,
  }
}

// The multi-column reverse-union compiled: the backlinks of `value` are the
// UNION of every ref column that equals it, each an index search (T-17678), so
// the whole thing is `eid in (select … union select …)` — no wide join, the
// `narrow()` doc_gram shape. Only the positive equality compiles; presence and
// absence admit rows in no reverse map, so they decline and the matcher answers.
let refsSql = (p: Pred): Sql | null => {
  if (p.op != '' || !p.value) return null
  let subs = refCols.map(([c, pr]) =>
    `select "${c}"."eid" from "${c}" where ${asText(col(c, pr))} = ?`
  )
  return {
    sql: `"entity"."eid" in (${subs.join(' union ')})`,
    params: refCols.map(() => p.value),
  }
}

// An aggregate query: the distinct values of a column, or a per-value tally,
// over the entities the rest of the preds select. build() joins the column's
// component (its AGG pred names it, one() compiling to '1') and every filter
// beside it, so the projection rides the same exact WHERE as a membership query.
// Empties (null and '') are dropped to match tally(); a numeric/time column
// declines, since cast-to-text would disagree with the matcher's String(v).
export let aggregateSql = (preds: Pred[]): Sql | null => {
  let agg = preds.find((p) => p.op == AGG)
  if (!agg?.comp || !agg.prop) return null
  let tag = tagOf(agg.comp, agg.prop)
  if (!['text', 'enum', 'eid'].includes(String(tag))) return null
  let built = build(preds, 'entity')
  if (!built) return null
  let c = col(agg.comp, agg.prop)
  let cond = `${c} is not null and ${asText(c)} != '' and ${built.cond}`
  let sel = agg.agg == 'tally'
    ? `select ${asText(c)} as value, count(*) as n`
    : `select distinct ${asText(c)} as value`
  return {
    sql: `${sel} from "entity"${built.joins} where ${cond}` +
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
export let where = (preds: Pred[]): Sql | null => {
  let built = build(preds, 'entity')
  if (!built) return null
  return {
    sql: `select "entity"."eid" as eid from "entity"${built.joins}` +
      ` where ${built.cond}`,
    params: built.params,
  }
}
