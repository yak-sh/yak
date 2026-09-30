/**
 * The census every map of the data is read off: each set of components
 * entities are made of (@yaks/archetype), and how many entities are made of
 * each. From it, how many entities carry each component, which sets a
 * component is found in, and how many edges state each relation: no page asks
 * the graph to count those again. The tally reads every entity, so it is asked
 * once for as long as the page is open (./live.ts), and shared by every page
 * that reads it.
 *
 * @module
 */

import type { Bundle, Io } from './host.ts'
import { census as carrying, tables } from './read.ts'

/** The two lines a census is read from. */
export let CENSUS = {
  sets: '.archetype&.fields=archetype.tables',
  tally: '.tally=entity.archetype',
}

/** The census, as a page reads it. */
export type Census = {
  /** every set of components that occurs, most populous first */
  sets: Bundle[]
  /** how many entities are made of each set, by its eid */
  tally: Record<string, number>
  /** how many entities carry each component, by its name */
  carried: Record<string, number>
  /** the counts are in */
  ready: boolean
  /** why the graph could not answer */
  error?: string
}

/** The census: a hook, asked once and kept while the page is open. */
export let useCensus = (io: Io): Census => {
  let got = io.ask({
    sets: { query: CENSUS.sets, once: true },
    tally: { query: CENSUS.tally, once: true },
  })
  let tally = got.tally?.tally ?? {}
  let sets = (got.sets?.rows ?? []).toSorted((a, b) =>
    (tally[b.entity.eid] ?? 0) - (tally[a.entity.eid] ?? 0)
  )
  let ready = !!got.tally?.tally && !!got.sets?.ready
  return {
    sets,
    tally,
    carried: ready ? carrying(sets, tally) : {},
    ready,
    error: got.sets?.error ?? got.tally?.error,
  }
}

/**
 * The sets a component is found in, most populous first.
 *
 * ```ts
 * import { within } from './census.ts'
 * let s = (eid: string, t: string[]) =>
 *   ({ entity: { eid }, archetype: { tables: JSON.stringify(t) } })
 * within([s('a', ['doc', 'task']), s('b', ['doc'])], 'task')
 *   .map((b) => b.entity.eid) // ['a']
 * ```
 */
export let within = (sets: Bundle[], name: string): Bundle[] =>
  sets.filter((s) => tables(s).includes(name))

/** How many entities are made of the sets `of`. */
export let counted = (c: Census, of: Bundle[]): number =>
  of.reduce((n, s) => n + (c.tally[s.entity.eid] ?? 0), 0)
