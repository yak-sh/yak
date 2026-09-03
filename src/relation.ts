// A SELECT as a VALUE, between the filter grammar and the SQL text (Jeff,
// 2026-09-03: "arel relations as an intermediary between our query lang and
// the sql"). A relation carries its projection, joins, conditions, grouping,
// ordering and bound as DATA; `toSql` renders them once, in the order SQL
// demands, and `run` is a second consumer of the same value. Neither is the
// composition's terminal — the relation is.
//
// Why it exists: sql.ts built five statements by repeating the same
// `from "entity" ${joins} where ${cond}` skeleton around a different
// projection, and `windowed()` bolted ` and … order by … limit ?` onto a
// FINISHED string — correct only while every statement it rides ends in a
// WHERE clause, a rule held by a doc comment rather than by the shape. Adding
// a clause to a value cannot break another clause; concatenating text can.
//
// Why the relation is a value and not a closure: a value can be looked INTO,
// so a pass can rewrite it before it is rendered — which is what would later
// let one fold a per-row lookup into a join rather than each caller
// remembering not to write an N+1. It is also serializable, printable in a
// test, and diffable.
//
// The vocabulary is Arel's, deliberately (M-12915): `project`, `where`,
// `outer`, `group`, `order`, `take`, `distinct`. Anyone who has used Arel or
// ActiveRecord already knows what these words do, and a house synonym would
// only make them learn our spelling of a thing they know.
//
// The SHAPE is not Arel's (Jeff: "i'd probably not use OOP like arel does, but
// keep it in my idiomatic functional style"). Arel chains methods on a mutable
// manager; here every combinator returns a `Step` — a plain transform of one
// relation into the next — so relations are built by piping steps over a
// source, never by mutating a builder. `from` starts one; `also` extends one
// that already exists.
import { pipe, push, set, update } from './fp.ts'
import type { Sql } from './store/sql.ts'

// Bound values are only ever text or numbers — the filter grammar has no other
// literal, and saying so keeps every caller off a cast.
export type Bind = string | number

// A piece of SQL and the binds it consumes, in the order it consumes them. A
// compiled predicate, a rendered statement, and a condition are all this one
// shape, so a predicate IS a condition here with no adapter.
export type Frag = { sql: string; params: Bind[] }

// One joined table: the source as it is spelled after `join` (a component's
// storage table, which for `doc` is `"doc_value" as "doc"`), and the whole ON
// expression. The ON is computed by the caller because only the caller knows
// the base it joins against — the spine's `id` when the base IS the spine,
// else the base table's own `entity` owner.
export type Join = { source: string; on: string }

export type Rel = {
  from: string
  cols: string[]
  uniq: boolean
  joins: Join[]
  conds: Frag[]
  by: string | null
  sort: string[]
  bound: Bind | null
}

// One transform of a relation. Every combinator below returns one, so they
// compose by ordinary `pipe` and need no builder object.
export type Step = (rel: Rel) => Rel

let bare = (from: string): Rel => ({
  from,
  cols: [],
  uniq: false,
  joins: [],
  conds: [],
  by: null,
  sort: [],
  bound: null,
})

// A relation over a source, spelled as it appears after `from`, with its steps
// piped in. This is the front door: `from('"entity"', project(…), where(…))`.
export let from = (source: string, ...steps: Step[]): Rel =>
  pipe(...steps)(bare(source))

// More steps over a relation that already exists — what lets `windowed` be a
// function OF a relation rather than a rewrite of a string.
export let also = (rel: Rel, ...steps: Step[]): Rel => pipe(...steps)(rel)

// Columns to select, as whole expressions (`"entity"."eid" as eid`). Adds
// rather than replaces, so a projection can be built up in pieces.
export let project = (...cols: string[]): Step =>
  update<Rel>({ cols: push(...cols) })

export let distinct = (): Step => set<Rel>({ uniq: true })

// A LEFT join. Every join this layer makes is outer on purpose: a component
// table is joined to read a column that may be absent, and "the column is
// absent" and "the component is absent" must be the same NULL — which is what
// the filter grammar's `read()` already says by returning undefined for both.
// An inner join would silently turn an absent component into a missing ROW.
export let outer = (source: string, on: string): Step =>
  update<Rel>({ joins: push({ source, on }) })

// More conditions, ANDed with the rest. Every query this layer serves is a
// conjunction; a disjunction is written inside a single fragment, where its
// parenthesisation is visible. A nil condition is no condition, so a caller
// that may or may not have one needs no branch.
export let where = (...clauses: (Frag | null | undefined)[]): Step =>
  update<Rel>({ conds: push(...clauses.filter((c): c is Frag => !!c)) })

export let group = (by: string): Step => set<Rel>({ by })

export let order = (...sort: string[]): Step =>
  update<Rel>({ sort: push(...sort) })

// The row bound, as a BIND rather than a literal, so a paging limit never
// reaches the text of a statement. Nil is no bound, for the same reason a nil
// condition is no condition.
export let take = (bound: Bind | null | undefined): Step =>
  set<Rel>({ bound: bound ?? null })

// The joined tables as they are spelled after the FROM. Exported because a
// hand-written statement (graph_query.ts's work CTEs) still splices a
// compiled filter's joins into its own text, and that text must be rendered by
// the same door as a whole relation's or the two drift.
export let joined = (joins: Join[]): string =>
  joins.map((j) => ` left join ${j.source} on ${j.on}`).join('')

// The relation as one statement. Params come out in the order SQLite binds
// them: the conditions in the order they were added, then the bound — joins
// carry none, and a grouping or ordering is always an expression over columns
// already named.
//
// A relation with no condition renders `where 1` rather than dropping the
// clause, because that is what sql.ts has always emitted. A relation with no
// projection selects `*`.
export let toSql = (rel: Rel): Frag => ({
  sql: `select${rel.uniq ? ' distinct' : ''} ` +
    `${rel.cols.length ? rel.cols.join(', ') : '*'}` +
    ` from ${rel.from}${joined(rel.joins)}` +
    ` where ${
      rel.conds.length ? rel.conds.map((c) => c.sql).join(' and ') : '1'
    }` +
    (rel.by ? ` group by ${rel.by}` : '') +
    (rel.sort.length ? ` order by ${rel.sort.join(', ')}` : '') +
    (rel.bound == null ? '' : ' limit ?'),
  params: [
    ...rel.conds.flatMap((c) => c.params),
    ...(rel.bound == null ? [] : [rel.bound]),
  ],
})

// The relation, run. The other consumer of the value, kept beside the renderer
// rather than inside it: a caller that only wants the text never opens a
// connection, and the day the store seam goes async (D-33198) this is the one
// function that awaits — the builders and the combinators stay as they are.
export let run = <T extends object = Record<string, unknown>>(
  db: Sql,
  rel: Rel,
): T[] => {
  let { sql, params } = toSql(rel)
  return db.prepare(sql).all<T>(...params)
}
