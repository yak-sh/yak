// Reads: a query in, whole entities out. This is the SELECT half of the
// adapter. The heavy lifting — turning a query into SQL — belongs to the
// sibling packages: @yaks/query parses the query text into an AST, @yaks/vocab
// describes the vocabulary, and @yaks/sql compiles the two into a statement
// that selects the matching entities' ids. This file runs that statement, then
// gathers each matched entity's components into a bundle.
//
// `rows()` is the raw seam: it returns the compiled statement's rows verbatim,
// which is what aggregate and projection queries (a count, a tally, a field
// list) want. `read()` is the whole-entity seam built on it: it takes the ids
// `rows()` yields and reads back every component each entity wears.

import { type And, parse } from '@yaks/query'
import type { Column, Vocab } from '@yaks/vocab'
import {
  type BindOpts,
  compile,
  DEEP,
  type Derived,
  doomSql,
  looseSql,
  narrow,
} from '@yaks/sql'
import type { Driver, Row } from './driver.ts'
import type { Bundle, Comp } from './bundle.ts'
import type { Doom, Gone } from '@yaks/graph'
import { tombstoned } from '@yaks/graph'

// A query, as text or as an already-built AST. Text is parsed; an AST passes
// through, so a caller may hand-build one with @yaks/query's builders.
export type Query = string | And

let ast = (q: Query): And => typeof q == 'string' ? parse(q) : q

// The raw compiled rows for a query — a membership answers `{ eid }` per match,
// an aggregate answers its value/count shape. The values ride as bound params.
export let rows = (
  driver: Driver,
  vocab: Vocab,
  query: Query,
  opts: BindOpts = {},
): Row[] => {
  let { sql, params } = compile(ast(query), vocab, opts)
  return driver.query(sql, params as (string | number)[])
}

// The columns a gather READS: the stored ones, plus any computed column the
// caller registered an expression for. A computed column has no row to read, so
// without a registration there is nothing to select — but with one it is a
// column like any other, and leaving it out of the bundle while the FILTER
// resolves it would make `.task.status=open` select rows whose `status` the
// answer does not carry.
let read1 = (v: Vocab, comp: string, derived: Derived): Column[] =>
  v.columns(comp).map((p) => v.column(comp, p)!)
    .filter((c) => c.persist || derived[`${comp}.${c.prop}`])

// The projected read for one component: each scalar straight off the row, each
// reference joined back to its target's eid, keyed by the owner eid. A
// component with no columns reads a bare presence flag.
//
// A column whose READ differs from its storage is read through its registered
// expression instead — the same `derived` registry @yaks/sql consults when it
// compiles a query (see @yaks/sql/derived.ts). That is what keeps the two
// readers agreeing: a value the filter resolves one way cannot come back
// gathered another. It is also the seam a content-addressed column lands on —
// @yaks/blob registers one override per body column, and the gather returns the
// text rather than the address the row holds.
//
// So the component table is aliased by its OWN NAME here, exactly as the binder
// joins it, and an override's `deps` are LEFT JOINed the same way: a registered
// expression is written once and reads the same in both places.
let project = (
  v: Vocab,
  comp: string,
  derived: Derived,
): { sel: string[]; joins: string[] } => {
  let self = `"${comp}"`
  let sel: string[] = []
  let joins: string[] = []
  let deps = new Set<string>()
  for (let c of read1(v, comp, derived)) {
    let own = derived[`${comp}.${c.prop}`]
    if (own) {
      for (let d of own.deps ?? []) deps.add(d)
      sel.push(`${own.expr(`${self}."entity"`)} as "${c.prop}"`)
    } else if (c.category == 'ref') {
      let a = `r_${c.prop.replaceAll(/[^A-Za-z0-9]/g, '_')}`
      joins.push(`left join entity "${a}" on "${a}".id = ${self}."${c.prop}"`)
      sel.push(`"${a}".eid as "${c.prop}"`)
    } else {
      sel.push(`${self}."${c.prop}" as "${c.prop}"`)
    }
  }
  for (let d of deps) {
    if (d == comp) continue
    joins.push(`left join "${d}" on "${d}"."entity" = ${self}."entity"`)
  }
  return { sel, joins }
}

// One component's read, whatever names its owners: `lead` is what is selected
// before the component's own columns, `owner` the predicate over `o.eid`.
let selectComp = (
  v: Vocab,
  comp: string,
  derived: Derived,
  lead: string[],
  owner: string,
): string => {
  let { sel, joins } = project(v, comp, derived)
  let cols = [...lead, ...(sel.length ? sel : ['1 as present'])]
  return `select ${cols.join(', ')} ` +
    `from "${comp}" join entity o on o.id = "${comp}"."entity" ` +
    `${joins.join(' ')} where ${owner}`
}

/**
 * The SELECT that reads one component of one entity — one `?`, the owner's
 * eid. Exported because gathering a bundle is every SQLite-shaped adapter's
 * job, and they must all read a column the same way: @yaks/d1 sends these
 * statements as one batch instead of one at a time, and nothing else differs.
 */
export let compSql = (
  v: Vocab,
  comp: string,
  derived: Derived = {},
): string => selectComp(v, comp, derived, [], 'o.eid = ?')

