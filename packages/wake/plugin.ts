// The package as a graph plugin: the two components, one convenience on the
// way in, and one check.
//
// A wake written as a cadence alone — `{ every: '@daily' }`, with no `at` — is
// a schedule nobody would call wrong, and it would never fire: `due` tests
// whether `at` has passed, and a property that is absent never has. So
// `normalize` gives such a wake its first instant. It runs before the
// transaction and reads nothing, which is what `normalize` is for.
//
// The check is `precondition`'s: a `while` condition is a query, and a query
// that does not parse, or names a word the graph does not speak, is refused
// when it is written rather than found out at a firing (./pace.ts
// `conditions`).
//
// The plugin starts no timer. The application calls `tick`, which writes
// `fired` on each due wake; graph rules matching that write decide what
// follows. An effect observing a new or moved wake can set the application's
// timer or alarm.

import type { Bundle, Hook, Plugin } from '@yaks/graph'
import { type Clock, wakeOf } from './due.ts'
import { after } from './every.ts'
import { WAKE, wakeDoc } from './comp.ts'
import { conditions } from './pace.ts'

/** How the plugin reads a schedule, and where it gets the current time. */
export type Opts = Clock & {
  /** the clock, replaceable in tests (default `Date.now`) */
  now?: () => number
}

/**
 * The `normalize` hook: a wake that gives a cadence but no first instant is
 * given one, so that `{ every: '@daily' }` on its own is a schedule starting
 * tomorrow rather than a row that never fires. Exported separately for a graph
 * that wants the behaviour without the vocabulary.
 */
export let starting = (opts: Opts = {}): Hook => (bundles: Bundle[]) =>
  bundles.map((b: Bundle): Bundle => {
    let w = wakeOf(b)
    if (!w?.every || w.at !== undefined) return b
    let now = (opts.now ?? Date.now)()
    let at = after(w.every, now, now, opts.tz)
    return at == null
      ? b
      : { ...b, [WAKE]: { ...w, at: new Date(at).toISOString() } }
  })

/**
 * The wake plugin: the `wake` and `fired` components, and the two hooks
 * above.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { graph } from '@yaks/graph'
 * import { ram } from '@yaks/ram'
 * import { wakeDoc, wakes } from '@yaks/wake'
 *
 * let vocab = loadVocab([wakeDoc])
 * let g = graph({ storage: ram(vocab), vocab, plugins: [wakes()] })
 * g.apply([{ entity: { eid: 'w1' }, wake: { every: '@daily', note: 'water the plants' } }])
 * ```
 *
 * The application calls `tick(graph, now)` to fire due wakes. Rules matching
 * `.wake, *fired` run in their declared phases; the driver itself calls no
 * handler.
 */
export let wakes = (opts: Opts = {}): Plugin => ({
  name: '@yaks/wake',
  vocab: [wakeDoc],
  hooks: { normalize: starting(opts), precondition: conditions },
})
