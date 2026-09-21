/**
 * @yaks/spawn — a session whose provider is a COMMAND: the agent started
 * detached on this host, and its JSONL stdout read back as that transcript's
 * entries.
 *
 * Nothing here is a new component. A session is
 * {@link https://jsr.io/@yaks/session | @yaks/session}'s transcript, the run
 * is {@link https://jsr.io/@yaks/process | @yaks/process}'s `process` on that
 * same entity, and the request is the `using{provider, model, effort}` on the
 * transcript's first entry — which is what @yaks/session's own vocabulary says
 * a session is asked for. This package is the three of them meeting:
 *
 * - **the argv** — a `provider` whose transport is a command line, by name
 *   (`claude`, `codex`), plus the reader that turns one line of its stream
 *   into the comps an entry wears ({@link adapters}).
 * - **the run** — {@link start} launches it through @yaks/process (a launcher
 *   that exits at birth, a `setsid` wrapper in its own systemd user scope), so
 *   the agent outlives this server; {@link follow} reads its log into the
 *   transcript; {@link down} takes it down.
 * - **the boot** — {@link resume} picks every run back up after a restart,
 *   watching the pid again and reading the log on from where the transcript
 *   stands. Nothing reaps anything.
 *
 * Importing is exactly-once by the stamp it leaves: an entry read out of a log
 * wears `imported{source, line}`, and the highest line imported is where the
 * next read starts. There is no cursor column to keep current.
 *
 * ```ts
 * import { start } from '@yaks/spawn'
 *
 * // one batch is the whole request
 * // await graph.apply([
 * //   { entity: { eid: '$s' }, session: {} },
 * //   { entity: { eid: '$e' }, entry: { session: '$s' },
 * //     content: { body: 'fix T-1' },
 * //     using: { provider: claude, model: opus, effort: 'high' } },
 * // ])
 * ```
 *
 * `@yaks/spawn/effects` answers that batch, and the same facet survives a
 * restart — a `process` row born for the process itself is this host starting,
 * and the effect on it re-adopts every run still going. A host composes the
 * one facet and writes no code at all.
 *
 * @module
 */

export * from './adapters.ts'
export * from './run.ts'
