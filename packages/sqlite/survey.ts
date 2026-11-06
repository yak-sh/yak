// What a look at a file finds against a vocabulary's schema, kept in the file
// for every opener after the one that looked. A reader reads what the file
// holds (./reader.ts): a property whose column the file's table lacks reads
// as never given, a component whose table it lacks is worn by nothing, and a
// declared index it lacks is not forced. Memory follows other connections'
// writes through the log only where every table it keeps has the log's
// triggers (./written.ts). Finding all that out reads the whole of
// `sqlite_schema` and renders every table's and trigger's statement to
// compare: milliseconds in every process that opens a graph, for an answer
// that changes only when the schema does.
//
// So a writer opening the file records what it finds, as the `server_meta`
// row `surveyed:<print>` (the store's print, ./plan.ts), with the version the
// schema stood at (`pragma schema_version`), and an opener of the same
// vocabulary reads the survey there instead. SQLite moves that version, kept
// in the file's header, on every change to the schema, whoever makes it, so a
// survey is never read past a column dropped, an index built or a table refit
// after it: those find it out of date, and look again, until a writer records
// the next one.

import {
  catalogue,
  type Derived,
  type Driver,
  lit,
  revision,
  tagOf,
} from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { lacking } from './follow.ts'
import { indexed } from './ddl.ts'
import { tables } from './layout.ts'
import { meta, SURVEYED, surveyedAt } from './meta.ts'
import { plan } from './plan.ts'
import { unit } from './unit.ts'
import { follows } from './written.ts'

/** What a look at a file finds against a vocabulary's schema. */
export type Survey = {
  /** each stored property, as `comp.prop`, whose column the file's table
   * lacks */
  lacking: string[]
  /** each component whose table the file lacks */
  absent: string[]
  /** each declared index the file lacks */
  unindexed: string[]
  /** each of the spine, the graves and the component tables whose writes the
   * log does not follow */
  unlogged: string[]
}

// The tables whose writes the log is asked to follow: the store's own.
let logs = (vocab: Vocab) => ['entity', 'tombstone', ...tables(vocab)]

/** What a reader binds over the file: the survey's properties, read as never
 * given. */
export let lacked = (
  vocab: Vocab,
  survey: Pick<Survey, 'lacking'>,
): Derived =>
  Object.fromEntries(survey.lacking.map((key) => {
    let at = key.indexOf('.')
    let c = vocab.prop(key.slice(0, at), key.slice(at + 1))!
    return [key, { tag: tagOf(c), expr: () => lit(null) }]
  }))

/** What a reader asks of the file itself: its tables, columns and indexes,
 * and not the log's triggers. */
export let glance = (
  driver: Driver,
  vocab: Vocab,
  derived?: Derived,
): Omit<Survey, 'unlogged'> => {
  let behind = lacking(driver, vocab, derived, true)
  let objects = new Set(catalogue(driver).map((o) => o.name))
  return {
    lacking: Object.keys(behind.derived),
    absent: behind.absent,
    unindexed: indexed(vocab).flatMap((s) =>
      s.t == 'create index' && !objects.has(s.name) ? [s.name] : []
    ),
  }
}

/** The file looked at, all of it. */
export let look = (
  driver: Driver,
  vocab: Vocab,
  derived?: Derived,
): Survey => ({
  ...glance(driver, vocab, derived),
  unlogged: logs(vocab).filter((name) => !follows(driver, [name])),
})

// The version the file's schema stands at now.
let version = (driver: Driver) =>
  Number(
    driver.query({ t: 'pragma', name: 'schema_version' })[0]?.schema_version,
  )

// Per driver and print, the survey read while the schema stood at a revision
// (@yaks/sql `revision`): a reader and memory both ask, and one read of the
// row answers both.
let seen = new WeakMap<
  Driver,
  Map<string, { schema: number; survey?: Survey }>
>()
let hold = (driver: Driver, print: string, survey?: Survey) => {
  let by = seen.get(driver) ?? new Map()
  seen.set(driver, by)
  by.set(print, { schema: revision(driver, 'schema'), survey })
  return survey
}

/** The survey the file holds of this vocabulary's schema, where it was taken
 * at the version the schema stands at now; undefined where there is none, or
 * the schema has moved since. Read in the snapshot it is asked in. */
export let surveyed = (
  driver: Driver,
  vocab: Vocab,
  derived?: Derived,
): Survey | undefined => {
  if (!driver.file) return
  let print = plan(vocab, derived, true).print
  let held = seen.get(driver)?.get(print)
  if (held && held.schema === revision(driver, 'schema')) return held.survey
  let row = surveyedAt(driver, print)
  let { at, ...survey } = row ? JSON.parse(row) as Survey & { at: number } : {}
  return hold(
    driver,
    print,
    at === version(driver) ? survey as Survey : undefined,
  )
}

/** Record what a look at the file finds against this vocabulary's schema,
 * for every opener after this one. Nothing where the file is in memory, or
 * holds a survey of the schema as it stands. */
export let survey = (
  driver: Driver,
  vocab: Vocab,
  derived?: Derived,
): void => {
  if (!driver.file || surveyed(driver, vocab, derived)) return
  unit(driver, () => {
    // Another writer may have recorded it while this one waited for the lock.
    if (surveyed(driver, vocab, derived)) return
    let found = look(driver, vocab, derived)
    let print = plan(vocab, derived, true).print
    meta(driver).set(
      SURVEYED + print,
      JSON.stringify({ at: version(driver), ...found }),
    )
    hold(driver, print, found)
  })
}
