// The other MCP transport: stdin and stdout. It sits in a module of its own
// because it is the one part of the package that is not portable —
// The SDK stdio entry reads the process's own streams, which a Cloudflare
// Worker does not have — so importing `@yaks/mcp` never pulls a runtime
// dependency in with it. An agent running on the same machine launches this;
// anything served over HTTP uses ./mount.ts.

import {
  serveStdio,
  type StdioServerHandle,
} from '@modelcontextprotocol/server/stdio'
import type { Transport } from '@modelcontextprotocol/server'
import { type Options, server } from './server.ts'

/**
 * Serve a graph over stdio until the stream closes, or `close()` on the handle
 * it returns. The actor is whoever the calling program passes — an agent
 * running locally acts for its owner, and there is no HTTP request to
 * authenticate. The connection's opening picks its protocol era, and one
 * server built for it serves the rest.
 *
 * `wire` is the connection when it is not the process's own stdin and stdout:
 * a stdio transport over a socket, say.
 *
 * ```ts ignore
 * // deno run -A serve.ts
 * stdio({ graph, actor: { by: 'm1' } })
 * ```
 */
export let stdio = (opts: Options, wire?: Transport): StdioServerHandle =>
  serveStdio(async () => {
    let built = server(opts)
    await opts.extend?.(built)
    await opts.skills?.(built)
    return built
  }, wire ? { transport: wire } : {})
