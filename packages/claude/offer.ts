import type { Tool } from '@yaks/model'

/** A JSON-RPC message the CLI sends its SDK-hosted MCP server. */
export type Message = {
  id?: number | string
  method?: string
  params?: Record<string, unknown>
}

/**
 * A discovery-only MCP server the CLI reaches over its control channel
 * (`mcp_message`): it answers `initialize`, `tools/list`, `ping` and
 * notifications, and returns nothing for `tools/call`, which is never
 * answered: the harness runs the call after the step, and the adapter ends
 * the process when it sees one.
 */
export let offer = (tools: Tool[]) =>
(
  message: Message,
): Record<string, unknown> | undefined => {
  let reply = (result: unknown) => ({
    jsonrpc: '2.0',
    // A notification is answered with an empty result, as the CLI asks.
    id: message.id ?? 0,
    result,
  })
  if (message.id == null) return reply({})
  switch (message.method) {
    case 'initialize':
      return reply({
        protocolVersion: message.params?.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'harness', version: '1' },
      })
    case 'tools/list':
      return reply({
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.parameters,
        })),
      })
    case 'ping':
      return reply({})
    case 'tools/call':
      return undefined
    default:
      return {
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: 'Method not found' },
      }
  }
}
