// Large retained fixtures repeat a few stored shapes. Admit one row through
// storage, then copy its complete physical rows in SQLite: the same references,
// blobs and archetype, with the fields that distinguish each owner varied.
// Setup stays outside the measured window, without tens of thousands of JS
// patches and separately prepared statements.
import type { Bundle, Graph } from '@yaks/graph'
import { driver, type DurableStorage } from '@yaks/durable-object'
import {
  as,
  col,
  cross,
  eq,
  type Expr,
  field,
  fn,
  lit,
  lt,
  op,
  select,
  table,
  unionAll,
  val,
} from '@yaks/sql'

export let index = col('n', 'copies')
export let repeatFixture = async (
  graph: Graph,
  storage: DurableStorage,
  count: number,
  sample: Bundle,
  eid: Expr,
  varying: Record<string, Record<string, Expr>> = {},
) => {
  if (!count) return
  await graph.storage.tx((tx) => tx.patch([sample]))
  if (count == 1) return
  let d = driver(storage)
  let prototype = d.query(select({
    from: table('entity'),
    where: eq(col('eid'), val(sample.entity!.eid!)),
  }))[0]
  let top = Number(
    d.query(select({
      cols: [as(fn('max', col('id')), 'top')],
      from: table('entity'),
    }))[0].top,
  )
  // Names and columns come from the installed schema, including encoded/blob
  // fields absent from the bundle's public shape. No second storage layout.
  let components = Object.keys(sample).filter((name) => name != 'entity')
  let columns = new Map(components.map((name) => [
    name,
    d.query({ t: 'pragma', name: 'table_info', arg: name }).map((r) =>
      String(r.name)
    ),
  ]))
  let copies = {
    name: 'copies',
    cols: ['n'],
    recursive: true,
    q: unionAll(
      select({ cols: [lit(1)] }),
      select({
        cols: [op('+', index, lit(1))],
        from: table('copies'),
        where: lt(index, val(count - 1)),
      }),
    ),
  }
  let owner = op('+', val(top), index)
  d.tx!(() => {
    d.query({
      t: 'insert',
      into: 'entity',
      cols: ['id', 'eid', 'archetype'],
      q: select({
        with: [copies],
        cols: [
          owner,
          eid,
          val(prototype.archetype == null ? null : Number(prototype.archetype)),
        ],
        from: table('copies'),
      }),
    })
    for (let [name, names] of columns) {
      d.query({
        t: 'insert',
        into: name,
        cols: names,
        q: select({
          with: [copies],
          cols: names.map((nameOfColumn) =>
            nameOfColumn == 'entity'
              ? owner
              : Object.entries(varying[name] ?? {}).find(([prop]) =>
                field(prop) == nameOfColumn
              )?.[1] ?? col(nameOfColumn, 'sample')
          ),
          from: table('copies'),
          joins: [cross(table(name, 'sample'))],
          where: eq(col('entity', 'sample'), val(Number(prototype.id))),
        }),
      })
    }
  })
}
