/// <reference lib="deno.ns" />
import { assertEquals, assertRejects } from '@std/assert'
import { AuthorizationError, discover } from './oauth.ts'
import { edge } from './testing.ts'

// A server whose sign-in is at issuer.test, answering the discovery the MCP
// spec asks for and one registration.
const mock = (asked: string[] = []) => {
  const fetcher: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    asked.push(url.href)
    if (url.pathname.includes('oauth-protected-resource')) {
      return Promise.resolve(Response.json({
        resource: 'https://service.test/mcp',
        authorization_servers: ['https://issuer.test'],
        scopes_supported: ['read', 'write'],
      }))
    }
    if (url.pathname.includes('well-known')) {
      return Promise.resolve(Response.json({
        issuer: 'https://issuer.test',
        authorization_endpoint: 'https://issuer.test/authorize',
        token_endpoint: 'https://issuer.test/token',
        registration_endpoint: 'https://issuer.test/register',
        response_types_supported: ['code'],
        authorization_response_iss_parameter_supported: true,
      }))
    }
    const body = JSON.parse(String(init?.body))
    assertEquals(body.redirect_uris, ['http://127.0.0.1:8765/oauth/callback'])
    return Promise.resolve(
      Response.json({ ...body, client_id: 'registered' }, { status: 201 }),
    )
  }
  return edge(fetcher)
}

// The SDK's first discovery and registration pay its schemas' start-up; paid
// here, as the module loads, so each test's time is its own.
await (await discover('https://service.test/mcp', {}, mock())).register(
  'http://127.0.0.1:8765/oauth/callback',
)

Deno.test('discover: an MCP server’s sign-in as an integration, and a client registered there', async () => {
  const found = await discover('https://service.test/mcp', {}, mock())
  assertEquals(found.integration, {
    name: 'https://service.test/mcp',
    authorize: 'https://issuer.test/authorize',
    token: 'https://issuer.test/token',
    scopes: ['read', 'write'],
    resource: 'https://service.test/mcp',
    issuer: 'https://issuer.test',
    hosts: ['service.test'],
  })
  assertEquals(
    await found.register('http://127.0.0.1:8765/oauth/callback'),
    'registered',
  )
})

Deno.test('discover: a challenge names the metadata and the scope', async () => {
  const asked: string[] = []
  const found = await discover('https://service.test/mcp', {
    resourceMetadataUrl: 'https://service.test/meta/oauth-protected-resource',
    scope: 'only',
  }, mock(asked))
  assertEquals(asked[0], 'https://service.test/meta/oauth-protected-resource')
  assertEquals(found.integration.scopes, ['only'])
})

Deno.test('discover: a redirect is refused, not followed', async () => {
  const asked: string[] = []
  const found = mock(asked)
  const moved: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    return url.host === 'issuer.test'
      ? Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: 'https://elsewhere.test/meta' },
        }),
      )
      : found(input, init)
  }
  await assertRejects(() =>
    discover('https://service.test/mcp', {}, edge(moved))
  )
  assertEquals(asked.filter((u) => u.includes('elsewhere')), [])
})

Deno.test('discover: plain HTTP off this machine is refused', async () => {
  await assertRejects(
    () => discover('http://service.test/mcp', {}, mock()),
    AuthorizationError,
  )
})
