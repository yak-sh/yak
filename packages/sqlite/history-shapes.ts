// History's archetypes: an indexed table of the component memberships each
// version write already knows. A past or branch read names its owners here,
// rather than asking every component view whether it holds them.
import {
  and,
  as,
  col,
  type Delete,
  type Driver,
  eq,
  exists,
  fn,
  from,
  iff,
  type Insert,
  isNull,
  left,
  lit,
  type Mode,
  not,
  oneOf,
  op,
  or,
  over,
  select,
  type Stmt,
  table,
  type Update,
  val,
} from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { tablesOf } from '@yaks/archetype/sets'

export let FROM = '$from', TO = '$to', BRANCH = '$branch', BESIDE = '$versions'
export let beside = (comp: string): string => `${comp}${BESIDE}`
let SHAPES = '$archetype$versions'
let columns = ['entity', 'component', BRANCH, FROM, TO]

export let shapeDdl: Stmt[] = [{
  t: 'create table',
  name: SHAPES,
  ifNot: true,
  cols: [
    {
      name: 'entity',
      type: 'integer',
      notNull: true,
      ref: { table: 'entity', cols: ['id'] },
    },
    { name: 'component', type: 'text', notNull: true },
    { name: BRANCH, type: 'integer', notNull: true },
    { name: FROM, type: 'integer' },
    { name: TO, type: 'integer', notNull: true },
  ],
}, {
  t: 'create index',
  name: `${SHAPES}.key`,
  on: SHAPES,
  ifNot: true,
  unique: true,
  cols: ['entity', 'component', BRANCH, TO].map((c) => col(c)),
}]

// Repair a missing historical index once. Adjacent value versions are one
// membership span: editing a property's value does not change an archetype.
let copied = (comp: string): Insert => {
  let key = [col('entity'), col(BRANCH)]
  let order = [fn('coalesce', col(FROM), lit(0))]
  let starts = select({
    cols: [
      ...key,
      col(FROM),
      col(TO),
      as(
        iff(
          op('is', over(fn('lag', col(TO)), key, order), col(FROM)),
          lit(0),
          lit(1),
        ),
        'start',
      ),
    ],
    from: table(beside(comp)),
  })
  let spans = select({
    cols: [
      ...key,
      col(FROM),
      col(TO),
      as(over(fn('sum', col('start')), key, order), 'span'),
    ],
    from: from(starts, 'starts'),
  })
  return {
    t: 'insert',
    into: SHAPES,
    cols: columns,
    q: select({
      cols: [
        col('entity'),
        lit(comp),
        col(BRANCH),
        iff(
          eq(fn('count', col(FROM)), fn('count', lit(1))),
          fn('min', col(FROM)),
          lit(null),
        ),
        iff(eq(fn('min', col(TO)), lit(0)), lit(0), fn('max', col(TO))),
      ],
      from: from(spans, 'spans'),
      group: [...key, col('span')],
    }),
  }
}
export let shapeSeeds = (
  comps: string[],
  made: (name: string) => boolean,
): Stmt[] =>
  comps.filter((comp) => made(SHAPES) || made(beside(comp))).map(copied)

/** A row's membership changed. Property edits keep its open span; only a
 * birth or removal writes the history of its archetype. */
