// The graves a retention sweep may prune (@yaks/effects `expire`): tombstones
// laid before a moment that nothing in the file refers to any more. Nothing is
// every column keyed to an identity, whichever package made its table (a
// component's owner and references, the journal's, an embedding's), and every
// `keep` reference, which outlives its target's tombstone with no key
// (./ddl.ts). A grave something still names stays: it is that record's
// target. The walk is in identity order, a page at a time, each probe one
// index seek.

import {
  and,
  col,
  type Driver,
  eq,
  exists,
  type Expr,
  field,
  gt,
  join,
  lit,
  lt,
  not,
  revision,
  type Select,
  select,
  table,
  val,
} from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import type { Graves } from '@yaks/graph'
import { TOMBSTONE } from '@yaks/graph/bundle'

/** A table and one of its columns that names an identity. */
export type Referrer = [table: string, column: string]

/** Every column in the file that names an identity: each foreign key to
 * `entity`, wherever it is declared, and each stored `keep` reference. The
 * tombstone's own key is not a referrer. */
export let referrers = (driver: Driver, vocab: Vocab): Referrer[] => {
  let names = driver.query({ t: 'pragma', name: 'table_list' })
    .filter((r) => r.schema == 'main' && r.type == 'table')
    .map((r) => String(r.name))
    .filter((name) => name != TOMBSTONE && !name.startsWith('sqlite_'))
  let keyed = names.flatMap((name) =>
    driver.query({ t: 'pragma', name: 'foreign_key_list', arg: name })
      .filter((r) => r.table == 'entity')
      .map((r): Referrer => [name, String(r.from)])
  )
  let kept = vocab.refProps()
    .filter(([c, p]) => {
      let prop = vocab.prop(c, p)
      return !prop?.computed && !prop?.fk && names.includes(c)
    })
    .map(([c, p]): Referrer => [c, field(p)])
  return [...keyed, ...kept]
}

/** The statement selecting a page of graves laid before `before`, past the
 * identity `after`, that none of `refs` names: each grave's eid and integer
 * id, the walk's cursor. */
export let buriedSql = (
  refs: Referrer[],
  before: string,
  page: { after?: number; limit: number },
): Select => {
  let grave = col('entity', 't')
  let named = ([name, column]: Referrer): Expr =>
    exists(select({
      cols: [lit(1)],
      from: table(name, '__r'),
      where: eq(col(column, '__r'), grave),
    }))
  return select({
    cols: [col('eid', 'e'), col('id', 'e')],
    from: table(TOMBSTONE, 't'),
    joins: [join(table('entity', 'e'), eq(col('id', 'e'), grave))],
    where: and(
      gt(grave, val(page.after ?? 0)),
      lt(col('deleted_at', 't'), val(before)),
      ...refs.map((r) => not(named(r))),
    ),
    order: [grave],
    limit: val(page.limit),
  })
}

/** A store's `buried`, walking graves by integer id: a pruned grave's id
 * still marks where the walk resumes. The referrers are read once while the
 * schema stands. */
export let burying = (driver: Driver, vocab: Vocab) => {
  let held: { at: number; refs: Referrer[] } | undefined
  return (
    before: string,
    page: { after?: string; limit: number },
  ): Graves => {
    let at = revision(driver, 'schema')
    if (held?.at != at) held = { at, refs: referrers(driver, vocab) }
    let found = driver.query(buriedSql(held.refs, before, {
      after: page.after == null ? undefined : Number(page.after),
      limit: page.limit,
    }))
    let eids = found.map((r) => String(r.eid))
    let last = found.at(-1)
    return found.length < page.limit || !last
      ? { eids }
      : { eids, next: String(last.id) }
  }
}
