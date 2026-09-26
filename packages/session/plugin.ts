import { resultEntries } from './result-entry.ts'
import { sequencing } from './append.ts'
// The package as a graph plugin: the vocabulary, the rules, and the audit.
//
// It needs nothing from the application — no app to speak for, no roster to
// consult — because everything it decides is about the batch and the entities
// the batch names. So the factory takes only the two things a test wants to
// hold still: the clock, and the eid a conflict row is written under.
//
// The two hooks are two phases on purpose. `precondition` refuses, inside the
// transaction, before anything moves. `audit` remembers, outside it, after the
// rollback. One of them cannot do both jobs: a refusal that could also write
// would write into the transaction it just condemned.

import type { Hook, Plugin } from '@yaks/graph'
import { then } from '@yaks/graph'
import { SESSION, sessionDoc } from './comp.ts'
import { auditing, type AuditOpts } from './audit.ts'
import { leasing } from './lease.ts'
import { naming } from './naming.ts'
import { runners } from './who.ts'

/** The plugin's two injection points: a clock for both stamps, and the eid a
 * conflict row is minted under. */
export type SessionOpts = AuditOpts

/**
 * The session plugin: the vocabulary ({@link sessionDoc}), a `precondition`
 * hook that refuses a take of a held lock and refuses a component of this
 * package's that names the wrong kind of entity, and an `audit` hook that
 * records a collision after the rollback.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { graph } from '@yaks/graph'
 * import { contextDoc } from '@yaks/context'
 * import { modelDoc } from '@yaks/model'
 * import { toolsDoc } from '@yaks/tools'
 * import { sessionDoc, sessions } from '@yaks/session'
 *
 * // a transcript uses four packages' components, each declared once
 * let vocab = loadVocab([sessionDoc, toolsDoc, contextDoc, modelDoc, mine])
 * // let g = graph({ storage, vocab, plugins: [sessions()] })
 * ```
 *
 * The plugin runs nothing: it is the model and the rules. Entries appear, and
 * what reacts to them is {@link react}, taken as pool work by
 * {@link running} or looped by {@link settle}.
 */
export let sessions = (opts: SessionOpts = {}): Plugin => {
  let lease = leasing(opts)
  let precondition: Hook = (bundles, tx, err) =>
    then(
      lease(bundles, tx, err),
      (b) =>
        then(naming(b, tx, err), (named) =>
          then(resultEntries(named, tx, err), (joined) =>
            sequencing(joined, tx, err))),
    )
  return {
    name: '@yaks/session',
    vocab: [sessionDoc],
    hooks: { precondition, audit: auditing(opts) },
    // An id meant to name a session may be the runner's own id for it, the
    // one a harness hands out (`$CLAUDE_CODE_SESSION_ID`). Only when the
    // caller says it means a session: every other id is left alone.
    address: (tx, ids, kind) => kind == SESSION ? runners(tx, ids) : new Map(),
  }
}
