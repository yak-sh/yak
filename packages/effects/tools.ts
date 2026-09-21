// The tool an agent can call here: the module exported as
// `@yaks/effects/tools`, holding the implementation behind the `effect_check`
// declaration in ./vocab.json. One tool, and it is a CHECK — a tool whose verb
// is `check`, which is all a "doctor" command is (@yaks/tools ./check.ts).
//
// The ledger is written for exactly this. ./durable.ts retries a run that did
// not complete, backing off between attempts, and when its last attempt is
// spent marks the row `failed` with the error beside it and LEAVES IT FOR A
// HUMAN. Nothing in that sequence tells the human. This does.
//
// The other half is a row that never got that far: `pending` is written before
// the handler runs and marked after, so a row that has been waiting since long
// before it came due means nobody is running effects at all — the registry's
// process died, or the application was built with a ledger and no sweep. That
// failure is invisible from every other angle: the writes commit, the graph
// looks normal, the mail just never goes out.
//
// A graph with no `effect` component keeps no ledger, which is a legitimate
// configuration (at-most-once in memory, nothing written down) and not a fault
// — the check reports that and finds nothing.

import { and, eq } from '@yaks/query'
import type { Bundle, Comp } from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { human } from '@yaks/id'
import { checked, type Finding } from '@yaks/tools'
import type { Vocab } from '@yaks/vocab'
import { EFFECT } from './durable.ts'

/** What configuration this package's check accepts. */
export type Options = {
  /** how long a run may sit pending PAST ITS DUE INSTANT before that means
   * nothing is dispatching, in minutes (default 10) */
  minutes?: number
  /** how many of the failed runs to name (default 5) */
  sample?: number
}

let MINUTES = 10
let SAMPLE = 5

let comp = (b: Bundle) => b[EFFECT] as Comp | undefined

// A few names, and how many more there were: a list of six hundred stuck rows
// is not more actionable than a list of five.
let some = (rows: Bundle[], id: (b: Bundle) => string, sample: number) => {
  let shown = rows.slice(0, sample).map(id).join(', ')
  let rest = rows.length - Math.min(rows.length, sample)
  return `${shown}${rest > 0 ? `, and ${rest} more` : ''}`
}

/** The implementation behind the tool ./vocab.json declares. */
export let runs = (
  host: { vocab: Vocab },
  options: Options = {},
): Runs => ({
  effect_check: async (_bundles, ctx) => {
    let about = 'every effect run reached an end somebody would hear about'
    if (!host.vocab.comp(EFFECT)) {
      // Not a fault: an application that wants at-most-once in memory loads no
      // `effect` component, so there is nothing written down to fall behind
      // on.
      return checked(ctx.call, about, [])
    }
    let id = human(host.vocab)
    let sample = options.sample ?? SAMPLE
    let cutoff = Date.now() - (options.minutes ?? MINUTES) * 60_000
    let failed = await ctx.read(and(eq(`${EFFECT}.state`, 'failed')))
    let stuck = (await ctx.read(and(eq(`${EFFECT}.state`, 'pending'))))
      .filter((b) => {
        // Since WHEN it has been waiting: a failure that reported is owed its
        // next run at `next`, not at the instant the run was first written
        // down — a backoff is not a symptom.
        let row = comp(b)
        let at = Date.parse(String(row?.next ?? row?.at ?? ''))
        return !isNaN(at) && at < cutoff
      })
    let found: Finding[] = []
    if (failed.length) {
      found.push({
        level: 'fail',
        text: `${failed.length} effect run(s) spent their attempts and were ` +
          `left for a person: ${some(failed, id, sample)}`,
      })
    }
    if (stuck.length) {
      found.push({
        level: 'warn',
        text: `${stuck.length} effect run(s) have been pending since before ` +
          `${new Date(cutoff).toISOString()} — nothing is dispatching: ` +
          `${some(stuck, id, sample)}`,
      })
    }
    return checked(ctx.call, about, found)
  },
})
