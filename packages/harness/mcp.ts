/** Host composition: shared MCP connections and the existing yak credential store. */
import { clients, type Server } from '@yaks/mcp-client'
import { tokenFor } from '@yaks/cli'
import { type Graph, type Tool as GraphTool, toolName } from '@yaks/graph'
import { type Tool, type ToolContext, ToolError } from '@yaks/session'
import { images } from './images.ts'

/** Explicit JSON configuration only; no repository or other agent config discovery. */
export const configuredMCP = (servers?: Server[]): Server[] => {
  const value: unknown = servers ??
    JSON.parse(Deno.env.get('HARNESS_MCP') ?? '[]')
  if (!Array.isArray(value)) {
    throw new Error('HARNESS_MCP must be an array of server configurations')
  }
  const names = new Set<string>()
  for (const s of value) {
    if (
      !s || typeof s.name !== 'string' || typeof s.url !== 'string' ||
      (s.credential != null && typeof s.credential !== 'string') ||
      (s.allow != null &&
        (!Array.isArray(s.allow) ||
          s.allow.some((x: unknown) => typeof x !== 'string'))) ||
      Object.keys(s).some((k) =>
        !['name', 'url', 'allow', 'credential'].includes(k)
      )
    ) {
      throw new Error(
        'Invalid MCP server configuration; use name, url, allow, credential',
      )
    }
    if (!s.name || names.has(s.name)) {
      throw new Error('MCP server names must be nonempty and unique')
    }
    names.add(s.name)
    const url = new URL(s.url)
    if (
      !['https:', 'http:'].includes(url.protocol) || url.username ||
      url.password
    ) throw new Error('MCP URL must be HTTP(S) without embedded credentials')
    if (s.credential && url.hostname !== s.credential) {
      throw new Error('MCP credential host must match the server hostname')
    }
  }
  return value as Server[]
}

export const mcpTools = (g: Graph, servers: Server[]) => {
  const connections = clients(servers, {
    token: (s) => s.credential ? tokenFor(s.credential) : null,
  })
  const store = images({}).store
  const ctx = {
    graph: g,
    actor: null,
    apply: g.apply.bind(g),
    read: g.read.bind(g),
  }
  const render = async (
    value: unknown,
    call?: ToolContext,
  ): Promise<string> => {
    const result = value as {
      content?: Record<string, unknown>[]
      structuredContent?: unknown
      isError?: boolean
    }
    if (!Array.isArray(result.content)) {
      throw new ToolError('mcp_result', 'Invalid MCP tool result')
    }
    const parts: string[] = []
    for (const block of result.content) {
      if (block.type === 'text') parts.push(String(block.text ?? ''))
      else if (
        block.type === 'image' || block.type === 'audio' ||
        (block.type === 'resource' &&
          typeof (block.resource as Record<string, unknown>)?.blob === 'string')
      ) {
        const item = block.type === 'resource'
          ? block.resource as Record<string, unknown>
          : block
        const data = String(item.data ?? item.blob ?? '')
        if (data.length > 28 * 1024 * 1024) {
          throw new ToolError(
            'mcp_result',
            'MCP binary result exceeds 20 MiB limit',
          )
        }
        let bytes: Uint8Array
        try {
          bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
        } catch {
          throw new ToolError('mcp_result', 'Invalid base64 MCP result')
        }
        if (bytes.length > 20 * 1024 * 1024) {
          throw new ToolError(
            'mcp_result',
            'MCP binary result exceeds 20 MiB limit',
          )
        }
        const record = await store(
          bytes,
          String(item.mimeType ?? 'application/octet-stream'),
        )
        const eid = 'artifact:' + record.address
        await g.apply([{ entity: { eid }, artifact: record }])
        if (call) {
          await g.apply([{
            entity: {
              eid: 'mcp-attachment:' + call.call.entity.eid + ':' +
                parts.length,
            },
            entry: { session: call.session },
            attachment: {
              artifact: eid,
              audience: 'user',
              call: call.call.entity.eid,
            },
            content: {
              body: `MCP artifact: ${eid}`,
              source: call.call.entity.eid,
            },
          }])
        }
        parts.push(
          `Artifact: ${eid} (${record.media_type}, ${record.size} bytes)`,
        )
      } else if (block.type === 'resource') {
        const r = block.resource as Record<string, unknown>
        parts.push(
          JSON.stringify({ uri: r?.uri, mimeType: r?.mimeType, text: r?.text }),
        )
      } else if (block.type === 'resource_link') {
        parts.push(
          JSON.stringify({
            type: block.type,
            uri: block.uri,
            name: block.name,
            mimeType: block.mimeType,
          }),
        )
      } else parts.push(`Unsupported MCP content type: ${String(block.type)}`)
    }
    if (result.structuredContent != null) {
      parts.push(JSON.stringify(result.structuredContent))
    }
    const text = parts.join('\n')
    if (result.isError) {
      throw new ToolError('mcp_tool', text || 'Remote tool returned an error')
    }
    return text
  }
  return {
    snapshot: async (): Promise<Tool[]> =>
      (await connections.tools()).map((t: GraphTool) => ({
        name: toolName(t),
        description: t.description,
        parameters: t.inputSchema!,
        run: async (args, call) => {
          try {
            return await render(await t.run(args, ctx), call)
          } catch (error) {
            if (error instanceof ToolError) throw error
            throw new ToolError(
              'mcp_transport',
              error instanceof Error ? error.message : 'MCP request failed',
            )
          }
        },
      })),
    close: connections.close,
  }
}