/**
 * The column a set-shaped read keys its rows by. Not a component prop — a prop
 * is an identifier, so nothing in a vocabulary can collide with it.
 */
export let OWNER = '@eid'

/**
 * The same read widened from ONE entity to a SET: every entity `sub` names,
 * each row carrying its owner's eid under {@link OWNER}. `sub` is a subquery
 * selecting one `eid` column, and its params bind first.
 *
 * This is what makes a whole read one round trip over a remote database
 * (@yaks/d1 `wholeSql`): the hits are named by the query that found them
 * instead of by eids a first trip had to go and fetch.
 */
export let setSql = (
  v: Vocab,
  comp: string,
  sub: string,
  derived: Derived = {},
): string =>
  selectComp(v, comp, derived, [`o.eid as "${OWNER}"`], `o.eid in (${sub})`)

// The identity of an eid, as stored: its `num`, and whether it is buried.
let spineOf = (
  driver: Driver,
  eid: string,
): { num?: number; dead: boolean } | undefined => {
  let row = driver.query(
    `select e.num as num, t.entity as dead from entity e
       left join tombstone t on t.entity = e.id where e.eid = ?`,
    [eid],
  )[0]
  if (!row) return undefined
  return {
    num: row.num == null ? undefined : Number(row.num),
    dead: row.dead != null,
  }
}

/**
 * Identity, not search: these entities as they stand, whole. A tombstoned one
 * comes back wearing `tombstone` (it is still an identity, just a dead one);
 * an eid no entity wears is simply absent. This is the read `apply()` uses for
 * its precondition guard, where a query would be the wrong question.
 */
export let get = (
  driver: Driver,
  vocab: Vocab,
  eids: string[],
  opts: BindOpts = {},
): Bundle[] =>
  eids.flatMap((eid) => {
    let spine = spineOf(driver, eid)
    if (!spine) return []
    let entity = { eid, ...(spine.num == null ? {} : { num: spine.num }) }
    return [
      spine.dead ? tombstoned(entity) : bundleOf(driver, vocab, eid, opts),
    ]
  })

// Every component an entity wears, gathered into a bundle. Iterates the
// vocabulary's components and keeps only those with a row for this eid. The
// spine `entity` is the identity component: its eid keys the bundle under
// `entity`, never at the root, and its server-minted `num` rides beside the eid
// — a caller ordering or paging a set it holds reads the window from there.
let bundleOf = (
  driver: Driver,
  vocab: Vocab,
  eid: string,
  opts: BindOpts = {},
): Bundle => {
  let spine = spineOf(driver, eid)
  let out: Bundle = {
    entity: { eid, ...(spine?.num == null ? {} : { num: spine.num }) },
  }
  for (let comp of vocab.all) {
    if (comp == 'entity') continue
    let row = driver.query(compSql(vocab, comp, opts.derived), [eid])[0]
    if (!row) continue
    delete (row as Record<string, unknown>).present
    out[comp] = row as Comp
  }
  return out
}

/**
 * The death cascade's whole question, answered by statement rather than walked:
 * everything that dies with these entities, and every soft reference that has
 * to let go of them (@yaks/sql's `doomSql`/`looseSql`). @yaks/graph would
 * otherwise read once per rung of the chain — free here, a round trip each over
 * a network — and that walk is what an adapter unable to compile this still
 * gets.
 *
 * A vocabulary too wide to say in one statement (@yaks/sql `narrow`) is asked
 * in ROUNDS: each statement is transitive within its own tables, so the answer
 * is complete when a round turns up nothing the last one had not.
 *
 * Asked INSIDE the transaction, after the batch's patches have gone in, which
 * is what makes the answer the one the cascade wants: who points at the dying
 * as the batch LEAVES the graph.
 */
export let doom = (driver: Driver, vocab: Vocab, eids: string[]): Doom => {
  let ask = (s: { sql: string; params: (string | number)[] }) =>
    driver.query(s.sql, s.params)
  let depth = new Map<string, number>()
  let gone: Gone[] = []
  let seed = eids
  let base = 0
  for (;;) {
    let fresh: string[] = []
    let least = DEEP
    for (let s of doomSql(vocab, seed)) {
      for (let r of ask(s)) {
        let eid = String(r.eid)
        if (depth.has(eid)) continue
        let rung = base + Number(r.depth)
        depth.set(eid, rung)
        gone.push({ eid, depth: rung })
        fresh.push(eid)
        least = Math.min(least, rung)
      }
    }
    if (narrow(vocab) || !fresh.length) break
    seed = fresh
    base = least
  }
  return {
    gone,
    loose: looseSql(vocab, [...depth.keys()]).flatMap((s) =>
      ask(s).map((r) => ({
        eid: String(r.eid),
        comp: String(r.comp),
        prop: String(r.prop),
      }))
    ),
  }
}

// The matched entities as whole bundles. Built for a membership query — one
// that answers a set of entities; an aggregate query wants `rows()` instead.
export let read = (
  driver: Driver,
  vocab: Vocab,
  query: Query,
  opts: BindOpts = {},
): Bundle[] =>
  rows(driver, vocab, query, opts)
    .filter((r) => r.eid != null)
    .map((r) => bundleOf(driver, vocab, r.eid as string, opts))
