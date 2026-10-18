// The SELECT half of an installed store. It shares the compiler, component
// gathers and snapshot rules with storage(), without importing its writers,
// mutation pipeline, migrations or diagnostics.
import { type BindOpts, catalogue, type Driver, revision } from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import type { Store } from './mod.ts'
import { EPOCH, meta } from './meta.ts'
import { get, read, rows, tagOf } from './read.ts'
import { unit } from './unit.ts'
import { lacking } from './follow.ts'
import { indexed } from './ddl.ts'

/** Read against the physical schema of this snapshot, not the one that was
 * standing when the command started. Never repair an older vocabulary's
 * dropped columns or indices: another process may have retired them. */
export let options = <T extends BindOpts>(
  driver: Driver,
  vocab: Vocab,
  base: T,
): () => T => {
  let tagged: T | undefined
  let schema: number | undefined
  return () => {
    let current = revision(driver, 'schema')
    if (tagged && schema == current) return tagged
    let inspect = !!driver.file || schema !== undefined
    if (!inspect && !base.backed) {
      schema = current
      return tagged = base
    }
    let behind = inspect
      ? lacking(driver, vocab, base.derived, true)
      : { derived: {}, absent: [] }
    let objects = inspect
      ? new Set(catalogue(driver).map((o) => o.name))
      : undefined
    let missingIndexes = indexed(vocab).flatMap((s) =>
      s.t == 'create index' && objects && !objects.has(s.name) ? [s.name] : []
    )
    let e = base.backed && meta(driver).get(EPOCH)
    let backed = e
      ? Object.fromEntries(
        Object.entries(base.backed!).map((
          [c, b],
        ) => [c, { ...b, tag: tagOf(e, c) }]),
      )
      : base.backed
    schema = current
    return tagged = {
      ...base,
      backed,
      derived: Object.keys(behind.derived).length
        ? { ...base.derived, ...behind.derived }
        : base.derived,
      absent: [...new Set([...base.absent ?? [], ...behind.absent])],
      ...missingIndexes.length ? { missingIndexes } : {},
    }
  }
}

/** Read an already-installed database. No schema is created or repaired, and
 * no mutation methods are exposed. Each operation sees one committed snapshot. */
export let reader = (
  driver: Driver,
  vocab: Vocab,
  base: BindOpts = {},
): Pick<Store, 'read' | 'rows' | 'get'> => {
  let opts = options(driver, vocab, base)
  return {
    read: (q, o, comps) =>
      unit(
        driver,
        () => read(driver, vocab, q, { ...opts(), ...o }, comps),
        'read',
      ),
    rows: (q, o) => rows(driver, vocab, q, { ...opts(), ...o }),
    get: (ids, comps, o) =>
      ids.length
        ? unit(
          driver,
          () => get(driver, vocab, ids, { ...opts(), ...o }, comps),
          'read',
        )
        : [],
  }
}
