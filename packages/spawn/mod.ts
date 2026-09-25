/**
 * @yaks/spawn — runs an agent CLI as a detached child process, and reads its
 * JSON-lines stdout back into the graph as a session transcript.
 *
 * This package defines no components. The session and its entries belong to
 * {@link https://jsr.io/@yaks/session | @yaks/session}, the running child
 * process is {@link https://jsr.io/@yaks/process | @yaks/process}'s `process`
 * component on that same entity, and what was asked for is the
 * `using{provider, model, effort}` component on the session's first entry.
 * This package connects the three:
 *
 * - **the command** — a `provider` entity whose transport is a command line,
 *   identified by name (`claude`, `codex`), plus the @yaks/session reader that
 *   says what each line of its output means ({@link adapters}).
 * - **the run** — {@link start} launches it through @yaks/process (a launcher
 *   that exits immediately, a wrapper in a session of its own),
 *   so the agent outlives the server that started it; {@link follow} reads its
 *   log into the transcript; {@link down} kills it.
 * - **restart** — {@link resume} picks up every child still running after a
 *   restart, watching the pid again and reading the log on from where the
 *   transcript left off. Nothing here reaps child processes.
 *
 * Each log line is imported exactly once, by @yaks/session's importer. An
 * entry read out of a log gets an `imported` component recording the source
 * file and line number, and the highest line number already imported is where
 * the next read begins, so there is no cursor property to keep up to date.
 *
 * ```ts
 * import { start } from '@yaks/spawn'
 *
 * // writing these two rows in one transaction is the whole request
 * // await graph.apply([
 * //   { entity: { eid: '$s' }, session: {} },
 * //   { entity: { eid: '$e' }, entry: { session: '$s' },
 * //     content: { body: 'fix T-1' },
 * //     using: { provider: claude, model: opus, effort: 'high' } },
 * // ])
 * ```
 *
 * `@yaks/spawn/effects` exports the handlers that run after that transaction
 * commits, and `@yaks/spawn/service` covers restarts: the duty the process that
 * stays up holds, which picks up every run still going. A server that lists
 * `@yaks/spawn` in its `plugins` config writes no code at all.
 *
 * @module
 */

export * from './adapters.ts'
export * from './run.ts'
