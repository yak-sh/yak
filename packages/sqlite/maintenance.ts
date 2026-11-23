// Row-dependent installation is a sequence of units, separate from opening.
// The persisted cursor makes a reset resume primary-key pages, even before the
// pointer index exists. Ordinary reads use the component tables until it ends.
// Once that index stands, a pass reads only the owners it names as strays
// (./archetype.ts `strays`), and a cursor already part way through the spine
// stops there: a schema change leaves a classified spine alone. A store whose
// history began paced takes its live rows as their first versions here, a
// page of entities a unit (./history.ts `seedPage`).
import {
  as,
  col,
  type Driver,
  fn,
  gt,
  lit,
  oneOf,
  revision,
  select,
  table,
  val,
} from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { backfill, classify, pointable, presence, strays } from './archetype.ts'
import { beside, SEEDING, type Seeding, seedPage } from './history.ts'
import { needless } from './ddl.ts'
import { meta } from './meta.ts'
import { componentTables, objects } from './physical.ts'
import { OWED, owed } from './owe.ts'
import { unit } from './unit.ts'

export let CLASSIFYING = 'archetype:pending'
let PAGE = 512

// How many rows a table holds at most: its last rowid, one row read. A
// Durable Object bills `count(*)` every row it counts, so a look at an owed
// index on a 940,000-row spine read the spine whole, twice an alarm, and
// 221 million rows in 13 minutes (2026-11-13).
let most = (driver: Driver, name: string) =>
  Number(
    driver.query(
      select({ cols: [as(fn('max', col('rowid')), 'n')], from: table(name) }),
    )[0]?.n ?? 0,
  )

export let maintenance = (driver: Driver, vocab: Vocab) => {
  let marks = meta(driver)
  let classifying = () => marks.get(CLASSIFYING) != null
  // Asked before every read the store plans, and answered by two reads of
  // `server_meta`: kept until the connection's data moves (@yaks/sql
  // `revision`), which every write, rollback, DDL and other connection's
  // commit does.
  let known: { at: number; pending: boolean } | undefined
  let pending = () => {
    let at = revision(driver, 'data')
    if (known?.at === at) return known.pending
    let pending = classifying() ||
      owed(driver).some((w) =>
        w.kind == 'index' && w.stmt.on == 'entity' &&
        w.stmt.cols.some((c) => c.t == 'col' && c.name == 'archetype')
      )
    known = { at, pending }
    return pending
  }
  let page = (after = 0, limit = PAGE) =>
    driver.query(select({
      cols: [col('id'), col('eid'), col('archetype')],
      from: table('entity'),
      where: gt(col('id'), val(after)),
      order: [col('id')],
      limit: lit(limit),
    }))
  // A pass is owed by a spine the pointer index does not cover yet, or by the
  // strays it names: every install whose schema moved prepares, and one that
  // only added a table leaves a classified spine unread.
  let prepare = () => {
    if (classifying() || !page(0, 1).length) return
    if (!pointable(driver) || strays(driver, 1).length) {
      marks.set(CLASSIFYING, 'metadata')
    }
  }
  let held = (ids: number[]) =>
    presence(
      (s) => driver.query(s),
      componentTables(driver),
      new Map(ids.map((id) => [id, [] as string[]])),
      (c) => ({ where: oneOf(c, ids) }),
    )
  let work = (
    admit: (written: number) => boolean,
    seedRows = PAGE,
  ): boolean => {
    if (classifying()) {
      let at = marks.get(CLASSIFYING)
      let indexes =
        objects(driver, { type: 'index', tbl_name: 'entity' }).length
      if (at == 'metadata') {
        let n = most(driver, 'archetype')
        if (!admit((n + 2) * (indexes * 3 + 8))) return false
        unit(driver, () => {
          backfill(driver, false)
          marks.set(CLASSIFYING, '0')
        })
        return true
      }
      // Under the pointer index a page is the strays it names, which
      // classifying moves out; without it, the primary-key page past the
      // cursor.
      let pointed = pointable(driver)
      let rows = pointed ? strays(driver, PAGE) : page(Number(at))
      let tables = new Set(componentTables(driver))
      // Worst case: every owner has a distinct set, requiring a descriptor,
      // its spine and pointer, as well as the owner's indexed pointer write.
      if (!admit((rows.length + 2) * (indexes * 3 + 8))) return false
      unit(driver, () => {
        classify(
          driver,
          rows.map((r) => String(r.eid)),
          (_, pointed) =>
            pointed?.every((t) => tables.has(t)) ? [...pointed] : undefined,
        )
        if (rows.length < PAGE) marks.del(CLASSIFYING)
        else if (!pointed) marks.set(CLASSIFYING, String(rows.at(-1)!.id))
      })
      return true
    }
    let owing = marks.get(SEEDING)
    if (owing) {
      let { comps, after } = JSON.parse(owing) as Seeding
      // Each row's version and its membership, with every index of both: a
      // unit takes a page of rows, across as many components as it reaches.
      let indexes =
        objects(driver, { type: 'index', tbl_name: beside(comps[0]) }).length
      if (!admit((seedRows + 2) * (indexes + 3))) return false
      unit(driver, () => {
        let left = seedRows
        while (left > 0 && comps.length) {
          let { taken, last } = seedPage(driver, vocab, comps[0], after, left)
          left -= taken
          if (last == null) [comps, after] = [comps.slice(1), 0]
          else after = last
        }
        if (comps.length) marks.set(SEEDING, JSON.stringify({ comps, after }))
        else marks.del(SEEDING)
      })
      return true
    }
    // An index owed before the install stopped building it (./ddl.ts
    // `needless`) is forgotten unbuilt: built, it writes a row per entity.
    for (let w of owed(driver)) {
      if (w.kind != 'index') continue
      let needed = !needless(driver, w.stmt)
      if (needed && !admit(most(driver, w.stmt.on) + 4)) continue
      unit(driver, () => {
        if (needed) driver.query(w.stmt)
        marks.del(`${OWED}${w.kind}:${w.name}`)
      })
      return true
    }
    return false
  }
  return { pending, prepare, held, work }
}
