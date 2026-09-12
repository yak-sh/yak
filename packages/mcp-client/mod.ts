/** MCP tools over Streamable HTTP, independent of a session or UI host. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  type CallToolResult,
  type Tool as RemoteTool,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js'
import type { Tool } from '@yaks/graph'

/** Host-wide trusted server configuration. Credentials are resolved separately. */
export type Server = {
  name: string
  url: string
  /** Exact remote names; omission exposes all discovered tools. */
  allow?: string[]
  /** Private credential reference interpreted by the host. */
  credential?: string
}
export type Options = {
  token?: (server: Server) => string | null | Promise<string | null>
  fetch?: typeof fetch
  timeout?: number
}
export class MCPError extends Error {
  constructor(message: string, public readonly server: string) {
    super(message)
  }
}
/** Encode opaque remote names without collisions or inferring noun/verb semantics. */
export const nameOf = async (server: string, name: string): Promise<string> => {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify([server, name])),
  )
  return 'mcp_' +
    Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0'))
      .join('').slice(0, 60)
}

export type Connection = {
  list: () => Promise<RemoteTool[]>
  call: (
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<CallToolResult>
  refresh: () => void
  tools: () => Promise<Tool[]>
  close: () => Promise<void>
}
export type Clients = {
  tools: () => Promise<Tool[]>
  close: () => Promise<void>
}

/** One owned connection. connect/list are lazy; calls are never automatically replayed. */
export const connect = (server: Server, options: Options = {}): Connection => {
  const url = new URL(server.url)
  if (
    !['http:', 'https:'].includes(url.protocol) || url.username || url.password
  ) throw new Error('MCP requires an HTTP(S) URL without embedded credentials')
  const sdk = new Client({ name: 'yaks-mcp-client', version: '0.1.0' }, {
    capabilities: {},
  })
  let ready: Promise<void> | undefined, closed = false, generation = 0
  let closePromise: Promise<void> | undefined
  let listing: Promise<RemoteTool[]> | undefined
  sdk.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    generation++
    listing = undefined
  })
  const fetcher: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers)
    const token = await options.token?.(server)
    if (token) {
      if (
        url.protocol !== 'https:' &&
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      ) throw new MCPError('Credentials require HTTPS', server.name)
      headers.set('authorization', `Bearer ${token}`)
    }
    return (options.fetch ?? fetch)(input, {
      ...init,
      headers,
      redirect: 'error',
      signal: init?.signal
        ? AbortSignal.any([
          init.signal,
          AbortSignal.timeout(options.timeout ?? 60000),
        ])
        : AbortSignal.timeout(options.timeout ?? 60000),
    })
  }
  const transport = new StreamableHTTPClientTransport(url, { fetch: fetcher })
  const ensure = () => {
    if (closed) throw new MCPError('MCP connection is closed', server.name)
    return ready ??= sdk.connect(transport).catch(async () => {
      await sdk.close().catch(() => {})
      throw new MCPError(
        'MCP connection failed; check server URL and sign-in',
        server.name,
      )
    })
  }
  const list = async (): Promise<RemoteTool[]> => {
    await ensure()
    if (!listing) {
      const observed = generation
      const pending = (async () => {
        const all: RemoteTool[] = [], cursors = new Set<string>()
        let cursor: string | undefined
        do {
          const page = await sdk.listTools(cursor ? { cursor } : {}, {
            timeout: options.timeout ?? 60000,
          })
          all.push(...page.tools)
          cursor = page.nextCursor
          if (cursor && cursors.has(cursor)) {
            throw new MCPError('Repeated tools/list cursor', server.name)
          }
          if (cursor) cursors.add(cursor)
          if (all.length > 1000) {
            throw new MCPError('MCP discovery exceeded 1000 tools', server.name)
          }
        } while (cursor)
        const seen = new Set<string>()
        for (const t of all) {
          if (seen.has(t.name)) {
            throw new MCPError('Duplicate remote tool name', server.name)
          }
          seen.add(t.name)
        }
        return all.filter((t) => !server.allow || server.allow.includes(t.name))
      })()
      listing = pending
      pending.catch(() => {
        if (listing === pending) listing = undefined
      })
      const answer = await pending
      if (observed !== generation) listing = undefined
      return answer
    }
    return listing
  }
  const call = async (
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<CallToolResult> => {
    await ensure()
    if (server.allow && !server.allow.includes(name)) {
      throw new MCPError('Tool not allowed', server.name)
    }
    try {
      return await sdk.callTool({ name, arguments: args }, undefined, {
        signal,
        timeout: options.timeout ?? 60000,
      }) as CallToolResult
    } catch {
      // Do not expose endpoint response bodies or credentials, or retry uncertain writes.
      throw new MCPError(
        'MCP call failed; remote outcome may be unknown. No retry was performed.',
        server.name,
      )
    }
  }
  return {
    list,
    call,
    refresh: () => {
      generation++
      listing = undefined
    },
    tools: async (): Promise<Tool[]> =>
      Promise.all((await list()).map(async (t) => ({
        name: await nameOf(server.name, t.name),
        description: `[${server.name}] ${t.description ?? t.name}`,
        inputSchema: t.inputSchema,
        readOnly: t.annotations?.readOnlyHint,
        destructive: t.annotations?.destructiveHint,
        idempotent: t.annotations?.idempotentHint,
        openWorld: t.annotations?.openWorldHint,
        meta: { server: server.name, remoteName: t.name },
        run: (args) => call(t.name, args),
      }))),
    close: (): Promise<void> =>
      closePromise ??= (async () => {
        closed = true
        // A transport failure must not strand the local event stream.
        try {
          if (transport.sessionId) await transport.terminateSession()
        } finally {
          await sdk.close()
        }
      })(),
  }
}

/** Shared configured connections, usable by CLI, graph tools, or other hosts. */
export const clients = (
  servers: readonly Server[],
  options: Options = {},
): Clients => {
  const names = new Set<string>()
  for (const s of servers) {
    if (!s.name || names.has(s.name)) {
      throw new Error('MCP server names must be nonempty and unique')
    }
    names.add(s.name)
  }
  const all = servers.map((s) => connect(s, options))
  return {
    tools: async (): Promise<Tool[]> =>
      (await Promise.all(all.map((c) => c.tools()))).flat(),
    close: async () => {
      await Promise.all(all.map((c) => c.close()))
    },
  }
}