export let shaped = (
  comp: string,
  owners: number[],
  branch: number,
  tx: number,
  present: boolean,
): (Insert | Update | Delete)[] => {
  if (!owners.length) return []
  let own = and(
    oneOf(col('entity'), owners),
    eq(col('component'), lit(comp)),
    eq(col(BRANCH), val(branch)),
  )
  if (present) {
    return [{
      t: 'insert',
      into: SHAPES,
      cols: columns,
      q: select({
        cols: [col('id', 'e'), lit(comp), val(branch), val(tx), lit(0)],
        from: table('entity', 'e'),
        where: and(
          oneOf(col('id', 'e'), owners),
          not(exists(select({
            cols: [lit(1)],
            from: table(SHAPES, 's'),
            where: and(
              eq(col('entity', 's'), col('id', 'e')),
              eq(col('component', 's'), lit(comp)),
              eq(col(BRANCH, 's'), val(branch)),
              eq(col(TO, 's'), lit(0)),
            ),
          }))),
        ),
      }),
    }]
  }
  return [
    {
      t: 'delete',
      from: SHAPES,
      where: and(
        own,
        eq(col(TO), lit(0)),
        exists(select({
          cols: [lit(1)],
          from: table(SHAPES, 'closed'),
          where: and(
            eq(col('entity', 'closed'), col('entity', SHAPES)),
            eq(col('component', 'closed'), lit(comp)),
            eq(col(BRANCH, 'closed'), val(branch)),
            eq(col(TO, 'closed'), val(tx)),
          ),
        })),
      ),
    },
    {
      t: 'update',
      table: SHAPES,
      set: { [TO]: val(tx) },
      where: and(own, eq(col(TO), lit(0))),
    },
    // A first branch removal must shadow the main row even if the branch never
    // opened its own membership span.
    ...branch
      ? [{
        t: 'insert' as const,
        or: 'ignore' as const,
        into: SHAPES,
        cols: columns,
        rows: owners.map((
          id,
        ) => [val(id), lit(comp), val(branch), val(tx), val(tx)]),
      }]
      : [],
  ]
}

/** The table sets for these owners at this time. Branch rows override only
 * the components that branch wrote; unversioned components still follow main. */
export let pastShapes = (
  driver: Driver,
  vocab: Vocab,
  ids: number[],
  names: readonly string[],
  mode: Mode,
): Map<number, string[]> => {
  let found = new Map(ids.map((id) => [id, new Set<string>()]))
  if (!ids.length) return new Map()
  let branch = 'branch' in mode ? mode.branch : 0
  let at = 'at' in mode ? mode.at : mode.fork
  let historical = and(
    eq(col(BRANCH), lit(0)),
    or(isNull(col(FROM)), op('<=', col(FROM), val(at))),
    or(eq(col(TO), lit(0)), op('>', col(TO), val(at))),
  )
  let rows = driver.query(select({
    cols: columns.map((c) => col(c)),
    from: table(SHAPES),
    where: and(
      oneOf(col('entity'), ids),
      branch ? or(historical, eq(col(BRANCH), val(branch))) : historical,
    ),
  }))
  for (let row of rows) {
    if (Number(row[BRANCH]) == 0) {
      found.get(Number(row.entity))!.add(String(row.component))
    }
  }
  // The only live tables a past read needs are those declared exempt. Their
  // owner's current archetype names them; the component tables are not asked.
  for (
    let row of driver.query(select({
      cols: [col('id', 'e'), col('tables', 'a')],
      from: { t: 'table', name: 'entity', schema: 'main', as: 'e' },
      joins: [
        left(
          { t: 'table', name: 'archetype', schema: 'main', as: 'a' },
          eq(col('entity', 'a'), col('archetype', 'e')),
        ),
      ],
      where: oneOf(col('id', 'e'), ids),
    }))
  ) {
    for (let name of tablesOf(row.tables ?? '[]')) {
      if (vocab.comp(name)?.journal === false) {
        found.get(Number(row.id))!.add(name)
      }
    }
  }
  // Any branch row, closed or open, shadows main's component. Its open row
  // says it holds it now, even if the same transaction closed another row.
  let own = rows.filter((r) => Number(r[BRANCH]) == branch && branch != 0)
  for (let r of own) found.get(Number(r.entity))!.delete(String(r.component))
  for (let r of own) {
    if (Number(r[TO]) == 0) {
      found.get(Number(r.entity))!.add(String(r.component))
    }
  }
  let allowed = new Set(names)
  return new Map(
    [...found].map((
      [id, held],
    ) => [id, [...held].filter((n) => allowed.has(n))]),
  )
}
