/**
 * The tools: `trial_tally` reads a skill round's rows and says what they say
 * (./skill.ts `tally`), `trial_pass` sets how much of the known answers a
 * judge of the round must get right, and `trial_hold` marks the pairs whose
 * tap is kept from selectors (./skill.ts `hold`).
 *
 * @module
 */
import { argsOf } from '@yaks/graph/call'
import { Refused } from '@yaks/graph/errors'
import type { Runs } from '@yaks/graph/tools'
import { said } from '@yaks/tools/result'
import { find, gather, keyed } from './round.ts'
import { hold, tally } from './skill.ts'

/** The tools this package runs. */
export let runs = (): Runs => ({
  trial_tally: async (call, graph) => {
    let all = await gather(
      graph,
      await find(graph, String(argsOf(call).round)),
    )
    return [said(call, tally(all, await keyed(graph, all)))]
  },
  trial_pass: async (call, graph) => {
    let { round, share } = argsOf(call)
    let n = Number(share)
    if (!(n >= 0 && n <= 1)) {
      throw new Refused(`a passing share is from 0 to 1, as 0.8: ${share}`)
    }
    let entity = { eid: await find(graph, String(round)) }
    // A mark is stamped when first written, so a changed share is written
    // anew: who set it and when are whoever set this one.
    await graph.apply([{ entity, passing: null }])
    await graph.apply([{ entity, passing: { share: n } }])
    return [
      said(
        call,
        `a judge of ${round} now passes by agreeing on ${
          Math.round(100 * n)
        }% of the known answers it sat`,
      ),
    ]
  },
  trial_hold: async (call, graph) => {
    let { round, share } = argsOf(call)
    let all = await gather(graph, await find(graph, String(round)))
    let held = hold(all, Number(share))
    if (held.length) {
      await graph.apply(held.map((eid) => ({ entity: { eid }, held_out: {} })))
    }
    let pairs = all.filter((b) => b.pair)
    return [
      said(
        call,
        `${held.length} more of ${round}'s pairs held out: ${
          pairs.filter((b) => b.held_out).length + held.length
        } of ${pairs.length} now are`,
      ),
    ]
  },
})
