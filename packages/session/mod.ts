/**
 * @yaks/session — who is working, what they hold, and what happened when two of
 * them wanted the same thing: the session component domain for a
 * {@link https://jsr.io/@yaks/graph | @yaks/graph}.
 *
 * Say a team edits documents together, and some of the editors are agents that
 * run unattended for an hour at a time. Four things follow immediately, and
 * this package is the four answers:
 *
 * - **Who is working?** A `session` is one run — a person's editor, an agent's
 *   turn. It says what it is running as, what it is thinking in, and whether it
 *   is still going.
 * - **What do they hold?** A `claim{session}` is that run's LOCK, and it rides
 *   the entity it locks: one lock per document, by construction, and "who has
 *   this open?" is answered by the document itself.
 * - **How do you ask one to stop?** A `stop_request{target}` — a lever that may
 *   only be pulled on a run that is still going. A run that finishes leaves a
 *   `brief`: what it says it did.
 * - **And when two want one document?** The second one is refused, and the
 *   collision is written down as a `conflict` record instead of being lost with
 *   the rolled-back batch.
 *
 * ## A lock is a lease, not a patch
 * Writing a lock over somebody else's fails the whole batch loudly
 * ({@link Bounced}) — release, then claim. The same run re-claiming is a no-op
 * refresh, so a worker replaying its own take is idempotent, and a RELEASE is
 * unguarded, because letting go is how a lock is handed over.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { graph } from '@yaks/graph'
 * import { sessionDoc, sessions } from '@yaks/session'
 *
 * let vocab = loadVocab([sessionDoc, mine])
 * // let g = graph({ storage, vocab, plugins: [sessions()] })
 * // g.apply([{ entity: { eid: doc }, claim: { session: run } }])
 * // g.apply([{ entity: { eid: doc }, claim: { session: other } }])
 * // Bounced: <doc> is already claimed by <run>
 * ```
 *
 * ## Three places the rule holds
 * A WRITE is refused inside `apply()`: {@link sessions} registers a
 * `precondition` hook, so the holder is read through the batch's own
 * transaction BEFORE any row moves — before the cascade phase could remove the
 * very lock being checked. A refused batch rolls back whole.
 *
 * The COLLISION is recorded after that rollback, on the `audit` phase, through
 * a detached transaction — a record that condemns a batch cannot ride inside
 * it. A failed audit is telemetry; the refusal reaches the caller either way.
 *
 * And a run that never ends properly is corrected at START-UP:
 * {@link reapLeases} frees every lock whose run is over. Nothing expires on its
 * own — a lease with a timeout has to be renewed, and a worker that is merely
 * thinking hard would lose its lock mid-edit.
 *
 * ## A dying run lets go, and that is vocabulary
 * `claim.session` dies by `release`: delete a run's entity and its locks go
 * while the documents live. That rule is declared in {@link sessionDoc} and
 * executed by @yaks/graph's cascade — there is no code for it here, which is
 * the point of declaring death in the vocabulary at all.
 *
 * ## What is deliberately not here
 * Starting a run, stopping one, and everything in between: spawning a process,
 * choosing a provider's arguments, tailing its log, reaping its pid. A
 * committed `stop_request` is acted on by a `created('stop_request')` handler
 * on {@link https://jsr.io/@yaks/effects | @yaks/effects} — post-commit, so the
 * request is durable before anything is signalled, and isolated, so a process
 * that will not die does not refuse the batch. This package is the model and
 * the rules; the runtime is the application's.
 *
 * It imports no platform API beyond `crypto.randomUUID`, so the same rules run
 * on a server, in a worker, and in a browser tab.
 *
 * @module
 */

export * from './words.ts'
export * from './comp.ts'
export * from './bounce.ts'
export * from './lease.ts'
export * from './audit.ts'
export * from './reap.ts'
export * from './plugin.ts'
