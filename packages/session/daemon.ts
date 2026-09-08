// The daemon: a `created(entry)` effect over `react`. Every entry that lands
// wakes one step over its transcript, and the steps of one transcript run one
// after another — the step that asks the model appends entries, those wake the
// step that runs the tool, and so on until a step finds nothing to do. Two
// transcripts proceed side by side.
//
// A step writes through the graph's own door, not the effect's `write`: each
// step is a fresh batch at generation zero, so the chain is never cut short by
// the registry's depth. The handler itself returns at once — the step is
// queued, not awaited — so a batch is committed and cast before anything
// reacts to it, and a slow model never holds a writer.

import type { Eid, Graph } from '@yaks/graph'
import type { Effects } from '@yaks/effects'
import { ENTRY } from './native.ts'
import { type Deps, react, type Step } from './react.ts'

/** A running daemon: wake a transcript by hand, or wait until one is quiet. */
export type Daemon = {
  /** queue one step over this transcript; answers when that step is done */
  wake: (session: Eid) => Promise<Step>
  /** answers once every step queued for this transcript has run */
  idle: (session: Eid) => Promise<void>
}

/**
 * Register the daemon on an effects registry that is a plugin of `g`:
 *
 * ```ts
 * let fx = effects(vocab)
 * let g = graph({ storage: ram(vocab), vocab, plugins: [native(), fx] })
 * let d = daemon(g, fx, { model, tools })
 * g.apply([input])          // wakes the first step
 * await d.idle(session)     // settled, stopped, or failed
 * ```
 *
 * A step that throws is reported through `report` (default `console.error`)
 * and the chain goes on: a defect in one step is not a dead transcript.
 */
export let daemon = (
  g: Graph,
  fx: Effects,
  deps: Deps,
  each: (step: Step) => void = () => {},
  report: (err: unknown) => void = (err) => console.error(err),
): Daemon => {
  let busy = new Map<Eid, Promise<Step>>()
  let wake = (session: Eid) => {
    let step = (busy.get(session) ?? Promise.resolve())
      .then(() => react(g, session, deps))
      .then((s) => (each(s), s), (err) => {
        report(err)
        return { did: 'nothing', status: 'failed', added: [] } as Step
      })
    busy.set(session, step)
    return step
  }
  fx.created(ENTRY, (e) => {
    wake(String(e.comp?.session))
  })
  let idle = async (session: Eid) => {
    let seen: Promise<Step> | undefined
    while (busy.get(session) != seen) {
      seen = busy.get(session)
      await seen
    }
  }
  return { wake, idle }
}
