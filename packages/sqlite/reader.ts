// The SELECT half of an installed store. It shares the compiler, component
// gathers and snapshot rules with storage(), without importing its writers,
// mutation pipeline, migrations or diagnostics.
import {
  absentDerived,
  type BindOpts,
  derivedOf,
  type Driver,
  revision,
} from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import type { Store } from './mod.ts'
import { EPOCH, meta } from './meta.ts'
import { get, read, rows, tagOf } from './read.ts'
import { unit } from './unit.ts'
import { gotten, metered, named } from './budget.ts'
import { glance, lacked, type Survey, surveyed } from './survey.ts'
import { raisedOnly, unraised } from './raise.ts'

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
  let found: Omit<Survey, 'unlogged'> | undefined
  // The options over what a look found, and the components no write has
  // raised a table for yet.
  let bound = (seen: Omit<Survey, 'unlogged'>, unwritten: string[]): T => {
    let lacks = lacked(vocab, seen)
    let missingIndexes = seen.unindexed
    // The registry stays the one every store of the vocabulary shares, so
    // what is compiled through it is too; only the tags are this store's.
    let e = base.backed && meta(driver).get(EPOCH)
    let tags = e
      ? Object.fromEntries(
        Object.keys(base.backed!).map((c) => [c, tagOf(e, c)]),
      )
      : base.tags
    return absented(vocab, {
      ...base,
      ...tags ? { tags } : {},
      derived: seen.lacking.length
        ? { ...base.derived, ...lacks }
        : base.derived,
      ...missingIndexes.length ? { missingIndexes } : {},
    }, [...seen.absent, ...unwritten])
  }
  return () => {
    let current = revision(driver, 'schema')
    if (tagged && schema == current) return tagged
    // The schema is taken as seen only once its look is done: a look that
    // failed (the storage refused a read) is looked again by the next.
    let seen = (options: T) => {
      schema = current
      return tagged = options
    }
    // A component nothing has written yet has no table (./raise.ts), which
    // the file says without a look at its whole schema.
    let unwritten = unraised(driver, vocab)
    // Where only first writes moved the schema since the last look, what it
    // found stands, but for the tables they made.
    if (found && schema !== undefined && raisedOnly(driver, schema, current)) {
      return seen(bound({ ...found, absent: [] }, unwritten))
    }
    let inspect = !!driver.file || schema !== undefined
    if (!inspect && !base.backed) {
      return seen(unwritten.length ? absented(vocab, base, unwritten) : base)
    }
    // What a writer found when it last looked, where the schema has not
    // moved since (./survey.ts), or else a look at the file now.
    found = inspect
      ? surveyed(driver, vocab, base.derived) ??
        glance(driver, vocab, base.derived)
      : { lacking: [], absent: [], unindexed: [] }
    return seen(bound(found, unwritten))
  }
}

// `o` reading each of `absent` as a component no entity wears: through the
// dialect, and through every derived expression that names its table
// (@yaks/sql `absentDerived`).
let absented = <T extends BindOpts>(
  vocab: Vocab,
  o: T,
  absent: string[],
): T => {
  let all = [...new Set([...o.absent ?? [], ...absent])]
  if (!all.length) return o
  // The vocabulary's own (a status ladder's rungs) among them.
  return {
    ...o,
    absent: all,
    derived: absentDerived(vocab, derivedOf(vocab, o.derived), all),
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
  // Each read is refused past what one read may hold (./budget.ts).
  return {
    read: (q, o, comps) =>
      metered(
        () =>
          unit(
            driver,
            () => read(driver, vocab, q, { ...opts(), ...o }, comps),
            'read',
          ),
        { what: named(q) },
      ),
    rows: (q, o) =>
      metered(() => rows(driver, vocab, q, { ...opts(), ...o }), {
        what: named(q),
      }),
    get: (ids, comps, o) =>
      ids.length
        ? metered(
          () =>
            unit(
              driver,
              () => get(driver, vocab, ids, { ...opts(), ...o }, comps),
              'read',
            ),
          { what: gotten(ids) },
        )
        : [],
  }
}
