/**
 * @yaks/session — a session is a transcript: the entries that make it up, the
 * lock it holds, and the daemon that reacts to its newest entry. The session
 * component vocabulary for a {@link https://jsr.io/@yaks/graph | @yaks/graph}.
 *
 * No running process is implied. A `session` is identity only; what it is doing
 * is read off its entries ({@link statusOf}, and the same rule expressed in SQL
 * for the derived property, {@link sessionDerived}) and never stored. An
 * `entry` is one line of the transcript, `{session, seq}`, and the component
 * beside it is what makes it one kind rather than another:
 *
 * - `content{body}` — prose. Alone it is an input, an instruction from a
 *   person or a system; with an `output{source}` beside it (the ask it answers)
 *   it is what a model returned. A `result`, `error` or `exception` carries its
 *   prose the same way.
 * - `ask{to, through}` — the daemon asked a model, from the prefix ending at
 *   `through`. What the provider keeps about it is the provider's own component
 *   on the same entry (`@yaks/openai` declares `openai{response_id}`).
 * - `call{to, id, args, source}` — a tool the model asked for, from that ask;
 *   `result{call}` is what the tool returned.
 * - `using{provider, model, effort}` — set or switched on an input, recorded
 *   as served on an ask.
 * - `stop`, `error{code}`, `exception` — a marker the daemon does nothing
 *   after; an expected outcome; a defect report.
 *
 * `fork{from}` on a session continues another transcript from one of its
 * entries: the parent's entries up to it are the fork's prefix.
 * `spawned{parent, call}` records delegation independently of that prefix.
 * {@link sessionTools} exposes fork/spawn/wait; the daemon delivers a child's
 * final output to its parent's queue, idempotently.
 *
 * ## The daemon
 * {@link react} is one step: read the newest entry, do the one thing it calls
 * for, append what happened. {@link daemon} registers it as a `created(entry)`
 * effect on @yaks/effects; {@link settle} loops it. It is handed a @yaks/model
 * `Model` and a table of tools and imports no platform API.
 *
 * ## A lock is a lease, not a patch
 * A `claim{session}` is a session's lock, stored on the entity it locks.
 * Writing one over somebody else's fails the whole batch loudly
 * ({@link Bounced}) — release, then claim. The same session re-claiming is a
 * no-op refresh, and a release is unguarded, because releasing is how a lock is
 * handed over. The collision is recorded as a `conflict` row on the `audit`
 * phase, after the rollback. `claim.session` is declared `death: 'release'`:
 * delete a session's entity and its locks go while the documents live —
 * declared in {@link sessionDoc}, carried out by @yaks/graph's cascade.
 * {@link reapLeases} frees every lock whose holder is not a session in the
 * graph; the `@yaks/session/service` duty runs it when it starts.
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
export * from './who.ts'
export * from './naming.ts'
export * from './react.ts'
export * from './run.ts'
export * from './providers.ts'
export * from './daemon.ts'
export * from './views.ts'

export * from './children.ts'

export { appendEntry } from './append.ts'
export * from './timing.ts'

export * from './window.ts'
