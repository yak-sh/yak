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
import { type BindOpts, compile } from '@yaks/sql'
import type { Driver, Row } from './driver.ts'
import type { Bundle, Comp } from './bundle.ts'
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

// A component's stored columns (the computed ones have no row to read).
let stored = (v: Vocab, comp: string): Column[] =>
  v.columns(comp).map((p) => v.column(comp, p)!).filter((c) => c.persist)

// The projected read for one component: each scalar straight off the row, each
// reference joined back to its target's eid, keyed by the owner eid. A
// component with no columns reads a bare presence flag.
let readSql = (v: Vocab, comp: string): string => {
  let cols = stored(v, comp)
  let sel: string[] = []
  let joins: string[] = []
  for (let c of cols) {
    if (c.category == 'ref') {
      let a = `r_${c.prop.replaceAll(/[^A-Za-z0-9]/g, '_')}`
      joins.push(`left join entity "${a}" on "${a}".id = t."${c.prop}"`)
      sel.push(`"${a}".eid as "${c.prop}"`)
    } else {
      sel.push(`t."${c.prop}" as "${c.prop}"`)
    }
  }
  return `select ${sel.length ? sel.join(', ') : '1 as present'} ` +
    `from "${comp}" t join entity o on o.id = t.entity ` +
    `${joins.join(' ')} where o.eid = ?`
}

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
): Bundle[] =>
  eids.flatMap((eid) => {
    let spine = spineOf(driver, eid)
    if (!spine) return []
    let entity = { eid, ...(spine.num == null ? {} : { num: spine.num }) }
    return [spine.dead ? tombstoned(entity) : bundleOf(driver, vocab, eid)]
  })

// Every component an entity wears, gathered into a bundle. Iterates the
// vocabulary's components and keeps only those with a row for this eid. The
// spine `entity` is the identity component: its eid keys the bundle under
// `entity`, never at the root, and its server-minted `num` rides beside the eid
// — a caller ordering or paging a set it holds reads the window from there.
let bundleOf = (driver: Driver, vocab: Vocab, eid: string): Bundle => {
  let spine = spineOf(driver, eid)
  let out: Bundle = {
    entity: { eid, ...(spine?.num == null ? {} : { num: spine.num }) },
  }
  for (let comp of vocab.all) {
    if (comp == 'entity') continue
    let row = driver.query(readSql(vocab, comp), [eid])[0]
    if (!row) continue
    delete (row as Record<string, unknown>).present
    out[comp] = row as Comp
  }
  return out
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
    .map((r) => bundleOf(driver, vocab, r.eid as string))
