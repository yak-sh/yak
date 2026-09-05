// The package as a graph plugin: the two components, and one small kindness
// on the way in.
//
// A wake written as a bare cadence — `{ every: '@daily' }`, with no `at` —
// is a schedule nobody would call wrong, and it would never fire: `due` asks
// whether `at` has passed, and an absent column never has. So `normalize`
// gives such a wake its first instant. That is the whole hook. It runs before
// the transaction and reads nothing, which is what `normalize` is for.
//
// The plugin fires NOTHING. It has no timer, no loop, and no effect handler,
// because when to come back is a property of the host and not of the data: a
// server has `setTimeout`, a Durable Object has `alarm()`, a Worker has a cron
// trigger, a browser tab has whatever is left when it is backgrounded. What it
// offers instead is `due()` — the same answer to all of them — and the
// `created('wake')` slot on @yaks/effects, which is where a host arms its
// clock when a new wake appears. See the README.

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
 * Running what a wake names is the host's, through
 * {@link https://jsr.io/@yaks/wake/doc/~/due | due} — see the README for the
 * three wirings (a server tick, a Durable Object alarm, a client).
 */
export let wakes = (opts: Opts = {}): Plugin => ({
  name: '@yaks/wake',
  vocab: [wakeDoc],
  hooks: { normalize: starting(opts) },
})
