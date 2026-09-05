// The other door: stdin and stdout. It is alone in this file because it is the
// one part of the package that is not portable — `StdioServerTransport` reads
// the process's own streams, which a Worker does not have — so importing
// `@yaks/mcp` never drags a runtime in with it. A local agent launches this;
// everything hosted uses ./mount.ts.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { type Options, server } from './server.ts'

/**
 * Serve a graph over stdio, until the stream closes. The actor is whoever the
 * host says is at the keyboard — a local agent speaks for its owner, and there
 * is no request to authenticate.
 *
 * ```ts
 * // deno run -A serve.ts
 * await stdio({ graph, actor: { eid: 'm1' } })
 * ```
 */
export let stdio = async (opts: Options): Promise<void> => {
  let built = server(opts)
  await opts.extend?.(built)
  await built.connect(new StdioServerTransport())
}
