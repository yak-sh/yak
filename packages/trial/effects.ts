/**
 * The running of a round, as an effect: setting a round's cap
 * (`capped{dollars}`) owes `round_run`, which asks every call the round still
 * owes until what its calls cost in all would pass the cap (./run.ts). A run
 * cut off part way is run again by the pool and asks only what is left, and
 * what the round already spent counts against the cap, so a cap is never
 * spent twice.
 *
 * Who answers is the host's: `running` takes an `Asking` for each round, and
 * this facet (`@yaks/trial/effects`) gives a machine that runs sessions its
 * own (./run.ts `sessions`). A host that runs none hands `running` one that
 * asks a model directly (./run.ts `asking`).
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { running } from '@yaks/trial/effects'
 *
 * equal(Object.keys(running({} as never, () => ({ ask: async () => undefined }))), ['round_run'])
 * ```
 *
 * @module
 */
import type { Handlers } from '@yaks/effects'
import type { Bundle, Eid, Graph } from '@yaks/graph'
import { type Asking, type Ran, run, sessions, spent } from './run.ts'

/** What a host gives `running`, beside who answers. */
export type Options = {
  /** how many calls go at once (default 6) */
  jobs?: number
  /** told what a run did, once it is over */
  done?: (round: Bundle, ran: Ran) => unknown
}

/**
 * The handler of `round_run` over `g`, asking through whatever `answering`
 * gives for the round. Runs of one round go one after another, each reading
 * the cap as it starts, so a cap raised while a run goes is met by the next.
 */
export let running = (
  g: Graph,
  answering: (round: Bundle) => Asking | Promise<Asking>,
  o: Options = {},
): Handlers => {
  let going = new Map<Eid, Promise<unknown>>()
  let once = async (eid: Eid) => {
    let [round] = await g.get([eid])
    let cap = Number((round?.capped as { dollars?: unknown })?.dollars)
    if (!round?.round || !(cap > 0)) return
    let left = cap - await spent(g, eid)
    if (left <= 0) return
    let ran = await run(g, eid, {
      cap: left,
      asking: await answering(round),
      jobs: o.jobs,
    })
    await o.done?.(round, ran)
  }
  return {
    round_run: (event) => {
      let eid = event.entity.eid
      let next = (going.get(eid) ?? Promise.resolve()).catch(() => {})
        .then(() => once(eid))
      going.set(eid, next)
      return next.finally(() => {
        if (going.get(eid) == next) going.delete(eid)
      })
    },
  }
}

/** The box's: a round is asked of sessions on this graph. */
export let effects = (host: { graph: Graph }): Handlers =>
  running(host.graph, () => sessions(host.graph))
