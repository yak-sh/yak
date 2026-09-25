import { extractWWWAuthenticateParams } from '@modelcontextprotocol/sdk/client/auth.js'
/** MCP tools over Streamable HTTP, with no dependency on a session or a UI. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  type CallToolResult,
  type Tool as RemoteTool,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { argsOf, type Tool, type ToolId } from '@yaks/graph'
import { errorsText, toolCheck } from '@yaks/vocab/tools'
import type { jsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/types.js'

// The SDK's default output validator is 2020-only; remote servers also declare
// draft-07. Use the same dialect-aware validation as local graph tools.
const schemas: jsonSchemaValidator = {
  getValidator<T>(schema: Record<string, unknown>) {
    const check = toolCheck(schema)
    return (input: unknown) => {
      const errors = check(input)
      return errors.length
        ? {
          valid: false as const,
          data: undefined,
          errorMessage: errorsText(errors),
        }
        : { valid: true as const, data: input as T, errorMessage: undefined }
    }
  },
}

/** A trusted server's configuration, shared across the application.
 * Credentials are resolved separately. */
export type Server = {
  name: string
  /** Friendly display label; defaults to name. */
  label?: string
  /** Local namespace for public tool names; defaults to name. */
  namespace?: string
  url: string
  /** Exact remote names; omission exposes all discovered tools. */
  allow?: string[]
  /** Explicit OAuth settings; tokens stay in the application's own storage. */
  oauth?: {
    redirectUrl?: string
    clientId?: string
    clientMetadataUrl?: string
    scope?: string
  }
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
export class MCPAuthorizationRequired extends MCPError {
  constructor(
    server: string,
    public readonly challenge: {
      resourceMetadataUrl?: string
      scope?: string
    } = {},
  ) {
    super('MCP sign-in required; open authorization in the host', server)
  }
}
/** Normalize only the local namespace, never the server's opaque tool name. */
export const namespaceOf = (name: string): string => {
  const namespace = name.trim().replace(/[^a-zA-Z0-9_-]+/g, '_')
  if (!namespace || !/[a-zA-Z0-9]/.test(namespace)) {
    throw new Error('MCP server name needs a readable alphanumeric namespace')
  }
  return namespace
}

/** A provider-safe name with the exact remote name retained after the separator. */
export const nameOf = (server: string, name: string): string => {
  const namespace = namespaceOf(server)
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error('MCP remote tool name cannot be exposed unchanged: ' + name)
  }
  const exposed = namespace + '__' + name
  if (exposed.length > 64) {
    throw new Error(
      'MCP tool name exceeds 64 characters: ' + exposed +
        '. Use a shorter server name or ask the server for a shorter tool name.',
    )
  }
  return exposed
}

/** Refuse normalized namespace collisions rather than hiding them behind hashes. */
export const checkNamespaces = (servers: readonly Server[]): void => {
  const used = new Set<string>()
  for (const server of servers) {
    const namespace = namespaceOf(server.namespace ?? server.name)
    if (used.has(namespace)) {
      throw new Error('Duplicate MCP namespace: ' + namespace)
    }
    used.add(namespace)
  }
}

/** Separators in opaque remote names can also create a cross-server collision. */
export const checkToolNames = (tools: readonly ToolId[]): void => {
  const names = new Set<string>()
  for (const tool of tools) {
    if (names.has(tool.name!)) {
      throw new Error('Duplicate MCP tool name: ' + tool.name)
    }
    names.add(tool.name!)
  }
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
    jsonSchemaValidator: schemas,
    capabilities: {},
  })
  let ready: Promise<void> | undefined, closed = false, generation = 0
  let closePromise: Promise<void> | undefined
  let listing: Promise<RemoteTool[]> | undefined
  sdk.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    generation++
    listing = undefined
  })
  let unauthorized = false
  let challenge: { resourceMetadataUrl?: string; scope?: string } = {}
  const fetcher: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers)
    const token = await options.token?.(server)
    if (token) {
      const target = new URL(
        input instanceof Request ? input.url : String(input),
      )
      if (target.origin !== url.origin) {
        throw new MCPError(
          'Refusing cross-origin credential forwarding',
          server.name,
        )
      }
      if (
        url.protocol !== 'https:' &&
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      ) throw new MCPError('Credentials require HTTPS', server.name)
      headers.set('authorization', `Bearer ${token}`)
    }
    const response = await (options.fetch ?? fetch)(input, {
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
    unauthorized = response.status === 401
    if (unauthorized) {
      const found = extractWWWAuthenticateParams(response)
      challenge = {
        resourceMetadataUrl: found.resourceMetadataUrl?.href,
        scope: found.scope,
      }
    }
    return response
  }
  const transport = new StreamableHTTPClientTransport(url, { fetch: fetcher })
  const ensure = () => {
    if (closed) throw new MCPError('MCP connection is closed', server.name)
    return ready ??= sdk.connect(transport).catch(async () => {
      await sdk.close().catch(() => {})
      if (unauthorized) {
        throw new MCPAuthorizationRequired(server.name, challenge)
      }
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
    tools: async (): Promise<Tool[]> => {
      const listed = await list()
      if (new Set(listed.map((t) => t.name)).size !== listed.length) {
        throw new Error('Duplicate remote MCP tool name')
      }
      return Promise.all(listed.map(async (t) => ({
        name: await nameOf(server.namespace ?? server.name, t.name),
        description: `[${server.label ?? server.name}] ${
          t.description ?? t.name
        }`,
        inputSchema: t.inputSchema,
        readOnly: t.annotations?.readOnlyHint,
        destructive: t.annotations?.destructiveHint,
        idempotent: t.annotations?.idempotentHint,
        openWorld: t.annotations?.openWorldHint,
        meta: { server: server.name, remoteName: t.name },
        // A tool on another server replies in the MCP result format, and this
        // graph stores text: the reply's text blocks, plus its structured
        // content when it sent any, written as one entity recording which call
        // produced it. A caller that needs the reply whole — artifacts,
        // resources, the error flag — calls the connection's own `call`
        // instead.
        run: async (asked) => {
          let reply = await call(t.name, argsOf(asked))
          let blocks = (reply.content ?? []) as Record<string, unknown>[]
          let said = blocks
            .filter((block) => block.type == 'text')
            .map((block) => String(block.text ?? ''))
          if (reply.structuredContent != null) {
            said.push(JSON.stringify(reply.structuredContent))
          }
          return [{
            entity: { eid: '$said' },
            content: { body: said.join('\n') },
            output: { source: asked.entity.eid },
            ...(reply.isError ? { error: { code: 'mcp_tool' } } : {}),
          }]
        },
      })))
    },
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

/** Several configured connections at once, usable from a CLI, from graph
 * tools, or from anywhere else. */
export const clients = (
  servers: readonly Server[],
  options: Options = {},
): Clients => {
  checkNamespaces(servers)
  const names = new Set<string>()
  for (const s of servers) {
    if (!s.name || names.has(s.name)) {
      throw new Error('MCP server names must be nonempty and unique')
    }
    names.add(s.name)
  }
  const all = servers.map((s) => connect(s, options))
  return {
    tools: async (): Promise<Tool[]> => {
      const tools = (await Promise.all(all.map((c) => c.tools()))).flat()
      checkToolNames(tools)
      return tools
    },
    close: async () => {
      await Promise.all(all.map((c) => c.close()))
    },
  }
}
