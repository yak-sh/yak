/**
 * @yaks/harness — an agent harness with nothing under it but a file.
 *
 * A session in the fleet is a process the server spawns, watched by a daemon,
 * writing into the live graph. This package is the same session with all three
 * removed: one SQLite file it makes itself, the {@link agent} loop in this
 * process, and no server anywhere. It is the composition, not new machinery —
 *
 * ```
 * open()          the file, the vocabulary, the plugins        (./store.ts)
 * harnessTools()  the shell (@yaks/process) + the graph tier (@yaks/mcp)
 * agent()         the seed, the daemon (@yaks/session), the doors (./run.ts)
 * plugin          the verbs, over @yaks/cli                      (./cli.ts)
 * ```
 *
 * — and every one of those four lines is a package doing its own job.
 *
 * ```ts
 * import { agent, open } from '@yaks/harness'
 *
 * let a = agent({ h: open(':memory:'), model: fake })
 * let s = await a.start('reply with the word pong')
 * await a.idle(s)
 * for (let e of await a.transcript(s)) console.log(a.line(e))
 * ```
 *
 * Everything it does is bundles in and queries out — the transcript IS
 * entities, the work IS `task` entities, what it ran IS `process` entities —
 * so the same rows move into the fleet's graph the day the harness is pointed
 * at it, with no export step and no second model of anything.
 *
 * The command is the other export (`deno run -A jsr:@yaks/harness/bin`):
 * `new`, `send`, `ls`, `show`, `models`.
 *
 * @module
 */

export * from './store.ts'
export * from './tools.ts'
export * from './run.ts'
export { plugin } from './cli.ts'
