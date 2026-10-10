// The SELECT half of an installed store. It shares the compiler, component
// gathers and snapshot rules with storage(), without importing its writers,
// schema installer, migrations or diagnostics.
import type { BindOpts, Driver } from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import type { ReadStorage } from '@yaks/graph/read'
import { EPOCH, meta } from './meta.ts'
import { get, read, rows, tagOf } from './read.ts'
import { unit } from './unit.ts'

/** Bind computed components to this installed store's lineage epoch once. */
export let options = <T extends BindOpts>(driver: Driver, base: T): () => T => {
  let tagged: T | undefined
  return () => {
    if (tagged || !base.backed) return tagged ?? base
    let e = meta(driver).get(EPOCH)
    if (!e) return base
    let backed = Object.fromEntries(
      Object.entries(base.backed).map((
        [c, b],
      ) => [c, { ...b, tag: tagOf(e, c) }]),
    )
    return tagged = { ...base, backed }
  }
}

/** Read an already-installed database. No schema is created or repaired, and
 * no mutation methods are exposed. Each operation sees one committed snapshot. */
export let reader = (
  driver: Driver,
  vocab: Vocab,
  base: BindOpts = {},
): ReadStorage => {
  let opts = options(driver, base)
  return {
    read: (q, o, comps) =>
      unit(
        driver,
        () => read(driver, vocab, q, { ...opts(), ...o }, comps),
        'read',
      ),
    rows: (q, o) => rows(driver, vocab, q, { ...opts(), ...o }),
    get: (ids, comps) =>
      ids.length
        ? unit(driver, () => get(driver, vocab, ids, opts(), comps), 'read')
        : [],
  }
}
