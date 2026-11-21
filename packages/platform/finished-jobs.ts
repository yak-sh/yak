// T-2221. Bounded maintenance for the retained before-images of pool runs.
import { type Bundle, type Comp, comps, type Storage } from '@yaks/graph'
import { after } from '@yaks/fp'
import {
  among,
  and,
  array,
  col,
  type Driver,
  eq,
  gt,
  join,
  select,
  table,
  val,
} from '@yaks/sql'

let trash = '_yaks_trash'
let marks = ['created', 'updated', 'authorship']
let job = (b: Bundle) => {
  let effect = b.effect as Comp | undefined
  return typeof effect?.handler == 'string' &&
    typeof effect.at == 'string' &&
    ['pending', 'failed', 'done'].includes(String(effect.state)) &&
    comps(b).every(([name]) => name == 'effect' || marks.includes(name))
}

export let JOBS = '/finished-jobs'

export type JobPage = {
  after?: number
  phase?: 'trash' | 'done'
  erase?: boolean
}

let holds = (sql: Driver, name: string) =>
  sql.query(select({
    cols: [col('name')],
    from: table('sqlite_schema'),
    where: and(eq(col('name'), val(name)), eq(col('type'), val('table'))),
  })).length > 0

let kept = (sql: Driver, after: number, limit: number) => {
  let owners = select({
    distinct: true,
    cols: [col('entity')],
    from: table(trash),
    where: gt(col('entity'), val(after)),
    order: [col('entity')],
    limit: val(limit),
  })
  let rows = sql.query(select({
    cols: [
      col('entity', 't'),
      col('eid', 'e'),
      col('body', 't'),
      col('deleted_at', 'g'),
    ],
    from: table(trash, 't'),
    joins: [
      join(table('entity', 'e'), eq(col('id', 'e'), col('entity', 't'))),
      {
        how: 'left',
        src: table('tombstone', 'g'),
        on: eq(col('entity', 'g'), col('entity', 't')),
      },
    ],
    where: among(col('entity', 't'), owners),
    order: [col('entity', 't')],
  }))
  let groups = Map.groupBy(rows, (row) => String(row.eid))
  let pure = [...groups].filter(([, snapshots]) =>
    snapshots.every((snapshot) =>
      snapshot.deleted_at != null && job(JSON.parse(String(snapshot.body)))
    )
  )
  let copies = pure.reduce((sum, [, snapshots]) => sum + snapshots.length, 0)
  return {
    cursor: Number(rows.at(-1)?.entity ?? after),
    ended: groups.size < limit,
    targets: pure.map(([eid]) => eid),
    copies,
    spared: rows.length - copies,
  }
}

let done = (sql: Driver, after: number, limit: number) =>
  sql.query(select({
    cols: [col('entity', 'f'), col('eid', 'e')],
    from: table('effect', 'f'),
    joins: [join(table('entity', 'e'), eq(col('id', 'e'), col('entity', 'f')))],
    where: and(
      eq(col('state', 'f'), val('done')),
      gt(col('entity', 'f'), val(after)),
    ),
    order: [col('entity', 'f')],
    limit: val(limit),
  }))

/** Inspect or erase one page. Qualification and erasure share the store's
 * transaction, so a restore or edit cannot turn a selected job into user data
 * between the two. A mixed archive remains recoverable. */
export let finishedJobs = (
  sql: Driver,
  store: Storage,
  value: unknown,
  limit = 25,
) => {
  if (!value || typeof value != 'object') {
    throw RangeError('Invalid finished-job page')
  }
  let page = value as JobPage
  let cursor = page.after ?? 0
  let phase = page.phase ?? 'trash'
  if (
    !Number.isSafeInteger(cursor) || cursor < 0 ||
    !['trash', 'done'].includes(phase) ||
    (page.erase != null && typeof page.erase != 'boolean')
  ) {
    throw RangeError('Invalid finished-job page')
  }
  let empty = { cursor, ended: true, copies: 0, jobs: 0, spared: 0 }
  if (!holds(sql, phase == 'trash' ? trash : 'effect')) return empty
  return store.tx((tx) => {
    if (phase == 'trash') {
      let { cursor: next, ended, copies, spared, targets } = kept(
        sql,
        cursor,
        limit,
      )
      if (page.erase && targets.length && !store.purgeTrash) {
        throw Error('Store has no trash purge')
      }
      return after(
        page.erase && targets.length ? store.purgeTrash!(targets) : undefined,
        () => ({ cursor: next, ended, copies, jobs: 0, spared }),
      )
    }
    let rows = done(sql, cursor, limit)
    return after(tx.get(rows.map((row) => String(row.eid))), (live) => {
      let safe = live.filter((row) =>
        job(row) && (row.effect as Comp).state == 'done'
      )
        .map((row) => row.entity)
      // A standing run may have before-images of a different shape. An
      // erase is safe only if all of those images are bookkeeping too.
      let archived = safe.length && holds(sql, trash)
        ? sql.query(select({
          cols: [col('eid', 'e'), col('body', 't')],
          from: table('entity', 'e'),
          joins: [
            join(table(trash, 't'), eq(col('id', 'e'), col('entity', 't'))),
          ],
          where: among(
            col('eid', 'e'),
            array(safe.map((entity) => entity.eid)),
          ),
        }))
        : []
      let snapshots = Map.groupBy(archived, (row) => String(row.eid))
      let targets = safe.filter((entity) =>
        (snapshots.get(entity.eid) ?? []).every((row) =>
          job(JSON.parse(String(row.body)))
        )
      )
      let copies = targets.reduce(
        (n, entity) => n + (snapshots.get(entity.eid)?.length ?? 0),
        0,
      )
      if (page.erase && targets.length && !tx.discard) {
        throw Error('Store has no bookkeeping erase')
      }
      return after(
        page.erase && targets.length ? tx.discard!(targets) : undefined,
        () => ({
          ...empty,
          cursor: Number(rows.at(-1)?.entity ?? cursor),
          ended: rows.length < limit,
          jobs: targets.length,
          copies,
          spared: rows.length - targets.length,
        }),
      )
    })
  })
}
