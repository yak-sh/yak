// The package as a graph plugin: the two components, one convenience on the
// way in, and one check.
//
// A wake written as a cadence alone — `{ every: '@daily' }`, with no `at` — is
// a schedule nobody would call wrong, and it would never fire: `due` tests
// whether `at` has passed, and a property that is absent never has. So
// `beforeWrite` gives a new cadence its first instant inside the transaction,
// leaving an existing schedule (including a paused one) unchanged.
//
// The check is `precondition`'s: a `while` condition is a query, and a query
// that does not parse, or names a word the graph does not speak, is refused
// when it is written rather than found out at a firing (./while.ts
// `conditions`).
//
// The plugin starts no timer. The application calls `tick`, which writes
// `fired` on each due wake; graph rules matching that write decide what
// follows. An effect observing a new or moved wake can set the application's
// timer or alarm.

import { after } from '@yaks/fp'
import type { Bundle } from '@yaks/graph/bundle'
import { type Hook, hook, type Plugin } from '@yaks/graph/plugin'
import { type Clock, wakeOf } from './due.ts'
import { recur } from './every.ts'
import { WAKE, wakeDoc } from './comp.ts'
import { conditions } from './while.ts'

/** How the plugin reads a schedule, and where it gets the current time. */
export type Opts = Clock & {
  /** the clock, replaceable in tests (default `Date.now`) */
  now?: () => number
}

/**
 * The `beforeWrite` hook: a new cadence without a first instant gets one.
 * An existing recurrence without `at` is paused; omission in a patch or a
 * replayed read must leave it paused. Likewise, cadence edits retain an
 * existing instant. Exported for graphs that load the vocabulary separately.
 */
export let starting = (opts: Opts = {}): Hook => (bundles, tx) =>
  after(
    tx.get(
      bundles.filter((b) => {
        let w = wakeOf(b)
        return w?.every && w.at === undefined
      }).map((b) => b.entity.eid),
    ),
    (held) => {
      let prior = new Map(held.map((b) => [b.entity.eid, wakeOf(b)]))
      return bundles.map((b: Bundle): Bundle => {
        let w = wakeOf(b)
        let was = prior.get(b.entity.eid)
        if (!w?.every || w.at !== undefined || was?.every || was?.at) return b
        let now = (opts.now ?? Date.now)()
        let at = recur(w.every, now, now, opts.tz)
        return at == null
          ? b
          : { ...b, [WAKE]: { ...w, at: new Date(at).toISOString() } }
      })
    },
  )

/**
 * The wake plugin: the `wake` and `fired` components, and the two hooks
 * above.
 *
 * The application calls `tick(graph, now)` to fire due wakes. Rules matching
 * `.wake, *fired` run in their declared phases; the driver itself calls no
 * handler.
 */
/// let { loadVocab } = await import('@yaks/vocab')
/// let { graph } = await import('@yaks/graph')
/// let { ram } = await import('@yaks/ram')
/// let { wakeDoc } = await import('./comp.ts')
/// let vocab = loadVocab([wakeDoc])
/// let now = () => Date.parse('2026-01-01T09:17:00Z')
/// let storage = ram(vocab)
/// let g = graph({ storage, vocab, plugins: [wakes({ now })] })
/// (await g.apply([{ entity: { eid: 'w1' }, wake: { every: '@daily', note: 'water the plants' } }]))[0].wake.at -> '2026-01-02T00:00:00.000Z'
export let wakes = (opts: Opts = {}): Plugin => ({
  name: '@yaks/wake',
  admission: () => true,
  vocab: [wakeDoc],
  beforeWrite: (bundles) =>
    bundles.some((b) => {
        let w = wakeOf(b)
        return w?.every && w.at === undefined
      })
      ? hook([WAKE], starting(opts))
      : undefined,
  hooks: {
    precondition: hook([WAKE], conditions),
  },
})
