// Rows other connections add, heard as they land. The driver hears its file
// change (@yaks/sql `Driver.watch`); the component's table then answers its
// newest row from the end of its key, one seek, and one newer than the last
// it answered is a row added since. An entity's id is never reused, so a
// newer row has a higher one. A driver that owns its database alone hears
// nothing: what it adds, its own writer already knows.
import { as, col, type Driver, fn, select, table } from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { tables } from './layout.ts'

/** The newest row of `comp`'s table, one seek: a higher one is a row added
 * since. 0 where nothing has written the table yet, or it names no table. */
export let newest = (driver: Driver, vocab: Vocab, comp: string): number =>
  // A table nothing has written yet stands once a write first names it
  // (./raise.ts); until then it has no newest row.
  tables(vocab).includes(comp) &&
    driver.query({ t: 'pragma', name: 'table_info', arg: comp }).length
    ? Number(
      driver.query(select({
        cols: [as(fn('max', col('entity')), 'newest')],
        from: table(comp),
      }))[0]?.newest ?? 0,
    )
    : 0

/** Call `heard` soon after another connection commits a new row of
 * `comp`. */
export let watch = (
  driver: Driver,
  vocab: Vocab,
  comp: string,
  heard: () => void,
): () => void => {
  if (!driver.watch || !tables(vocab).includes(comp)) return () => {}
  let last = newest(driver, vocab, comp)
  return driver.watch(() => {
    let now = newest(driver, vocab, comp)
    let more = now > last
    last = now
    if (more) heard()
  })
}
