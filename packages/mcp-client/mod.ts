/** MCP tools over Streamable HTTP, with no dependency on a session or a UI. */
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type {
  CallToolResult,
  Tool as RemoteTool,
} from '@modelcontextprotocol/sdk/types.js'
import type { Tool, ToolId } from '@yaks/graph'
import { argsOf } from '@yaks/graph/call'
import { errorsText, toolCheck } from '@yaks/vocab/tools'
import type { jsonSchemaValidator } from '@modelcontextprotocol/sdk/validation'

// The MCP SDK, imported the first time a connection is used rather than when
// this module is: a host with no server configured never loads it, and it is
// most of what a harness would otherwise load at start.
let sdkModules: Promise<Sdk> | undefined
type Sdk = {
  Client: typeof Client
  Transport: typeof StreamableHTTPClientTransport
  listChanged: typeof import('@modelcontextprotocol/sdk/types.js')[
    'ToolListChangedNotificationSchema'
  ]
  challenge: typeof import('@modelcontextprotocol/sdk/client/auth.js')[
    'extractWWWAuthenticateParams'
  ]
}
let loaded = (): Promise<Sdk> =>
  sdkModules ??= Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
    import('@modelcontextprotocol/sdk/types.js'),
    import('@modelcontextprotocol/sdk/client/auth.js'),
  ]).then(([client, http, types, auth]) => ({
    Client: client.Client,
    Transport: http.StreamableHTTPClientTransport,
    listChanged: types.ToolListChangedNotificationSchema,
    challenge: auth.extractWWWAuthenticateParams,
  }))

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

/**
 * A reply's structured content as the text a model reads, when the reply has
 * no text of its own. A server sends its answer twice, as text for a reader
 * and as `structuredContent` for a parser, and a model reads one of them: the
 * text, which the spec has carry the structured content's JSON and which is
 * all a client that reads only text sees. A reply that wrote no text is read
 * as its structured content.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let text = { type: 'text', text: 'https://example.test/mockup/1' }
 * let structuredContent = { saved: '<h1>mockup</h1>' }
 * assertEquals(unsaid({ content: [text], structuredContent }), undefined)
 * assertEquals(
 *   unsaid({ content: [], structuredContent }),
 *   '{"saved":"<h1>mockup</h1>"}',
 * )
 * ```
 */
export const unsaid = (
  reply: { content?: unknown[]; structuredContent?: unknown },
): string | undefined =>
  reply.structuredContent == null ||
    (reply.content ?? []).some((b) =>
      (b as { type?: unknown } | null)?.type == 'text'
    )
    ? undefined
    : JSON.stringify(reply.structuredContent)

/** A trusted server's configuration, shared across the application.
 * Credentials are resolved separately. */
