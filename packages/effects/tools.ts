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
// And the person it tells can act: `effect_retry` puts failed runs back to
// pending for the pool to work again, `effect_drop` deletes the ones whose work
// no one owes any more. Both write the pool's own way — a trusted batch guarded
// by the state they read — so a run a worker has since touched is left alone.
//
// A graph with no `effect` component keeps no pool, which is a legitimate
// configuration (effects run where they were committed, nothing written down)
// and not a fault — the check reports that and finds nothing.

import { and, eq } from '@yaks/query'
import {
  addressed,
  argsOf,
  type Bundle,
  type Comp,
  type Graph,
  signed,
  token,
  who,
} from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { human } from '@yaks/id'
import { CallError, checked, type Finding, said } from '@yaks/tools'
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

// The failed runs a handler name or a single run's id points at.
let failedOf = async (graph: Graph, of: string): Promise<Bundle[]> => {
  let byHandler = await graph.read(and(
    eq(`${EFFECT}.state`, 'failed'),
    eq(`${EFFECT}.handler`, of),
  ))
  if (byHandler.length) return byHandler
  let [eid] = await addressed(graph, [of])
  let [row] = await graph.get([eid])
  return comp(row ?? {} as Bundle)?.state == 'failed' ? [row] : []
}

// Change each failed run named by the call, guarded by the state read, and say
// how many. `patch` null deletes.
let settle =
  (verb: string, patch: Comp | null): Runs[string] => async (call, graph) => {
    let of = String(argsOf(call).of)
    let rows = await failedOf(graph, of)
    if (!rows.length) {
      throw new CallError('refused', `${of} names no failed effect run`)
    }
    await graph.apply(
      signed(
        rows.map((b) => ({
          entity: { eid: b.entity.eid },
          ...(patch ? { [EFFECT]: patch } : { $delete: true }),
          $was: { [EFFECT]: { state: token('failed') } },
        })),
        who(call),
      ),
      { trusted: true },
    )
    return [said(call, `${verb} ${rows.length} failed run(s) of ${of}`)]
  }

/** The implementation behind the tool ./vocab.json declares. */
export let runs = (
  host: { vocab: Vocab },
  options: Options = {},
): Runs => ({
  // Pending with a full allowance, as a run no one has started: the pool claims
  // it, counts attempts and backs off exactly as it does a new one.
  effect_retry: settle('retried', {
    state: 'pending',
    attempts: 0,
    next: null,
    error: null,
    lease_owner: null,
    lease_token: null,
    lease_expiry: null,
  }),
  effect_drop: settle('dropped', null),
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
          `left for a person: ${some(failed, id, sample)}; ` +
          '`yak effect retry <handler>` puts them back to the pool, ' +
          '`yak effect drop <handler>` deletes what no one owes',
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
