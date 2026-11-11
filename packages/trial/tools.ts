/**
 * The tool: `trial_tally` reads a skill round's rows and says what they say
 * (./skill.ts `tally`).
 *
 * @module
 */
import { argsOf } from '@yaks/graph/call'
import type { Runs } from '@yaks/graph/tools'
import { said } from '@yaks/tools/result'
import { find, gather, keyed } from './round.ts'
import { tally } from './skill.ts'

/** The tools this package runs. */
export let runs = (): Runs => ({
  trial_tally: async (call, graph) => {
    let all = await gather(
      graph,
      await find(graph, String(argsOf(call).round)),
    )
    return [said(call, tally(all, await keyed(graph, all)))]
  },
})
