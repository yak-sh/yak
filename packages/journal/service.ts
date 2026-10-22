/**
 * What the file keeps, as a duty: the module a server imports at
 * `@yaks/journal/service`. Once a UTC day it measures the store's file (its
 * storage's `measure`) and keeps the day's `kept` row, which the History page
 * reads (./page.ts), so looking costs nothing. The row names the file it
 * measured, so a page about the disk finds the store's file and its free
 * pages, and holds the changes the journal holds per component, counted from
 * its log, so the page never counts them. A store that keeps no file of
 * pages measures nothing.
 *
 * @module
 */
import type { Bundle, Eid, Graph, Measure } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import { sleep } from '@yaks/fp'
import { onDisk } from '@yaks/file/local'
import { CHANGES } from './kept.ts'
import { type Bound, logFor } from './graph.ts'

/** How long a pass waits for the next, in milliseconds: an hour. */
export let EVERY = 60 * 60 * 1000

/** The row a day's measurement is kept in. */
export let keptEid = (day: string): Eid => identityEid('kept', [day])

/** What a day's row says of itself, as far as {@link owed} asks. */
export type Had = { file?: unknown; tables?: object; changes?: unknown }

/**
 * Whether a day is still to be measured: it has no row, its row does not
 * name the file the store keeps, or it measured a journal without counting
 * its changes.
 *
 * ```ts
 * import { owed } from './service.ts'
 * import { equal } from '@yaks/testing'
 *
 * equal(owed(undefined), true)
 * equal(owed({}), false)
 * equal(owed({}, '/a/yak.db'), true)
 * equal(owed({ file: 'f' }, '/a/yak.db'), false)
 * equal(owed({ tables: { journal_change: [1, 1] } }), true)
 * equal(owed({ tables: { journal_change: [1, 1] }, changes: {} }), false)
 * ```
 */
export let owed = (kept?: Had, path?: string): boolean =>
  !kept || (!!path && !kept.file) ||
  (!!kept.tables && CHANGES in kept.tables && !kept.changes)

/**
 * What a day's measurement writes: the file measured, where the store keeps
 * one (@yaks/file's bundle for it), and the day's row naming it, with the
 * changes the journal holds per component where it keeps one.
 *
 * ```ts
 * import { keptEid, measured } from './service.ts'
 * import { equal } from '@yaks/testing'
 *
 * let m = { bytes: 300, free: 0, tables: {} }
 * let file = { entity: { eid: 'f' }, file: { path: 'a/yak.db', root: 'v' } }
 * equal(measured('2026-10-21', 'T', m, [file]), [file, {
 *   entity: { eid: keptEid('2026-10-21') },
 *   kept: { day: '2026-10-21', at: 'T', ...m, file: 'f' },
 * }])
 * equal(measured('2026-10-21', 'T', m, [])[0].kept, { day: '2026-10-21', at: 'T', ...m })
 * equal(measured('2026-10-21', 'T', m, [], { doc: 2 })[0].kept, { day: '2026-10-21', at: 'T', ...m, changes: { doc: 2 } })
 * ```
 */
export let measured = (
  day: string,
  at: string,
  m: Measure,
  file: Bundle[],
  changes?: Record<string, number>,
): Bundle[] => [
  ...file,
  {
    entity: { eid: keptEid(day) },
    kept: {
      day,
      at,
      ...m,
      ...file[0] ? { file: file[0].entity.eid } : {},
      ...changes ? { changes } : {},
    },
  },
]

/** One pass: measure the file, unless the day `now` falls in has been. A
 * file that keeps a journal has its changes counted by `held` (its log's). */
export let pass = async (
  g: Graph,
  now: number = Date.now(),
  signal?: AbortSignal,
  held?: () => Record<string, number>,
): Promise<void> => {
  if (!g.storage.measure) return
  let day = new Date(now).toISOString().slice(0, 10)
  let [had] = await g.get([keptEid(day)], ['kept'])
  let path = g.storage.file
  if (!owed(had?.kept as Had | undefined, path)) return
  let m = await g.storage.measure(signal)
  if (!m) return
  let file = path ? await onDisk(g, path) : []
  let changes = m.tables[CHANGES] ? held?.() : undefined
  await g.apply(
    measured(day, new Date().toISOString(), m, file, changes),
    { trusted: true },
  )
}

/** Measure, then look again every `every`, until the signal aborts. An
 * already aborted signal is one pass. */
export let service = async (
  host: Partial<Bound> & {
    graph: Graph
    report?: (
      error: unknown,
      context?: { tags?: Record<string, string> },
    ) => unknown
  },
  options: { every?: number } = {},
  signal: AbortSignal = AbortSignal.abort(),
): Promise<void> => {
  // The log the journal writes through on this host, where it keeps one.
  let bound = host.storage?.statements ? host as Bound : undefined
  let held = bound && (() => logFor(bound).held())
  for (;;) {
    try {
      await pass(
        host.graph,
        Date.now(),
        signal.aborted ? undefined : signal,
        held,
      )
    } catch (e) {
      // A pass that failed is told, and the next one measures again.
      ;(host.report ?? console.error)(e, { tags: { step: 'journal measure' } })
    }
    if (signal.aborted) return
    await sleep(options.every ?? EVERY, signal)
    if (signal.aborted) return
  }
}
