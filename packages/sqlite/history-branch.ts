// A branch's writes touch its version rows, leaving main's rows alone.
import {
  among,
  and,
  col,
  eq,
  exists,
  type Expr,
  lit,
  type Query,
  select,
  type Stmt,
  table,
  val,
} from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { type Kept, stored } from './history.ts'
import { beside, BRANCH, FROM, TO } from './history-shapes.ts'
type W = Extract<Stmt, { t: 'insert' | 'update' | 'delete' }>
type Insert = Extract<W, { t: 'insert' }>

// An insert's query with more columns after its own.
let appended = (q: Query, es: Expr[]): Query => {
  if (q.t != 'select') throw new Error('a versioned insert from a compound')
  return { ...q, cols: [...q.cols ?? [], ...es] }
}

// The entities an insert names: its rows' owners, or its query's.
let entities = (w: Insert): Expr[] | Query => {
  let at = w.cols?.indexOf('entity') ?? -1
  if (at < 0) {
    throw new Error(`a versioned insert into ${w.into} names no owner`)
  }
  if (w.rows) return w.rows.map((r) => r[at])
  if (w.q?.t != 'select') throw new Error('a versioned insert from a compound')
  return { ...w.q, with: w.q.with ?? w.with, cols: [w.q.cols![at]] }
}

// ---- writes on a branch ----

// The branch's open row of the entity a write's condition names.
let open = (branch: number) =>
  and(eq(col(BRANCH), val(branch)), eq(col(TO), lit(0)))

/**
 * A write on branch `b`, as a write to the branch's rows beside. Every read in
 * it names the live table, which on a branch's connection is the branch's view
 * of it (./mode.ts), so it sees the branch.
 *
 * Before any write, each entity's component as the branch sees it is copied
 * into an open row of the branch's own, where it has none: an insert then
 * lands on that row as it would on main's, an update changes it, and a removal
 * closes it, so it goes on hiding main's. A branch keeps no versions of its
 * own: its rows are what it holds now, and what it removed.
 */
export let branched = (
  vocab: Vocab,
  comp: string,
  w: W,
  b: number,
  tx: number,
): Kept => {
  let cols = stored(vocab, comp)
  let to = beside(comp)
  let seed = (where: Expr): W => ({
    t: 'insert',
    or: 'ignore',
    into: to,
    cols: ['entity', ...cols, BRANCH, FROM, TO],
    q: select({
      cols: [
        col('entity'),
        ...cols.map((c) => col(c)),
        val(b),
        val(tx),
        lit(0),
      ],
      from: table(comp),
      where,
    }),
  })
  if (w.t == 'insert') {
    let e = entities(w)
    return {
      before: [seed(among(col('entity'), e))],
      write: {
        ...w,
        into: to,
        cols: [...w.cols!, BRANCH, FROM, TO],
        ...w.rows
          ? { rows: w.rows.map((r) => [...r, val(b), val(tx), lit(0)]) }
          : {},
        ...w.q ? { q: appended(w.q, [val(b), val(tx), lit(0)]) } : {},
        ...w.upsert
          ? {
            upsert: w.upsert.map((u) => ({
              ...u,
              on: [col('entity'), col(BRANCH), col(TO)],
            })),
          }
          : {},
      },
    }
  }
  let where = w.where ?? lit(true)
  let mine = and(where, open(b))
  if (w.t == 'update') {
    return {
      before: [seed(where)],
      write: {
        t: 'update',
        table: to,
        set: { ...w.set, [FROM]: val(tx) },
        where: mine,
        ...w.returning ? { returning: w.returning } : {},
      },
    }
  }
  // A row this transaction both opened and closed already has its closed
  // twin at `tx`; it goes. Any other open row is closed where it stands.
  let twin = exists(select({
    cols: [lit(1)],
    from: table(to, '__twin'),
    where: and(
      eq(col('entity', '__twin'), col('entity', to)),
      eq(col(BRANCH, '__twin'), val(b)),
      eq(col(TO, '__twin'), val(tx)),
    ),
  }))
  return {
    before: [seed(where), { t: 'delete', from: to, where: and(mine, twin) }],
    write: {
      t: 'update',
      table: to,
      set: { [TO]: val(tx) },
      where: mine,
      ...w.returning ? { returning: w.returning } : {},
    },
  }
}
