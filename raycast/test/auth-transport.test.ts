import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  type AuthOptions,
  createAuthenticator,
  REDIRECT_URI,
  RESOURCE,
} from '../src/auth'
import { MCPClient } from '../src/transport'

const probe = (
  handler: (req: Request, body: string) => Response | Promise<Response>,
) => ({
  url: 'https://probe.invalid',
  request: (async (input, init) => {
    const req = new Request(input, init)
    return handler(req, await req.text())
  }) as typeof fetch,
})
const reply = (value: unknown, status = 200, headers?: HeadersInit) =>
  Response.json(value, { status, headers })

test('public PKCE DCR, resource indicators, secure token save and refresh rotation', async () => {
  let url = ''
  const grants: URLSearchParams[] = []
  const server = await probe((req, body) => {
    if (
      new URL(req.url).pathname === '/.well-known/oauth-authorization-server'
    ) {
      return reply({
        issuer: url,
        authorization_endpoint: `${url}/authorize`,
        token_endpoint: `${url}/token`,
        registration_endpoint: `${url}/register`,
      })
    }
    if (new URL(req.url).pathname === '/register') {
      assert.deepEqual(JSON.parse(body), {
        client_name: 'Yak Raycast',
        redirect_uris: [REDIRECT_URI],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      })
      return reply({ client_id: 'probe-client' })
    }
    const params = new URLSearchParams(body)
    assert.equal(params.get('resource'), RESOURCE)
    assert.equal(params.get('client_id'), 'probe-client')
    assert.equal(req.headers.get('authorization'), null)
    grants.push(params)
    return reply(
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
    request: server.request,
    registration: {
      get: () => Promise.resolve(registration),
      set: (id: string) => {
        registration = id
        return Promise.resolve()
      },
    },
    client: {
      getTokens: () =>
        Promise.resolve(
          tokens && {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            isExpired: () => expired,
          },
        ),
      setTokens: (
        value: Parameters<AuthOptions['client']['setTokens']>[0],
      ) => {
        tokens = value as unknown as Record<string, unknown>
        return Promise.resolve()
      },
      removeTokens: () => {
        tokens = undefined
        return Promise.resolve()
      },
      authorizationRequest: (
        options: Parameters<AuthOptions['client']['authorizationRequest']>[0],
      ) => {
        assert.equal(options.extraParameters?.resource, RESOURCE)
        assert.equal(options.extraParameters?.redirect_uri, REDIRECT_URI)
        return Promise.resolve({ codeVerifier: 'probe-verifier' })
      },
      authorize: () => {
        authorizations++
        return Promise.resolve({ authorizationCode: 'probe-code' })
      },
    } as unknown as AuthOptions['client'],
  })
  {
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
  }
})

test('invalid refresh reauthenticates, discovery stays issuer-bound, registration errors omit provider secrets', async () => {
  for (
    const mode of [
      'invalid-grant',
      'foreign-issuer',
      'dcr-denied',
    ] as const
  ) {
    let url = ''
    let removed = false
    let authorized = false
    const server = await probe((req, body) => {
      if (req.url?.includes('well-known')) {
        return reply({
          issuer: mode === 'foreign-issuer' ? 'https://evil.invalid' : url,
          authorization_endpoint: `${url}/authorize`,
          token_endpoint: `${url}/token`,
          registration_endpoint: `${url}/register`,
        })
      }
      if (new URL(req.url).pathname === '/register') {
        return reply(
          {
            error: 'invalid_client_metadata',
            error_description: 'secret-provider-text',
          },
          400,
        )
      }
      if (new URLSearchParams(body).get('grant_type') === 'refresh_token') {
        return reply(
          { error: 'invalid_grant', refresh_token: 'secret-provider-text' },
          400,
        )
      }
      return reply({ access_token: 'new-probe', expires_in: 900 })
    })
    url = server.url
    const auth = createAuthenticator({
      issuer: url,
      request: server.request,
      registration: {
        get: () =>
          Promise.resolve(mode === 'dcr-denied' ? undefined : 'client'),
        set: async () => {},
      },
      client: {
        getTokens: () =>
          Promise.resolve({
            accessToken: 'old',
            refreshToken: 'expired',
            isExpired: () => true,
          }),
        setTokens: () => {},
        removeTokens: () => {
          removed = true
          return Promise.resolve()
        },
        authorizationRequest: () => Promise.resolve({ codeVerifier: 'proof' }),
        authorize: () => {
          authorized = true
          return Promise.resolve({ authorizationCode: 'code' })
        },
      } as unknown as AuthOptions['client'],
    })
    {
      if (mode === 'invalid-grant') {
        assert.equal(await auth(), 'new-probe')
        assert.ok(removed && authorized)
      } else {
        await assert.rejects(
          auth(),
          (error: Error) =>
            !error.message.includes('secret-provider-text') &&
            error.message.includes(
              mode === 'dcr-denied' ? REDIRECT_URI : 'unexpected issuer',
            ),
        )
      }
    }
  }
})

test('authenticated MCP handshake, negotiated session, chunked SSE, JSON and decoded graph bundles', async () => {
  const calls: string[] = []
  const bundles = [{ entity: { eid: 'probe' }, doc: { title: 'Probe' } }]
  const server = await probe((req, body) => {
    assert.equal(req.headers.get('authorization'), 'Bearer probe-auth')
    const rpc = JSON.parse(body)
    calls.push(rpc.method)
    if (rpc.method === 'initialize') {
      return reply(
        {
          jsonrpc: '2.0',
          id: rpc.id,
          result: { protocolVersion: '2025-03-26' },
        },
        200,
        { 'Mcp-Session-Id': 'session-probe' },
      )
    }
    assert.equal(req.headers.get('mcp-session-id'), 'session-probe')
    assert.equal(req.headers.get('mcp-protocol-version'), '2025-03-26')
    if (rpc.method === 'notifications/initialized') {
      return new Response(null, { status: 202 })
    }
    if (rpc.params.name === 'json') {
      return reply({
        jsonrpc: '2.0',
        id: rpc.id,
        result: { content: [{ type: 'text', text: JSON.stringify(bundles) }] },
      })
    }
    const heartbeat =
      ': heartbeat\r\ndata: {"jsonrpc":"2.0","method":"notifications/message"}\r\n\r\n'
    const event = `event: message\r\ndata: ${
      JSON.stringify({
        jsonrpc: '2.0',
        id: rpc.id,
        result: { structuredContent: { result: bundles } },
      })
    }\r\n\r\n`
    return new Response(
      new ReadableStream({
        start(stream) {
          stream.enqueue(new TextEncoder().encode(heartbeat))
          for (let i = 0; i < event.length; i += 7) {
            stream.enqueue(new TextEncoder().encode(event.slice(i, i + 7)))
          }
          stream.close()
        },
      }),
      { headers: { 'Content-Type': 'text/event-stream' } },
    )
  })
  const client = new MCPClient({
    endpoint: `${server.url}/mcp`,
    request: (input, init) =>
      server.request(input, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers)),
          Authorization: 'Bearer probe-auth',
        },
      }),
  })
  {
    assert.deepEqual(await client.call('sse'), bundles)
    assert.deepEqual(await client.call('json'), bundles)
    assert.deepEqual(calls, [
      'initialize',
      'notifications/initialized',
      'tools/call',
      'tools/call',
    ])
  }
})

