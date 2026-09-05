// The package as a graph plugin: the five components, the lock rules, and the
// audit.
//
// It needs nothing from the application — no app to speak for, no roster to
// consult — because everything it decides is about the batch and the entities
// the batch names. So the factory takes only the two seams a test wants to
// hold still: the clock, and the name a conflict record is written under.
//
// The two hooks are two phases on purpose. `precondition` refuses, inside the
// transaction, before anything moves. `audit` remembers, outside it, after the
// rollback. One of them cannot do both jobs: a refusal that could also write
// would write into the transaction it just condemned.

import type { Plugin } from '@yaks/graph'
import { sessionDoc } from './comp.ts'
import { auditing, type AuditOpts } from './audit.ts'
import { leasing } from './lease.ts'

/** How the plugin's two seams are wired: a clock for both stamps, and the name
 * a conflict record is minted under. */
export type SessionOpts = AuditOpts

/**
 * The session plugin: the `session`, `claim`, `stop_request`, `brief` and
 * `conflict` components, a `precondition` hook that refuses a take of a held
 * lock or a stop aimed at a run that is not going, and an `audit` hook that
 * records the collision after the rollback.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { graph } from '@yaks/graph'
 * import { sessionDoc, sessions } from '@yaks/session'
 *
 * let vocab = loadVocab([sessionDoc, mine])
 * // let g = graph({ storage, vocab, plugins: [sessions()] })
 * ```
 *
 * What is NOT here: starting a run, stopping one, and everything in between.
 * A committed `stop_request` is acted on by a `created('stop_request')`
 * handler on {@link https://jsr.io/@yaks/effects | @yaks/effects} — post-commit
 * and isolated, so a process that will not die does not refuse the batch. This
 * package is the model and the rules.
 */
export let sessions = (opts: SessionOpts = {}): Plugin => ({
  name: '@yaks/session',
  vocab: [sessionDoc],
  hooks: { precondition: leasing(opts), audit: auditing(opts) },
})
