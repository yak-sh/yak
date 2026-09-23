/// <reference lib="deno.ns" />
import { assert, assertEquals, assertRejects } from '@std/assert'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { ramVault, records, sealed, secrets, secretsDoc } from '@yaks/secrets'
import {
  authorization,
  AuthorizationError,
  type AuthorizationRecord,
  checkRecord,
} from './oauth.ts'

// Where a test's tokens are kept: secrets in a graph of their own, the way a
// host keeps them (@yaks/secrets `records`).
const kept = () => {
  const vocab = loadVocab([secretsDoc])
  const vault = ramVault()
  const g = graph({ storage: ram(vocab), vocab, plugins: [secrets(vault)] })
  return {
    g,
    vault,
    store: () => records<AuthorizationRecord>(g, vault, 'mcp ', checkRecord),
  }
}

const mock = () => {
  let exchanges = 0, refreshes = 0
  let challenge = ''
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname.includes('oauth-protected-resource')) {
      return Response.json({
        resource: 'https://service.test/mcp',
        authorization_servers: ['https://issuer.test'],
      })
    }
    if (url.pathname.includes('well-known')) {
      return Response.json({
        issuer: 'https://issuer.test',
        authorization_endpoint: 'https://issuer.test/authorize',
        token_endpoint: 'https://issuer.test/token',
        registration_endpoint: 'https://issuer.test/register',
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none'],
      })
    }
    if (url.pathname === '/register') {
      const body = JSON.parse(String(init?.body))
      assertEquals(body.redirect_uris, ['http://127.0.0.1:8765/oauth/callback'])
      return Response.json({ ...body, client_id: 'registered-client' }, {
        status: 201,
      })
    }
    if (url.pathname === '/token') {
      const body = new URLSearchParams(String(init?.body))
      if (body.get('grant_type') === 'refresh_token') {
        refreshes++
        assertEquals(body.get('refresh_token'), 'refresh-secret')
        return Response.json({
          access_token: 'refreshed-secret',
          refresh_token: 'rotated-secret',
          token_type: 'Bearer',
          expires_in: 3600,
        })
      }
      exchanges++
      assertEquals(body.get('code'), 'code-secret')
      const digest = new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(body.get('code_verifier')!),
        ),
      )
      assertEquals(
        btoa(String.fromCharCode(...digest)).replace(/=/g, '').replace(
          /\+/g,
          '-',
        ).replace(/\//g, '_'),
        challenge,
      )
      return Response.json({
        access_token: 'access-secret',
        refresh_token: 'refresh-secret',
        token_type: 'Bearer',
        expires_in: 60,
      })
    }
    throw new Error('Unexpected test URL ' + url.pathname)
  }
  return {
    fetcher,
    challenge: (v: string) => challenge = v,
    counts: () => ({ exchanges, refreshes }),
  }
}

Deno.test('paste OAuth uses SDK discovery/DCR/PKCE, validates callbacks and persists rotated tokens', async () => {
  const f = mock()
  let time = 1000
  const held = kept()
  const options = {
    serverUrl: 'https://service.test/mcp',
    store: held.store(),
    fetch: f.fetcher,
    now: () => time,
  }
  const a = authorization(options)
  const start = await a.begin()
  const url = new URL(start.url)
  f.challenge(url.searchParams.get('code_challenge')!)
  assertEquals(url.searchParams.get('code_challenge_method'), 'S256')
  assertEquals(url.searchParams.get('resource'), 'https://service.test/mcp')
  const callback = start.redirectUrl + '?code=code-secret&state=' +
    url.searchParams.get('state')
  await assertRejects(
    () => a.complete(callback.replace('127.0.0.1', 'evil.test')),
    AuthorizationError,
  )
  await assertRejects(
    () => a.complete(callback.replace('state=', 'state=wrong')),
    AuthorizationError,
  )
  assertEquals(f.counts().exchanges, 0)
  await a.complete(callback)
  assertEquals(await a.token(), 'access-secret')
  await assertRejects(() => a.complete(callback), AuthorizationError)
  const reopened = authorization({ ...options, store: held.store() })
  assertEquals(await reopened.token(), 'access-secret')
  time += 60000
  assertEquals(await reopened.token(), 'refreshed-secret')
  assertEquals(f.counts(), { exchanges: 1, refreshes: 1 })
  // The graph holds a handle; the vault holds tokens and nothing of the
  // exchange that minted them.
  const graphed = JSON.stringify(await held.g.read('.secret'))
  assert(!graphed.includes('refreshed-secret'))
  const contents = JSON.stringify(held.vault.all())
  assert(contents.includes('refreshed-secret'))
  assert(!contents.includes('code-secret'))
  assert(!contents.includes(url.searchParams.get('code_challenge')!))
  const other = authorization({
    ...options,
    serverUrl: 'https://other.test/mcp',
  })
  assertEquals(await other.token(), undefined)
})

