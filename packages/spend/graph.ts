/**
 * The graph plugin: the module a server imports at `@yaks/spend/graph`. A
 * request written after its day ended, as when a transcript is read in after
 * the fact, marks its day's row `untallied`, so the duty (./service.ts) tallies
 * that day again without being asked. Today needs no mark: every pass tallies
 * it.
 *
 * @module
 */
import type { Bundle, Plugin } from '@yaks/graph'
import { hook } from '@yaks/graph/plugin'
import { after } from '@yaks/fp'
import { dayEid, dayOf } from './window.ts'

/** The days before `today` the requests in a batch were made on. A batch's
 * stamps ride in bundles of their own, so a request's `created.at` is found by
 * its eid.
 *
 * ```ts
 * import { late } from '@yaks/spend/graph'
 * import { equal } from '@yaks/testing'
 * let asked = { entity: { eid: 'a' }, ask: {}, usage: { input_tokens: 1 } }
 * let made = (at: string) => ({ entity: { eid: 'a' }, created: { at } })
 * equal(late([asked, made('2026-10-20T12:00:00Z')], '2026-10-25'), ['2026-10-20'])
 * equal(late([asked, made('2026-10-25T01:00:00Z')], '2026-10-25'), [])
 * ```
 */
export let late = (bundles: Bundle[], today: string): string[] => {
  let asked = new Set(
    bundles.filter((b) => b.ask && b.usage).map((b) => b.entity.eid),
  )
  let days = new Set<string>()
  for (let b of bundles) {
    let at = (b.created as { at?: unknown } | null | undefined)?.at
    if (!asked.has(b.entity.eid) || typeof at != 'string') continue
    if (dayOf(at) < today) days.add(dayOf(at))
  }
  return [...days]
}

/** Mark each past day a batch adds requests to, inside its transaction, so a
 * day is never read in without being owed a tally. `now` is the clock. */
export let untallied = (now: () => number = Date.now): Plugin => ({
  name: '@yaks/spend',
  hooks: {
    commit: hook(['usage'], (bundles, tx) => {
      let days = late(bundles, dayOf(now()))
      if (!days.length) return bundles
      return after(
        tx.patch(days.map((day) => ({
          entity: { eid: dayEid(day) },
          untallied: { day },
        }))),
        () => bundles,
      )
    }),
  },
})

/** The plugins this package adds to a graph. */
export let plugins = (): Plugin[] => [untallied()]
