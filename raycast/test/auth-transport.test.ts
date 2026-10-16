import { strict as assert } from 'node:assert'
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { test } from 'node:test'
import {
  createAuthenticator,
  REDIRECT_URI,
  RESOURCE,
  type AuthOptions,
} from '../src/auth'
import { MCPClient } from '../src/transport'

async function probe(
  handler: (
    req: IncomingMessage,
    res: ServerResponse,
    body: string,
  ) => void | Promise<void>,
) {
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    try {
      await handler(req, res, body)
    } catch (error) {
      res.writeHead(500)
      res.end()
      throw error
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  }
}
const reply = (res: ServerResponse, value: unknown, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(value))
}

test('public PKCE DCR, resource indicators, secure token save and refresh rotation', async () => {
  let url = ''
  const grants: URLSearchParams[] = []
  const server = await probe((req, res, body) => {
    if (req.url === '/.well-known/oauth-authorization-server')
      return reply(res, {
        issuer: url,
        authorization_endpoint: `${url}/authorize`,
        token_endpoint: `${url}/token`,
        registration_endpoint: `${url}/register`,
      })
    if (req.url === '/register') {
      assert.deepEqual(JSON.parse(body), {
        client_name: 'Yak Raycast',
        redirect_uris: [REDIRECT_URI],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      })
      return reply(res, { client_id: 'probe-client' })
    }
    const params = new URLSearchParams(body)
    assert.equal(params.get('resource'), RESOURCE)
    assert.equal(params.get('client_id'), 'probe-client')
    assert.equal(req.headers.authorization, undefined)
    grants.push(params)
    reply(
      res,
      params.get('grant_type') === 'refresh_token'
        ? { access_token: 'refreshed-probe', expires_in: 900 }
        : {
            access_token: 'access-probe',
            refresh_token: 'refresh-probe',
            expires_in: 900,
          },
    )
  })
  url = server.url
  let registration: string | undefined
  let tokens: Record<string, unknown> | undefined
  let expired = false
  let authorizations = 0
  const auth = createAuthenticator({
    issuer: url,
    registration: {
      get: async () => registration,
      set: async (id) => {
        registration = id
      },
    },
    client: {
      getTokens: async () =>
        tokens && {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          isExpired: () => expired,
        },
      setTokens: async (
        value: Parameters<AuthOptions['client']['setTokens']>[0],
      ) => {
        tokens = value as unknown as Record<string, unknown>
      },
      removeTokens: async () => {
        tokens = undefined
      },
      authorizationRequest: async (
        options: Parameters<AuthOptions['client']['authorizationRequest']>[0],
      ) => {
        assert.equal(options.extraParameters?.resource, RESOURCE)
        assert.equal(options.extraParameters?.redirect_uri, REDIRECT_URI)
        return { codeVerifier: 'probe-verifier' }
      },
      authorize: async () => {
        authorizations++
        return { authorizationCode: 'probe-code' }
      },
    } as unknown as AuthOptions['client'],
  })
  try {
    assert.deepEqual(await Promise.all([auth(), auth()]), [
      'access-probe',
      'access-probe',
    ])
    assert.equal(await auth(), 'access-probe')
    assert.equal(authorizations, 1)
    expired = true
    assert.equal(await auth(), 'refreshed-probe')
    assert.equal(tokens?.refresh_token, 'refresh-probe')
    assert.equal(grants[0].get('code_verifier'), 'probe-verifier')
    assert.equal(grants[0].get('redirect_uri'), REDIRECT_URI)
    assert.equal(grants[1].get('refresh_token'), 'refresh-probe')
  } finally {
    await server.close()
  }
})

test('invalid refresh reauthenticates, discovery stays issuer-bound, registration errors omit provider secrets', async () => {
  for (const mode of [
    'invalid-grant',
    'foreign-issuer',
    'dcr-denied',
  ] as const) {
    let url = ''
    let removed = false
    let authorized = false
    const server = await probe((req, res, body) => {
      if (req.url?.includes('well-known'))
        return reply(res, {
          issuer: mode === 'foreign-issuer' ? 'https://evil.invalid' : url,
          authorization_endpoint: `${url}/authorize`,
          token_endpoint: `${url}/token`,
          registration_endpoint: `${url}/register`,
        })
      if (req.url === '/register')
        return reply(
          res,
          {
            error: 'invalid_client_metadata',
            error_description: 'secret-provider-text',
          },
          400,
        )
      if (new URLSearchParams(body).get('grant_type') === 'refresh_token')
        return reply(
          res,
          { error: 'invalid_grant', refresh_token: 'secret-provider-text' },
          400,
        )
      reply(res, { access_token: 'new-probe', expires_in: 900 })
    })
    url = server.url
    const auth = createAuthenticator({
      issuer: url,
      registration: {
        get: async () => (mode === 'dcr-denied' ? undefined : 'client'),
        set: async () => {},
      },
      client: {
        getTokens: async () => ({
          accessToken: 'old',
          refreshToken: 'expired',
          isExpired: () => true,
        }),
        setTokens: async () => {},
        removeTokens: async () => {
          removed = true
        },
        authorizationRequest: async () => ({ codeVerifier: 'proof' }),
        authorize: async () => {
          authorized = true
          return { authorizationCode: 'code' }
        },
      } as unknown as AuthOptions['client'],
    })
    try {
      if (mode === 'invalid-grant') {
        assert.equal(await auth(), 'new-probe')
        assert.ok(removed && authorized)
      } else
        await assert.rejects(
          auth(),
          (error: Error) =>
            !error.message.includes('secret-provider-text') &&
            error.message.includes(
              mode === 'dcr-denied' ? REDIRECT_URI : 'unexpected issuer',
            ),
        )
    } finally {
      await server.close()
    }
  }
})

