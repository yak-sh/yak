// The package as a graph plugin: the two components, and one small kindness
// on the way in.
//
// A wake written as a bare cadence — `{ every: '@daily' }`, with no `at` —
// is a schedule nobody would call wrong, and it would never fire: `due` asks
// whether `at` has passed, and an absent column never has. So `normalize`
// gives such a wake its first instant. That is the whole hook. It runs before
// the transaction and reads nothing, which is what `normalize` is for.
//
// The plugin starts no timer. Hosts call `tick`, which writes `fired` on each
// due wake; graph rules matching that write decide what follows. An effect
// observing a new or moved wake can arm the host's clock.

import type { Bundle, Hook, Plugin } from '@yaks/graph'
import { type Clock, wakeOf } from './due.ts'
import { after } from './every.ts'
import { WAKE, wakeDoc } from './comp.ts'

/** How the plugin reads a schedule, and what it calls now. */
export type Opts = Clock & {
  /** the clock, injected for tests (default `Date.now`) */
  now?: () => number
}

/**
 * The `normalize` hook: a wake that names a cadence and no first instant gets
 * one, so a bare `{ every: '@daily' }` is a schedule that starts tomorrow
 * rather than a row that never fires. Exported on its own for a graph that
 * wants the behaviour without the vocabulary.
 */
export let starting = (opts: Opts = {}): Hook => (bundles: Bundle[]) =>
  bundles.map((b: Bundle): Bundle => {
    let w = wakeOf(b)
    if (!w?.every || w.at) return b
    let now = (opts.now ?? Date.now)()
    let at = after(w.every, now, now, opts.tz)
    return at == null
      ? b
      : { ...b, [WAKE]: { ...w, at: new Date(at).toISOString() } }
  })

/**
 * The wake plugin: the `wake` and `fired` components, and the one hook above.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { graph } from '@yaks/graph'
 * import { wakes } from '@yaks/wake'
 *
 * let vocab = loadVocab([wakeDoc, mine])
 * let g = graph({ storage, vocab, plugins: [wakes()] })
 * g.apply([{ entity: { eid: 'w1' }, wake: { every: '@daily', note: 'water the plants' } }])
 * ```
 *
 * A host calls `tick(graph, now)` to consume due wakes. Rules matching
 * `.wake, *fired` run in their declared phases; the driver invokes no handler.
 */
export let wakes = (opts: Opts = {}): Plugin => ({
  name: '@yaks/wake',
  vocab: [wakeDoc],
  hooks: { normalize: starting(opts) },
})
