// The tool an agent can call here: the module exported as
// `@yaks/effects/tools`, holding the implementation behind the `effect_check`
// declaration in ./vocab.json. One tool, and it is a check — a tool whose verb
// is `check`, which is all a "doctor" command is (@yaks/tools ./check.ts).
//
// The pool is written for exactly this. ./pool.ts retries a run that did not
// complete, backing off between attempts, and when its last attempt is spent
// marks the row `failed` with the error beside it and leaves it for a person.
// Nothing in that sequence tells the person. This does.
//
// The other half is a row that never got that far: a run is written pending
// by the commit that owes it, so a row that has been waiting since long before
// it came due means nobody is working the pool — no process serves the
// effects role, or none of them handles that effect. That failure is invisible
// from every other angle: the writes commit, the graph looks normal, the mail
// just never goes out.
//
// A graph with no `effect` component keeps no pool, which is a legitimate
// configuration (effects run where they were committed, nothing written down)
// and not a fault — the check reports that and finds nothing.

import { and, eq } from '@yaks/query'
import type { Bundle, Comp } from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { human } from '@yaks/id'
import { checked, type Finding } from '@yaks/tools'
import type { Vocab } from '@yaks/vocab'
import { EFFECT } from './pool.ts'

/** What configuration this package's check accepts. */
export type Options = {
  /** how long a run may sit pending past its due instant before that means
   * nothing is working them, in minutes (default 10) */
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
  effect_check: async (call, graph) => {
    let about = 'every effect run reached an end somebody would hear about'
    if (!host.vocab.comp(EFFECT)) {
      // Not a fault: an application that runs its effects where it commits
      // them loads no `effect` component, so there is nothing written down to
      // fall behind on.
      return checked(call.entity.eid, about, [])
    }
    let id = human(host.vocab)
    let sample = options.sample ?? SAMPLE
    let cutoff = Date.now() - (options.minutes ?? MINUTES) * 60_000
    let failed = await graph.read(and(eq(`${EFFECT}.state`, 'failed')))
    let stuck = (await graph.read(and(eq(`${EFFECT}.state`, 'pending'))))
      .filter((b) => {
        // Since when it has been waiting: a failure that reported is owed its
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
          `${new Date(cutoff).toISOString()} — nothing is working them: ` +
          `${some(stuck, id, sample)}`,
      })
    }
    return checked(call.entity.eid, about, found)
  },
})
