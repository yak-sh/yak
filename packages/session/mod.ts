/**
 * @yaks/session — a session is a transcript: the entries that make it, the lock
 * it holds, and the daemon that reacts to its newest line. The session
 * component domain for a {@link https://jsr.io/@yaks/graph | @yaks/graph}.
 *
 * No host process is implied. A `session` is identity only; what it
 * is doing is read off its entries ({@link statusOf}, and the same rule as a
 * derived SQL column, {@link sessionDerived}) and never stored. An `entry` is
 * one line, `{session, seq}`, and the comp beside it says what kind:
 *
 * - `content{body}` — prose. Alone it is an INPUT, an instruction from a
 *   person or a system; with a `source` (the ask it came from) it is what a
 *   model said. A `result`, `error` or `exception` carries its prose the same
 *   way.
 * - `ask{to, through}` — the daemon asked a model, from the prefix ending at
 *   `through`. What the provider keeps about it is the provider's own comp on
 *   the same entry (`@yaks/openai` declares `openai{response_id}`).
 * - `call{to, id, args, source}` — a tool the model asked for, from that ask;
 *   `result{call}` is what the tool answered.
 * - `using{provider, model, effort}` — set or switched on an input, recorded
 *   as served on an ask.
 * - `stop`, `error{code}`, `exception` — a mark the daemon performs nothing
 *   after; an expected outcome; a defect report.
 *
 * `fork{from}` on a session continues another transcript from one of its
 * entries: the parent's entries up to it are the fork's prefix.
 * `spawned{parent, call}` records delegation independently of that prefix.
 * {@link sessionTools} exposes fork/spawn/wait; the daemon delivers a child's
 * terminal output to its parent's queue, idempotently.
 *
 * ## The daemon
 * {@link react} is one step: read the newest entry, do the one thing it asks
 * for, append what happened. {@link daemon} registers it as a `created(entry)`
 * effect on @yaks/effects; {@link settle} loops it. It is handed a @yaks/model
 * `Model` and a table of tools and imports no platform API.
 *
 * ## A lock is a lease, not a patch
 * A `claim{session}` is a session's LOCK, riding the entity it locks. Writing
 * one over somebody else's fails the whole batch loudly ({@link Bounced}) —
 * release, then claim. The same session re-claiming is a no-op refresh, and a
 * RELEASE is unguarded, because letting go is how a lock is handed over. The
 * collision is written down as a `conflict` record on the `audit` phase, after
 * the rollback. `claim.session` dies by `release`: delete a session's entity
 * and its locks go while the documents live — declared in {@link sessionDoc},
 * executed by @yaks/graph's cascade. {@link reapLeases} frees, at start-up,
 * every lock whose holder is not a session in the graph.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { graph } from '@yaks/graph'
 * import { modelDoc } from '@yaks/model'
 * import { sessionDoc, sessions } from '@yaks/session'
 *
 * let vocab = loadVocab([sessionDoc, modelDoc, mine])
 * // let g = graph({ storage, vocab, plugins: [sessions()] })
 * ```
 *
 * @module
 */

export * from './comp.ts'
export * from './bounce.ts'
export * from './lease.ts'
export * from './audit.ts'
export * from './reap.ts'
export * from './plugin.ts'
export * from './native.ts'
export * from './status.ts'
export * from './rules.ts'
export * from './react.ts'
export * from './daemon.ts'
export * from './views.ts'

export * from './children.ts'
