// Row-dependent installation is a sequence of units, separate from opening.
// The persisted cursor makes a reset resume primary-key pages, even before the
// pointer index exists. Ordinary reads use the component tables until it ends.
import {
  as,
  col,
  count,
  type Driver,
  gt,
  lit,
  oneOf,
  select,
  table,
  val,
} from '@yaks/sql'
import { backfill, classify, presence } from './archetype.ts'
import { meta } from './meta.ts'
import { componentTables, objects } from './physical.ts'
import { OWED, owed } from './owe.ts'
import { unit } from './unit.ts'

export let CLASSIFYING = 'archetype:pending'
let PAGE = 512

export let maintenance = (driver: Driver, number: () => boolean) => {
  let marks = meta(driver)
  let classifying = () => marks.get(CLASSIFYING) != null
  let pending = () =>
    classifying() ||
    owed(driver).some((w) =>
      w.kind == 'index' && w.stmt.on == 'entity' &&
      w.stmt.cols.some((c) => c.t == 'col' && c.name == 'archetype')
    )
  let page = (after = 0, limit = PAGE) =>
    driver.query(select({
      cols: [col('id'), col('eid'), col('archetype')],
      from: table('entity'),
      where: gt(col('id'), val(after)),
      order: [col('id')],
      limit: lit(limit),
    }))
  let prepare = () => {
    if (!classifying() && page(0, 1).length) marks.set(CLASSIFYING, 'metadata')
  }
  let held = (ids: number[]) =>
    presence(
      (s) => driver.query(s),
      componentTables(driver),
      new Map(ids.map((id) => [id, [] as string[]])),
      (c) => ({ where: oneOf(c, ids) }),
    )
  let work = (admit: (written: number) => boolean): boolean => {
    if (classifying()) {
      let at = marks.get(CLASSIFYING)
      let indexes =
        objects(driver, { type: 'index', tbl_name: 'entity' }).length
      if (at == 'metadata') {
        let n = Number(
          driver.query(
            select({ cols: [as(count(), 'n')], from: table('archetype') }),
          )[0].n,
        )
        if (!admit((n + 2) * (indexes * 3 + 8))) return false
        unit(driver, () => {
          backfill(driver, number(), false)
          marks.set(CLASSIFYING, '0')
        })
        return true
      }
      let rows = page(Number(at))
      let tables = new Set(componentTables(driver))
      // Worst case: every owner has a distinct set, requiring a descriptor,
      // its spine and pointer, as well as the owner's indexed pointer write.
      if (!admit((rows.length + 2) * (indexes * 3 + 8))) return false
      unit(driver, () => {
        classify(
          driver,
          rows.map((r) => String(r.eid)),
          number(),
          (_, pointed) =>
            pointed?.every((t) => tables.has(t)) ? [...pointed] : undefined,
        )
        if (rows.length < PAGE) marks.del(CLASSIFYING)
        else marks.set(CLASSIFYING, String(rows.at(-1)!.id))
      })
      return true
    }
    for (let w of owed(driver)) {
      if (w.kind != 'index') continue
      // COUNT(*) reads SQLite's btree size without projecting every owner.
      let n = Number(
        driver.query(
          select({ cols: [as(count(), 'n')], from: table(w.stmt.on) }),
        )[0].n,
      )
      if (!admit(n + 4)) continue
      unit(driver, () => {
        driver.query(w.stmt)
        marks.del(`${OWED}${w.kind}:${w.name}`)
      })
      return true
    }
    return false
  }
  return { pending, prepare, held, work }
}
