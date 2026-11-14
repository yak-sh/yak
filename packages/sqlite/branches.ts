// A store's branches (D-395): rows of its branch table. Making one writes a
// row and copies nothing; a branch's rows live beside the live tables, in
// `<comp>$versions` and the archetypes' versions, under its id, and dropping
// it deletes them. Reading and writing on one is a connection of its own
// (./mode.ts), which its host opens.

import {
  and,
  col,
  type Driver,
  eq,
  type Expr,
  isNull,
  lit,
  oneOf,
  select,
  sub,
  table,
  val,
} from '@yaks/sql'
import { eidOf } from '@yaks/archetype/sets'
import type { Branch, Branches } from '@yaks/graph/storage'
import { BESIDE, BRANCH, BRANCHES, type History, type Mode } from './history.ts'
import { tables } from './physical.ts'
import { described } from './archetype.ts'

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

/** The branches of the store with history over `driver`. Making one makes
 * sure main has the archetype of an entity holding nothing, which an entity
 * the branch makes is on main. */
export let branching = (driver: Driver, history: History): Branches => ({
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
