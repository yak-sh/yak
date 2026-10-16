import type { Tool } from '@yaks/model'

/** A discovery-only MCP offer. No handler can execute a harness tool. */
export let offer = (tools: Tool[]) => {
  let path = '/' + crypto.randomUUID()
  let controller = new AbortController()
  let server = Deno.serve({
    hostname: '127.0.0.1',
    port: 0,
    signal: controller.signal,
    onListen: () => {},
  }, async (request) => {
    if (new URL(request.url).pathname != path) {
      return new Response(null, { status: 404 })
    }
    if (request.method != 'POST') return new Response(null, { status: 405 })
    let message = await request.json()
    if (message.id == null) return new Response(null, { status: 202 })
    let result: unknown
    switch (message.method) {
      case 'initialize':
        result = {
          protocolVersion: message.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'harness', version: '1' },
        }
        break
      case 'tools/list':
        result = {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.parameters,
          })),
        }
        break
      case 'ping':
        result = {}
        break
      // Claude may dispatch before stdout reaches us. Hold it until the child
      // is killed, rather than returning a fake result or allowing another turn.
      case 'tools/call':
        await new Promise<void>((resolve) => {
          if (controller.signal.aborted) resolve()
          else {controller.signal.addEventListener('abort', () => resolve(), {
              once: true,
            })}
        })
        return new Response(null, { status: 503 })
      default:
        return Response.json({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: 'Method not found' },
        })
    }
    return Response.json({ jsonrpc: '2.0', id: message.id, result })
  })
  return {
    config: JSON.stringify({
      mcpServers: {
        harness: {
          type: 'http',
          url: `http://127.0.0.1:${server.addr.port}${path}`,
        },
      },
    }),
    close: async () => {
      controller.abort()
      await server.finished
    },
  }
}
