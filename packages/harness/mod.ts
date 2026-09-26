/**
 * @yaks/harness — an agent runner over a graph, and the host that runs it on
 * this machine.
 *
 * A session in the fleet is a transcript in the live graph, run by whichever
 * process works its effects. The harness is the same session with the server
 * removed: the {@link agent} loop over any graph, written in bundles and read
 * in queries, so the same rows run on a box, in a Cloudflare Worker, or move
 * into the fleet's graph with no export step. It composes existing packages
 * rather than adding machinery —
 *
 * ```
 * agent()         the seed rows, the runner lent (@yaks/session), and the
 *                 operations a caller needs                   (./agent.ts)
 * local()         agent() here, over a graph a config composed: the shell, a
 *                 checkout per child, MCP servers, the terminal
 *                                                        (@yaks/harness/local)
 * tools           its verbs, as `yak` tools                      (./runs.ts)
 * effects         `session_run`, lent this machine, where a `yak` host
 *                 lists the harness                           (./effects.ts)
 * ```
 *
 * This door is the runner alone, and type-checks with only the web platform in
 * scope; nothing it imports names a machine.
 *
 * ```ts ignore
 * import { agent } from '@yaks/harness'
 *
 * let a = agent({ h: { g, fx, vocab, me }, model: fake })
 * let s = await a.start('reply with the word pong')
 * await a.idle(s)
 * for (let e of await a.transcript(s)) console.log(a.line(e))
 * ```
 *
 * On a command line the harness is a `yak` plugin: `yak session new`,
 * `yak session send` and `yak model list` are its tools (./runs.ts), and
 * `--tui` draws a session as its terminal app (./view.ts).
 *
 * @module
 */

export * from './agent.ts'