Deno.test('pending authorization expires/cancels and callback failures do not leak or retry codes', async () => {
  const f = mock()
  let time = 0
  const a = authorization({
    serverUrl: 'https://service.test/mcp',
    store: kept().store(),
    fetch: f.fetcher,
    now: () => time,
  })
  let start = await a.begin()
  let callback = start.redirectUrl + '?code=secret&state=' +
    new URL(start.url).searchParams.get('state')
  time = 600001
  await assertRejects(
    () => a.complete(callback),
    AuthorizationError,
    'expired',
  )
  start = await a.begin()
  callback = start.redirectUrl + '?code=secret&state=' +
    new URL(start.url).searchParams.get('state')
  a.cancel()
  await assertRejects(() => a.complete(callback), AuthorizationError)
  assertEquals(f.counts().exchanges, 0)
})

Deno.test('invalid authorization code is submitted once and error never echoes credentials', async () => {
  const f = mock()
  let calls = 0
  const a = authorization({
    serverUrl: 'https://service.test/mcp',
    store: kept().store(),
    fetch: (input, init) => {
      if (String(input).endsWith('/token')) {
        calls++
        return Promise.resolve(
          Response.json({
            error: 'invalid_grant',
            error_description: 'secret-code-value',
          }, { status: 400 }),
        )
      }
      return f.fetcher(input, init)
    },
  })
  const start = await a.begin()
  const callback = start.redirectUrl + '?code=secret-code-value&state=' +
    new URL(start.url).searchParams.get('state')
  const error = await assertRejects(
    () => a.complete(callback),
    AuthorizationError,
    'Token exchange failed',
  )
  assert(!error.message.includes('secret-code-value'))
  assertEquals(calls, 1)
  await assertRejects(() => a.complete(callback), AuthorizationError)
  assertEquals(calls, 1)
  assertEquals(await a.token(), undefined)
})

Deno.test('a kept record that is not a token set is refused', async () => {
  const held = kept()
  await held.g.apply([sealed('mcp a', JSON.stringify({ tokens: { x: 1 } }))])
  await assertRejects(() => held.store().read('a'), Error, 'Invalid OAuth')
})

Deno.test('cancellation during exchange cannot persist a late token; wrong issuer is rejected', async () => {
  const f = mock()
  const entered = Promise.withResolvers<void>(),
    released = Promise.withResolvers<void>()
  const a = authorization({
    serverUrl: 'https://service.test/mcp',
    store: kept().store(),
    fetch: async (input, init) => {
      if (String(input).endsWith('/token')) {
        entered.resolve()
        await released.promise
        return Response.json({
          access_token: 'late-secret',
          token_type: 'Bearer',
          expires_in: 3600,
        })
      }
      return f.fetcher(input, init)
    },
  })
  const start = await a.begin()
  const callback = start.redirectUrl + '?code=x&state=' +
    new URL(start.url).searchParams.get('state')
  await assertRejects(
    () => a.complete(callback + '&iss=https://wrong.test'),
    AuthorizationError,
    'issuer',
  )
  const completion = assertRejects(
    () => a.complete(callback),
    AuthorizationError,
  )
  await entered.promise
  a.cancel()
  released.resolve()
  await completion
  assertEquals(await a.token(), undefined)
})

Deno.test('authorization honors a resource challenge URL and scope', async () => {
  const f = mock()
  let discovered = false
  const a = authorization({
    serverUrl: 'https://service.test/mcp',
    store: kept().store(),
    fetch: (input, init) => {
      if (String(input) === 'https://service.test/resource-metadata') {
        discovered = true
        return Promise.resolve(
          Response.json({
            resource: 'https://service.test/mcp',
            authorization_servers: ['https://issuer.test'],
          }),
        )
      }
      return f.fetcher(input, init)
    },
  })
  const start = await a.begin({
    resourceMetadataUrl: 'https://service.test/resource-metadata',
    scope: 'tools:read tools:write',
  })
  assert(discovered)
  assertEquals(
    new URL(start.url).searchParams.get('scope'),
    'tools:read tools:write',
  )
  a.cancel()
})
