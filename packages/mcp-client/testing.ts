// fetch as Workers gives it: the `error` redirect mode is refused outright,
// and a 3xx is followed, with the same request, unless the mode is `manual`.
export const edge = (fetcher: typeof fetch): typeof fetch => {
  const go: typeof fetch = async (input, init) => {
    const mode = init?.redirect ??
      (input instanceof Request ? input.redirect : 'follow')
    if (mode === 'error') {
      throw new TypeError(
        'Invalid redirect value, must be "follow" or "manual"',
      )
    }
    const res = await fetcher(input, init)
    const to = res.headers.get('location')
    return res.status >= 300 && res.status < 400 && to && mode !== 'manual'
      ? go(
        new URL(to, input instanceof Request ? input.url : String(input)),
        init,
      )
      : res
  }
  return go
}

export const fixture = () => {
  const calls: { method: string; params: Record<string, unknown> }[] = []
  const requests: Request[] = []
  let tools = [{
    name: 'publish_mockup',
    description: 'Publish a mockup',
    inputSchema: {
      type: 'object' as const,
      properties: { html: { type: 'string' } },
      required: ['html'],
    },
  }]
  let failCall = false, toolError = false
  const fetcher = edge(async (input, init) => {
    const req = new Request(input, init)
    requests.push(req)
    if (req.method === 'GET') return new Response(null, { status: 405 })
    if (req.method === 'DELETE') return new Response(null, { status: 200 })
    const body = await req.json()
    calls.push(body)
    if (!('id' in body)) return new Response(null, { status: 202 })
    if (failCall && body.method === 'tools/call') {
      return new Response('no', { status: 503 })
    }
    const result = body.method === 'initialize'
      ? {
        protocolVersion: '2025-06-18',
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: 'mock', version: '1' },
      }
      : body.method === 'tools/list'
      ? { tools }
      : {
        content: [{ type: 'text', text: 'https://example.test/mockup/1' }],
        structuredContent: { saved: body.params.arguments.html },
        isError: toolError,
      }
    return Response.json({ jsonrpc: '2.0', id: body.id, result }, {
      headers: { 'mcp-session-id': 'test-session' },
    })
  })
  return {
    calls,
    requests,
    fetcher,
    change: () => {
      tools = []
    },
    fail: () => {
      failCall = true
    },
    toolError: () => {
      toolError = true
    },
  }
}