test('authenticated MCP handshake, negotiated session, chunked SSE, JSON and decoded graph bundles', async () => {
  const calls: string[] = []
  const bundles = [{ entity: { eid: 'probe' }, doc: { title: 'Probe' } }]
  const server = await probe((req, res, body) => {
    assert.equal(req.headers.authorization, 'Bearer probe-auth')
    const rpc = JSON.parse(body)
    calls.push(rpc.method)
    if (rpc.method === 'initialize') {
      res.setHeader('Mcp-Session-Id', 'session-probe')
      return reply(res, {
        jsonrpc: '2.0',
        id: rpc.id,
        result: { protocolVersion: '2025-03-26' },
      })
    }
    assert.equal(req.headers['mcp-session-id'], 'session-probe')
    assert.equal(req.headers['mcp-protocol-version'], '2025-03-26')
    if (rpc.method === 'notifications/initialized') {
      res.writeHead(202)
      res.end()
      return
    }
    if (rpc.params.name === 'json')
      return reply(res, {
        jsonrpc: '2.0',
        id: rpc.id,
        result: { content: [{ type: 'text', text: JSON.stringify(bundles) }] },
      })
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write(
      ': heartbeat\r\ndata: {"jsonrpc":"2.0","method":"notifications/message"}\r\n\r\n',
    )
    const event = `event: message\r\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { structuredContent: { result: bundles } } })}\r\n\r\n`
    for (let i = 0; i < event.length; i += 7) res.write(event.slice(i, i + 7))
    res.end()
  })
  const client = new MCPClient({
    endpoint: `${server.url}/mcp`,
    request: async (input, init) =>
      fetch(input, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers)),
          Authorization: 'Bearer probe-auth',
        },
      }),
  })
  try {
    assert.deepEqual(await client.call('sse'), bundles)
    assert.deepEqual(await client.call('json'), bundles)
    assert.deepEqual(calls, [
      'initialize',
      'notifications/initialized',
      'tools/call',
      'tools/call',
    ])
  } finally {
    await server.close()
  }
})

test('HTTP, tool, RPC and truncated SSE failures never replay a mutating call or leak bearer text', async () => {
  for (const mode of [
    '401',
    '500',
    'tool',
    'rpc',
    'truncated',
    'wrong-id',
  ] as const) {
    let mutations = 0
    const server = await probe((_req, res, body) => {
      const rpc = JSON.parse(body)
      if (rpc.method === 'initialize')
        return reply(res, {
          jsonrpc: '2.0',
          id: rpc.id,
          result: { protocolVersion: '2025-06-18' },
        })
      if (rpc.method === 'notifications/initialized') {
        res.writeHead(202)
        res.end()
        return
      }
      mutations++
      if (mode === '401' || mode === '500')
        return reply(res, { access_token: 'secret-never-show' }, Number(mode))
      if (mode === 'tool')
        return reply(res, {
          jsonrpc: '2.0',
          id: rpc.id,
          result: {
            isError: true,
            content: [
              { type: 'text', text: 'Refused Bearer secret-never-show' },
            ],
          },
        })
      if (mode === 'rpc')
        return reply(res, {
          jsonrpc: '2.0',
          id: rpc.id,
          error: {
            code: -32602,
            message: 'Bad argument refresh_token=secret-never-show',
          },
        })
      if (mode === 'wrong-id')
        return reply(res, { jsonrpc: '2.0', id: rpc.id + 1, result: {} })
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end(': heartbeat\n\n')
    })
    try {
      const client = new MCPClient({ endpoint: server.url, request: fetch })
      await assert.rejects(
        client.call('graph_apply', { bundles: [] }),
        (error: Error) =>
          !error.message.includes('secret-never-show') &&
          /MCP|Yak/.test(error.message),
      )
      assert.equal(mutations, 1)
    } finally {
      await server.close()
    }
  }
})