export type Server = {
  name: string
  /** Friendly display label; defaults to name. */
  label?: string
  /** Local namespace for public tool names; defaults to name. */
  namespace?: string
  url: string
  /** The entity whose tunnel reaches the machine this server runs on. Its
   * `url` then stands at {@link MACHINE} and only its path is meant, and only
   * a host holding that tunnel can ask it, through the `fetch` it gives
   * `connect`. */
  machine?: string
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
/** Where a server on a machine stands: a tunnel reaches one machine whatever
 * host a request names, so its address is this origin and the server's path. */
export const MACHINE = 'http://machine'

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
    throw new Error(
      'MCP remote tool name cannot be exposed unchanged: ' + name,
    )
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
  /** What the server said to read before its tools, in its answer to
   * `initialize` (the protocol's `instructions`), or nothing where it said
   * none. It is the server's own text, as trusted as the server is. */
  instructions: () => Promise<string | undefined>
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
  if (server.machine && !options.fetch) {
    throw new MCPError(
      'An MCP server on a machine is asked through its tunnel',
      server.name,
    )
  }
  let ready: Promise<void> | undefined, closed = false, generation = 0
  let closePromise: Promise<void> | undefined
  let listing: Promise<RemoteTool[]> | undefined
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
      redirect: 'manual',
      signal: init?.signal
        ? AbortSignal.any([
          init.signal,
          AbortSignal.timeout(options.timeout ?? 60000),
        ])
        : AbortSignal.timeout(options.timeout ?? 60000),
    })
    // A machine's tunnel is its host's already: a 401 there asks for no sign-in.
    if (response.status === 401 && !server.machine) {
      unauthorized = true
      const found = (await loaded()).challenge(response)
      challenge = {
        resourceMetadataUrl: found.resourceMetadataUrl?.href,
        scope: found.scope,
      }
    }
    return response
  }
  // The client and its transport, made the first time the connection is used.
  let opened: Promise<[Client, StreamableHTTPClientTransport]> | undefined
  const open = () =>
    opened ??= loaded().then((m) => {
      const sdk = new m.Client(
        { name: 'yaks-mcp-client', version: '0.1.0' },
        { jsonSchemaValidator: schemas, capabilities: {} },
      )
      sdk.setNotificationHandler(m.listChanged, () => {
        generation++
        listing = undefined
      })
      return [sdk, new m.Transport(url, { fetch: fetcher })]
    })
  const ensure = async (): Promise<Client> => {
    if (closed) throw new MCPError('MCP connection is closed', server.name)
    const [sdk, transport] = await open()
    await (ready ??= sdk.connect(transport).catch(async () => {
      await sdk.close().catch(() => {})
      if (unauthorized) {
        throw new MCPAuthorizationRequired(server.name, challenge)
      }
      throw new MCPError(
        server.machine
          ? 'MCP connection failed; the machine may be off, or not open this path to its tunnel'
          : 'MCP connection failed; check server URL and sign-in',
        server.name,
      )
    }))
    return sdk
  }
  const list = async (): Promise<RemoteTool[]> => {
    const sdk = await ensure()
    if (!listing) {
      unauthorized = false
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
            throw new MCPError(
              'MCP discovery exceeded 1000 tools',
              server.name,
            )
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
      })().catch((e) => {
        if (unauthorized) {
          throw new MCPAuthorizationRequired(server.name, challenge)
        }
        throw e
      })
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
    const sdk = await ensure()
    if (server.allow && !server.allow.includes(name)) {
      throw new MCPError('Tool not allowed', server.name)
    }
    unauthorized = false
    try {
      return await sdk.callTool({ name, arguments: args }, undefined, {
        signal,
        timeout: options.timeout ?? 60000,
      }) as CallToolResult
    } catch {
      if (unauthorized) {
        throw new MCPAuthorizationRequired(server.name, challenge)
      }
      // Do not expose endpoint response bodies or credentials, or retry uncertain writes.
      throw new MCPError(
        'MCP call failed; remote outcome may be unknown. No retry was performed.',
        server.name,
      )
    }
  }
  return {
    list,
    instructions: async () => (await ensure()).getInstructions() || undefined,
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
        ...(t.title ?? t.annotations?.title
          ? { title: t.title ?? t.annotations?.title }
          : {}),
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
        // graph stores text: the reply's text blocks, or its structured
        // content where it wrote none ({@link unsaid}), written as one entity
        // recording which call produced it. A caller that needs the reply
        // whole — artifacts, resources, the error flag — calls the
        // connection's own `call` instead.
        run: async (asked) => {
          let reply = await call(t.name, argsOf(asked))
          let blocks = (reply.content ?? []) as Record<string, unknown>[]
          let said = blocks
            .filter((block) => block.type == 'text')
            .map((block) => String(block.text ?? ''))
          let structured = unsaid(reply)
          if (structured) said.push(structured)
          return [{
            entity: { eid: '$said' },
            content: { body: said.join('\n') },
            output: { source: asked.entity.eid },
            ...(reply.isError ? { refusal: { code: 'mcp_tool' } } : {}),
          }]
        },
      })))
    },
    close: (): Promise<void> =>
      closePromise ??= (async () => {
        closed = true
        // Never used, nothing was opened; an opening under way ends first.
        if (!opened) return
        const [sdk, transport] = await opened
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
