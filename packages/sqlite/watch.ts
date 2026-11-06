// Rows other connections add, heard as they land. The driver hears its file
// change (@yaks/sql `Driver.watch`); the component's table then answers its
// newest row from the end of its key, one seek, and one newer than the last
// it answered is a row added since. An entity's id is never reused, so a
// newer row has a higher one. A driver that owns its database alone hears
// nothing: what it adds, its own writer already knows.
import { as, col, type Driver, fn, select, table } from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { tables } from './layout.ts'

/** Call `heard` soon after another connection commits a new row of
 * `comp`. */
export let watch = (
  driver: Driver,
  vocab: Vocab,
  comp: string,
  heard: () => void,
): () => void => {
  if (!driver.watch || !tables(vocab).includes(comp)) return () => {}
  let newest = () =>
    Number(
      driver.query(select({
        cols: [as(fn('max', col('entity')), 'newest')],
        from: table(comp),
      }))[0]?.newest ?? 0,
    )
  let last = newest()
  return driver.watch(() => {
    let now = newest()
    let more = now > last
    last = now
    if (more) heard()
  })
}
