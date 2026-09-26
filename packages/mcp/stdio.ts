// The other MCP transport: stdin and stdout. It sits in a module of its own
// because it is the one part of the package that is not portable —
// `StdioServerTransport` reads the process's own streams, which a Cloudflare
// Worker does not have — so importing `@yaks/mcp` never pulls a runtime
// dependency in with it. An agent running on the same machine launches this;
// anything served over HTTP uses ./mount.ts.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { type Options, server } from './server.ts'

/**
 * Serve a graph over stdio, until the stream closes. The actor is whoever the
 * calling program passes — an agent running locally acts for its owner, and
 * there is no HTTP request to authenticate.
 *
 * ```ts ignore
 * // deno run -A serve.ts
 * await stdio({ graph, actor: { by: 'm1' } })
 * ```
 */
export let stdio = async (opts: Options): Promise<void> => {
  let built = server(opts)
  await opts.extend?.(built)
  await built.connect(new StdioServerTransport())
}
