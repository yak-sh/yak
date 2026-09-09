/**
 * @yaks/process — a running program as an entity, so whatever needs one can
 * point at it instead of keeping a pid of its own.
 *
 * - `process{pid, command, cwd}` — a program on a host; `command`/`cwd` are
 *   present exactly when we launched it.
 * - `exit{code}` — it is over, and how. Absent means running.
 * - output is `content{body, source}` (@yaks/session), `source` the process.
 *
 * ```ts
 * import { launch, store, watch } from '@yaks/process'
 *
 * // let processes = store(graph)
 * // let run = await launch(processes, { command: 'sh', args: ['-c', 'echo hi'] })
 * // await run.done            // 0, and the line is a content entry
 * // await watch(processes)    // at boot: pick the unfinished ones back up
 * ```
 *
 * Three entry points over one loop: {@link launch} starts a process detached
 * (a setsid wrapper in its own systemd user scope, a pidfile, two stream
 * files), {@link adopt} tracks one nobody here started, and {@link watch}
 * re-adopts every row with no `exit` at boot and stamps the ones already gone.
 * The supervisor can restart without taking any of them with it, which is the
 * only reason the launcher is shaped the way it is.
 *
 * @module
 */

export * from './comp.ts'
export * from './store.ts'
export * from './plugin.ts'
export * from './run.ts'
