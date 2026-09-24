/**
 * @yaks/harness — an agent runner over a graph, and the host that runs it on
 * this machine.
 *
 * A session in the fleet is a process the server spawns, watched by a daemon,
 * writing into the live graph. The harness is the same session with the server
 * removed: the {@link agent} loop over any graph, written in bundles and read
 * in queries, so the same rows run on a box, in a Cloudflare Worker, or move
 * into the fleet's graph with no export step. It composes existing packages
 * rather than adding machinery —
 *
 * ```
 * agent()         the seed rows, the daemon (@yaks/session), and the
 *                 operations a caller needs                   (./agent.ts)
 * local()         agent() here: the SQLite file, the shell, a checkout per
 *                 child, MCP servers, the terminal       (@yaks/harness/local)
 * tools           the commands, over @yaks/cli                   (./cli.ts)
 * ```
 *
 * This door is the runner alone, and type-checks with only the web platform in
 * scope; nothing it imports names a machine.
 *
 * ```ts
 * import { agent } from '@yaks/harness'
 *
 * let a = agent({ h: { g, fx, vocab }, model: fake })
 * let s = await a.start('reply with the word pong')
 * await a.idle(s)
 * for (let e of await a.transcript(s)) console.log(a.line(e))
 * ```
 *
 * The command-line program is the other export
 * (`deno run -A jsr:@yaks/harness/bin`): `new`, `send`, `ls`, `show`,
 * `models`.
 *
 * @module
 */

export * from './agent.ts'
