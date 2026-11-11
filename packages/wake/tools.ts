// What anybody may ask of the wakes: the `@yaks/wake/tools` entry point, the
// implementation behind the `tool: true` declaration in ./vocab.json.
// `wake_new` writes one wake aimed at something: once, at an instant, or on a
// cadence. What follows a firing is the graph's rules', as for any wake:
// @yaks/session knocks a persona's operator, or the session opened on a topic.

import type { Bundle } from '@yaks/graph'
import { argsOf } from '@yaks/graph/call'
import { Refused } from '@yaks/graph/errors'
import type { Runs } from '@yaks/graph/tools'
import { WAKE } from './comp.ts'
import { recur } from './every.ts'

let said = (v: unknown): string => v == null ? '' : String(v).trim()

/** The implementation of `wake_new`. A factory, like every such module,
 * although it needs nothing from the server. */
export let runs = (): Runs => ({
  wake_new: (call): Promise<Bundle[]> => {
    let args = argsOf(call)
    let every = said(args.every), at = said(args.at), note = said(args.note)
    let now = Date.now()
    if (!every && !at) {
      throw new Refused('a wake needs a time: at for once, every to recur')
    }
    if (every && recur(every, now, now) == null) {
      throw new Refused(
        `${every} is no cadence: a duration (30m, 1d), five cron fields ` +
          '(0 9 * * 1-5 America/Detroit) or @daily',
      )
    }
    if (at && Number.isNaN(Date.parse(at))) {
      throw new Refused(`${at} is no instant: write it as 2026-01-02T09:00Z`)
    }
    // The graph mints its id, and with a cadence alone gives it its first
    // instant (./plugin.ts `starting`).
    return Promise.resolve([{
      entity: { eid: '$wake' },
      [WAKE]: {
        target: said(args.target),
        ...every ? { every } : {},
        ...at ? { at: new Date(at).toISOString() } : {},
        ...note ? { note } : {},
      },
    }])
  },
})
