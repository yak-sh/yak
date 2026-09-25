/**
 * @yaks/process — a running program as an entity, so whatever needs one can
 * point at it instead of keeping a pid of its own.
 *
 * - `service{command, cwd, restart, attempts}` — a program that should run,
 *   stored on the same entity its process lands on. The supervisor acts on
 *   this component, and a `stop` component beside it means the program is no
 *   longer wanted.
 * - `process{pid, command, cwd}` — a program running on this machine;
 *   `command` and `cwd` are present exactly when we launched it.
 * - `exit{code}` — it is over, and how. Absent means running.
 * - output is `content{body}` plus `output{source}` (@yaks/session), where
 *   `source` names the process.
 *
 * The program doing the launching is one too: {@link started} and
 * {@link ended} return the components a process writes about itself on the way
 * in and the way out (./self.ts). That is the entity the server signs its
 * writes with, and the one a start-up effect handler fires on.
 *
 * ```ts
 * import { launch, store, supervise, watch } from '@yaks/process'
 *
 * // let processes = store(graph)
 * // let run = await launch(processes, { command: 'sh', args: ['-c', 'echo hi'] })
 * // await run.done            // 0, and the line is a content entry
 * // await watch(processes)    // at start-up: pick the unfinished ones back up
 * // let pass = supervise(processes)   // then drive it from your own timer
 * ```
 *
 * Four entry points over one loop: {@link launch} starts a process detached
 * (a wrapper in a session of its own, beyond the host's service manager, a
 * pidfile, a stdout file and a stderr file), {@link adopt} tracks one nobody
 * here started, {@link watch} adopts every row with no `exit` again at
 * start-up and records an exit code for the ones already gone, and
 * {@link supervise} makes the machine match the `service` rows — start, start
 * again with a bounded backoff, stop. The server can restart without taking
 * any of those processes with it, which is the only reason the launcher is
 * shaped the way it is, and exactly one supervisor sits above it (see
 * ./run.ts).
 *
 * @module
 */

export * from './comp.ts'
export * from './self.ts'
export * from './store.ts'
export * from './plugin.ts'
export * from './run.ts'
