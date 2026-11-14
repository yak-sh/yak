// A store's branches (D-395): rows of its branch table. Making one writes a
// row and copies nothing; a branch's rows live beside the live tables, in
// `<comp>$versions` and the archetypes' versions, under its id, and dropping
// it deletes them. Reading and writing on one is a connection of its own
// (./mode.ts), which its host opens.
//
// What a branch changed is read on main's own connection, from those rows:
// for each entity's component the branch holds a row of, its open row (or
// none, where the branch removed it), main's version as of the fork, and the
// live row. Merging them is the history plugin's (@yaks/journal).

import {
  and,
  col,
  type Driver,
  eq,
  type Expr,
  isNull,
  lit,
  oneOf,
  op,
  or,
  select,
  sub,
  table,
  val,
} from '@yaks/sql'
import type { BindOpts } from '@yaks/sql/query'
import type { Vocab } from '@yaks/vocab'
import { eidOf } from '@yaks/archetype/sets'
import type { Branch, Branches, Change } from '@yaks/graph/storage'
import {
  BESIDE,
  beside,
  BRANCH,
  BRANCHES,
  covered,
  FROM,
  type History,
  keeps,
  type Mode,
  TO,
} from './history.ts'
import { tables } from './physical.ts'
import { described } from './archetype.ts'
import { rowsOf } from './read.ts'
import { unraised } from './raise.ts'

// The branch table's rows `where` matches, oldest first, as branches.
let rows = (driver: Driver, where?: Expr): Branch[] =>
  driver.query(select({
    cols: [col('id'), col('fork'), col('at')],
    from: { t: 'table', name: BRANCHES },
    ...where ? { where } : {},
    order: [col('id')],
  })).map((row) => ({
    id: Number(row.id),
    fork: Number(row.fork),
    at: String(row.at),
  }))

/** Make a branch of main at its newest transaction: one row, nothing copied.
 * Answers its id and the transaction it forked at. */
export let branch = (
  driver: Driver,
  history: History,
): { branch: number; fork: number } => {
  let fork = Number(driver.query(history.tip)[0]?.id ?? 0)
  let [row] = driver.query({
    t: 'insert',
    into: BRANCHES,
    cols: ['parent', 'fork', 'at'],
    rows: [[lit(0), val(fork), val(new Date().toISOString())]],
    returning: [col('id')],
  })
  return { branch: Number(row.id), fork }
}

/** The branch `id`, as a mode: where it forked. Undefined for none. */
export let branchOf = (driver: Driver, id: number): Mode | undefined => {
  let [b] = rows(driver, eq(col('id'), val(id)))
  return b ? { branch: id, fork: b.fork } : undefined
}

/**
 * What branch `b` changed since its fork, read with `opts` as any read is:
 * each entity's component it holds a row of, at the fork, on the branch and on
 * main now. A component main keeps no versions of is left out, and so is the
 * archetype, which is the store's own.
 */
export let changes = (
  driver: Driver,
  vocab: Vocab,
  b: Branch,
  opts: BindOpts = {},
): Change[] => {
  let absent = new Set(unraised(driver, vocab))
  let out: Change[] = []
  for (let comp of covered(vocab)) {
    if (comp == 'archetype' || !keeps(vocab, comp)) continue
    let to = beside(comp)
    let ids = driver.query(select({
      distinct: true,
      cols: [col('entity')],
      from: table(to),
      where: eq(col(BRANCH), val(b.id)),
    })).map((r) => Number(r.entity))
    if (!ids.length) continue
    let open = rowsOf(
      driver,
      vocab,
      comp,
      to,
      and(
        eq(col(BRANCH, comp), val(b.id)),
        eq(col(TO, comp), lit(0)),
        oneOf(col('entity', comp), ids),
      ),
      opts,
    )
    let fork = rowsOf(
      driver,
      vocab,
      comp,
      to,
      and(
        eq(col(BRANCH, comp), lit(0)),
        or(isNull(col(FROM, comp)), op('<=', col(FROM, comp), val(b.fork))),
        or(eq(col(TO, comp), lit(0)), op('>', col(TO, comp), val(b.fork))),
        oneOf(col('entity', comp), ids),
      ),
      opts,
    )
    let main = absent.has(comp) ? new Map() : rowsOf(
      driver,
      vocab,
      comp,
      comp,
      oneOf(col('entity', comp), ids),
      opts,
    )
    let eids = new Map(
      driver.query(select({
        cols: [col('id'), col('eid')],
        from: table('entity'),
        where: oneOf(col('id'), ids),
      })).map((r) => [Number(r.id), String(r.eid)]),
    )
    for (let id of ids) {
      out.push({
        eid: eids.get(id)!,
        comp,
        fork: fork.get(id) ?? null,
        branch: open.get(id) ?? null,
        main: main.get(id) ?? null,
      })
    }
  }
  return out
}

/** The branches of the store with history over `driver`, its changes read
 * with `opts` as its reads are. Making one makes sure main has the archetype
 * of an entity holding nothing, which an entity the branch makes is on main. */
export let branching = (
  driver: Driver,
  vocab: Vocab,
  history: History,
  opts: () => BindOpts = () => ({}),
): Branches => ({
  make: () => {
    described(driver, [])
    return rows(driver, eq(col('id'), val(branch(driver, history).branch)))[0]
  },
  list: () => rows(driver),
  drop: (id) => {
    let mine = eq(col(BRANCH), val(id))
    for (let name of tables(driver).filter((n) => n.endsWith(BESIDE))) {
      driver.query({ t: 'delete', from: name, where: mine })
    }
    driver.query({ t: 'delete', from: BRANCHES, where: eq(col('id'), val(id)) })
  },
  changes: (id) => {
    let [b] = rows(driver, eq(col('id'), val(id)))
    if (!b) throw new Error(`no branch ${id}`)
    return changes(driver, vocab, b, opts())
  },
})

/** The entities a branch just made, pointed at main's archetype of nothing:
 * a pointer says what an entity holds on main, and on main each holds
 * nothing. Main keeps that archetype from the branch's making (`branching`). */
export let unborn = (driver: Driver, eids: string[]): void => {
  if (!eids.length) return
  driver.query({
    t: 'update',
    table: 'entity',
    set: {
      archetype: sub(select({
        cols: [col('id')],
        from: table('entity'),
        where: eq(col('eid'), val(eidOf([]))),
      })),
    },
    where: and(oneOf(col('eid'), eids), isNull(col('archetype'))),
  })
}