test('HTTP, tool, RPC and truncated SSE failures never replay a mutating call or leak bearer text', async () => {
  for (
    const mode of [
      '401',
      '500',
      'tool',
      'rpc',
      'truncated',
      'wrong-id',
    ] as const
  ) {
    let mutations = 0
    const server = await probe((_req, body) => {
      const rpc = JSON.parse(body)
      if (rpc.method === 'initialize') {
        return reply({
          jsonrpc: '2.0',
          id: rpc.id,
          result: { protocolVersion: '2025-06-18' },
        })
      }
      if (rpc.method === 'notifications/initialized') {
        return new Response(null, { status: 202 })
      }
      mutations++
      if (mode === '401' || mode === '500') {
        return reply({ access_token: 'secret-never-show' }, Number(mode))
      }
      if (mode === 'tool') {
        return reply({
          jsonrpc: '2.0',
          id: rpc.id,
          result: {
            isError: true,
            content: [
              { type: 'text', text: 'Refused Bearer secret-never-show' },
            ],
          },
        })
      }
      if (mode === 'rpc') {
        return reply({
          jsonrpc: '2.0',
          id: rpc.id,
          error: {
            code: -32602,
            message: 'Bad argument refresh_token=secret-never-show',
          },
        })
      }
      if (mode === 'wrong-id') {
        return reply({ jsonrpc: '2.0', id: rpc.id + 1, result: {} })
      }
      return new Response(': heartbeat\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    })
    {
      const client = new MCPClient({
        endpoint: server.url,
        request: server.request,
      })
      await assert.rejects(
        client.call('graph_apply', { bundles: [] }),
        (error: Error) =>
          !error.message.includes('secret-never-show') &&
          /MCP|Yak/.test(error.message),
      )
      assert.equal(mutations, 1)
    }
  }
})
