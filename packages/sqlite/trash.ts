// Recoverable before-images are separate from optional edit history. The
// foreign key keeps a trashed identity out of background orphan collection.
import {
  among,
  and,
  array,
  col,
  type Delete,
  desc,
  type Driver,
  eq,
  type Insert,
  lt,
  oneOf,
  or,
  type Row,
  type Select,
  select,
  sub,
  table,
  val,
} from '@yaks/sql'
import type { Bundle } from '@yaks/graph'
import { type Trash, trashLimit, type TrashPage } from '@yaks/graph/trash'
import type { Vocab } from '@yaks/vocab'
import { decode, stringify } from '@yaks/vocab/wire'

export let TRASH = '_yaks_trash'

/** Save each row once per destructive transaction. */
export let retainSql = (id: string, at: string, bundles: Bundle[]): Insert[] =>
  bundles.map((b) => ({
    t: 'insert',
    or: 'ignore',
    into: TRASH,
    cols: ['batch', 'entity', 'at', 'body'],
    q: select({
      cols: [val(id), col('id'), val(at), val(stringify(b))],
      from: table('entity'),
      where: oneOf(col('eid'), [b.entity.eid]),
    }),
  }))

/** Select every snapshot in a retained transaction touching these identities. */
export let trashSql = (eids?: string[], page: TrashPage = {}): Select => {
  let before = page.before ? val(page.before.at) : page.after
    ? sub(
      select({
        cols: [col('at')],
        from: table(TRASH),
        where: eq(col('batch'), val(page.after)),
        limit: val(1),
      }),
    )
    : undefined
  let batches = select({
    cols: [col('batch')],
    from: table(TRASH),
    distinct: true,
    order: [desc(col('at')), desc(col('batch'))],
    limit: val(trashLimit(page)),
    where: and(
      ...eids
        ? [
          among(
            col('entity'),
            select({
              cols: [col('id')],
              from: table('entity'),
              where: among(col('eid'), array(eids)),
            }),
          ),
        ]
        : [],
      ...page.id ? [eq(col('batch'), val(page.id))] : [],
      ...before
        ? [
          or(
            lt(col('at'), before),
            and(
              eq(col('at'), before),
              lt(col('batch'), val(page.before?.id ?? page.after!)),
            ),
          ),
        ]
        : [],
    ),
  })
  return select({
    cols: [col('batch'), col('at'), col('body')],
    from: table(TRASH),
    where: among(col('batch'), batches),
    order: [desc(col('at')), desc(col('batch'))],
  })
}

/** Decode retained transactions, preserving binary properties. */
export let trashRows = (vocab: Vocab, rows: Row[]): Trash[] => {
  let found = new Map<string, Trash>()
  for (let row of rows) {
    let id = String(row.batch)
    let entry = found.get(id) ?? { id, at: String(row.at), bundles: [] }
    entry.bundles.push(decode(vocab, JSON.parse(String(row.body))))
    found.set(id, entry)
  }
  return [...found.values()]
}

/** Retained transactions touching an identity, newest first. */
export let trashed = (
  driver: Driver,
  vocab: Vocab,
  eids?: string[],
  page?: TrashPage,
): Trash[] =>
  eids?.length === 0 ? [] : trashRows(vocab, driver.query(trashSql(eids, page)))

/** Erase one retained transaction, called only for a deliberate trash purge. */
export let purgeTrashSql = (id: string | string[]): Delete => ({
  t: 'delete',
  from: TRASH,
  where: typeof id == 'string' ? eq(col('batch'), val(id)) : among(
    col('entity'),
    select({
      cols: [col('id')],
      from: table('entity'),
      where: among(col('eid'), array(id)),
    }),
  ),
})
