/**
 * What the file keeps, as a duty: the module a server imports at
 * `@yaks/journal/service`. Once a UTC day it measures the store's file (its
 * storage's `measure`) and keeps the day's `kept` row, which the History page
 * reads (./page.ts), so looking costs nothing. A store that keeps no file of
 * pages measures nothing.
 *
 * @module
 */
import type { Eid, Graph } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import { sleep } from '@yaks/fp'

/** How long a pass waits for the next, in milliseconds: an hour. */
export let EVERY = 60 * 60 * 1000

/** The row a day's measurement is kept in. */
export let keptEid = (day: string): Eid => identityEid('kept', [day])

/** One pass: measure the file, unless the day `now` falls in has been. */
export let pass = async (
  g: Graph,
  now: number = Date.now(),
  signal?: AbortSignal,
): Promise<void> => {
  if (!g.storage.measure) return
  let day = new Date(now).toISOString().slice(0, 10)
  let eid = keptEid(day)
  let [had] = await g.get([eid], ['kept'])
  if (had?.kept) return
  let m = await g.storage.measure(signal)
  if (!m) return
  let at = new Date().toISOString()
  await g.apply([{ entity: { eid }, kept: { day, at, ...m } }], {
    trusted: true,
  })
}

/** Measure, then look again every `every`, until the signal aborts. An
 * already aborted signal is one pass. */
export let service = async (
  host: {
    graph: Graph
    report?: (
      error: unknown,
      context?: { tags?: Record<string, string> },
    ) => unknown
  },
  options: { every?: number } = {},
  signal: AbortSignal = AbortSignal.abort(),
): Promise<void> => {
  for (;;) {
    try {
      await pass(host.graph, Date.now(), signal.aborted ? undefined : signal)
    } catch (e) {
      // A pass that failed is told, and the next one measures again.
      ;(host.report ?? console.error)(e, { tags: { step: 'journal measure' } })
    }
    if (signal.aborted) return
    await sleep(options.every ?? EVERY, signal)
    if (signal.aborted) return
  }
}
