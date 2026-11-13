// What anybody may ask of the wakes: the `@yaks/wake/tools` entry point, the
// implementation behind the `tool: true` declarations in ./vocab.json.
// `wake_new` writes one wake aimed at something: once, at an instant, after a
// delay, or on a cadence, set for its caller. What follows a firing is the
// graph's rules', as for any wake: @yaks/session knocks a persona's operator,
// or the session opened on a topic. `wake_list` and `wake_cancel` are the
// caller's own wakes (./held.ts).

import type { Bundle, Graph } from '@yaks/graph'
import { argsOf } from '@yaks/graph/call'
import { Refused } from '@yaks/graph/errors'
import { actorOf } from '@yaks/graph/provenance'
import type { Runs } from '@yaks/graph/tools'
import { WAKE } from './comp.ts'
import { recur, when } from './every.ts'
import { cancel, held } from './held.ts'

let said = (v: unknown): string => v == null ? '' : String(v).trim()

let personOf = async (
  g: Pick<Graph, 'get' | 'vocab'>,
  by?: string,
): Promise<string | undefined> =>
  by && g.vocab.comp('person') && (await g.get([by], ['person']))[0]?.person
    ? by
    : undefined

/** The implementations of `wake_new`, `wake_list` and `wake_cancel`. A
 * factory, like every such module: `now` is the clock a delay counts from. */
export let runs = (o: { now?: () => number } = {}): Runs => ({
  wake_new: async (call, graph): Promise<Bundle[]> => {
    let args = argsOf(call)
    let every = said(args.every), at = said(args.at), note = said(args.note)
    let now = (o.now ?? Date.now)()
    let first = at ? when(at, now) : null
    // Set for its caller where the caller is a person the graph knows.
    let by = await personOf(graph, actorOf([call]).by)
    if (!every && !at) {
      throw new Refused('a wake needs a time: at for once, every to recur')
    }
    if (every && recur(every, now, now) == null) {
      throw new Refused(
        `${every} is no cadence: a duration (30m, 1d), five cron fields ` +
          '(0 9 * * 1-5 America/Detroit) or @daily',
      )
    }
    if (at && first == null) {
      throw new Refused(
        `${at} is no instant: write it as 2026-01-02T09:00Z, or a delay as 10m`,
      )
    }
    // The graph mints its id, and with a cadence alone gives it its first
    // instant (./plugin.ts `starting`).
    return [{
      entity: { eid: '$wake' },
      [WAKE]: {
        target: said(args.target),
        ...every ? { every } : {},
        ...first != null ? { at: new Date(first).toISOString() } : {},
        ...note ? { note } : {},
        ...by ? { for: by } : {},
      },
    }]
  },
  wake_list: async (call, graph) => {
    let by = actorOf([call]).by
    return by ? await held(graph, by) : []
  },
  wake_cancel: async (call, graph) => {
    let id = said(argsOf(call).wake)
    let by = actorOf([call]).by
    let gone = by && await cancel(graph, by, id)
    if (!gone) throw new Refused(`there is no wake ${id} of yours to cancel`)
    return [gone]
  },
})
