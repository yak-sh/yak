// OAuth grant projection: pagination, expiry, provider identification and
// duplicate installations, without a Worker or a second connection ledger.
import { assertEquals, assertRejects } from '@std/assert'
import type {
  ClientInfo,
  GrantSummary,
  OAuthHelpers,
} from '@cloudflare/workers-oauth-provider'
import { connectionsOf } from './connections.ts'

let grant = (
  clientId: string,
  rest: Partial<GrantSummary> = {},
): GrantSummary => ({
  id: `grant-${clientId}`,
  clientId,
  userId: 'person',
  createdAt: 10,
  metadata: {},
  scope: ['graph'],
  ...rest,
})

let provider = (
  pages: GrantSummary[][],
  names: Record<string, string> = {},
) => {
  let looked: string[] = []
  let users: string[] = []
  let oauth: Pick<OAuthHelpers, 'listUserGrants' | 'lookupClient'> = {
    listUserGrants: (person, options) => {
      users.push(person)
      let page = Number(options?.cursor ?? '0')
      return Promise.resolve({
        items: pages[page],
        ...(page + 1 < pages.length ? { cursor: String(page + 1) } : {}),
      })
    },
    lookupClient: (clientId) => {
      looked.push(clientId)
      let client: ClientInfo | null = clientId in names
        ? {
          clientId,
          clientName: names[clientId],
          redirectUris: [],
          tokenEndpointAuthMethod: 'none',
        }
        : null
      return Promise.resolve(client)
    },
  }
  return { oauth, looked, users }
}

Deno.test('connections: all pages, earliest active installation, stable order', async () => {
  let p = provider([
    [
      grant('new-chatgpt', {
        redirectUri: 'https://chatgpt.com/a',
        createdAt: 30,
      }),
      grant('custom', { createdAt: 50 }),
      grant('expired', { expiresAt: 100 }),
    ],
    [
      grant('claude', { redirectUri: 'https://claude.ai/a' }),
      grant('old-chatgpt', { redirectUri: 'https://chat.openai.com/a' }),
      grant('custom', { createdAt: 40 }),
    ],
  ], { custom: 'My agent', expired: 'Gone' })
  assertEquals(await connectionsOf(p.oauth, 'person', 100), [
    { id: 'chatgpt', provider: 'chatgpt', name: 'ChatGPT', connectedAt: 10 },
    { id: 'claude', provider: 'claude', name: 'Claude', connectedAt: 10 },
    { id: 'custom', name: 'My agent', connectedAt: 40 },
  ])
  assertEquals(p.users, ['person', 'person'])
  assertEquals(p.looked, ['custom'])
})

Deno.test('connections: local and older grants use explicit registered names', async () => {
  let p = provider([[
    grant('chat', { redirectUri: 'http://localhost:1234/callback' }),
    grant('code', { redirectUri: 'http://127.0.0.1:4567/callback' }),
    grant('desktop'),
    grant('cursor', { redirectUri: 'http://[::1]:1234/callback' }),
  ]], {
    chat: 'ChatGPT',
    code: 'Claude Code',
    desktop: 'Claude desktop',
    cursor: 'Cursor',
  })
  assertEquals((await connectionsOf(p.oauth, 'person')).map((c) => c.id), [
    'chatgpt',
    'claude',
    'claude-code',
    'cursor',
  ])
})

Deno.test('connections: callback identity requires an exact HTTPS hostname', async () => {
  let uris = [
    'https://chatgpt.com.evil.test/callback',
    'https://evil.test/chatgpt.com',
    'https://chatgpt.com@evil.test/callback',
    'http://chatgpt.com/callback',
    'https://claude.ai.evil.test/callback',
    'not a URL',
  ]
  let rows = uris.map((redirectUri, i) => grant(String(i), { redirectUri }))
  let names = Object.fromEntries(rows.map((g) => [g.clientId, 'ChatGPT']))
  let p = provider([rows], names)
  let found = await connectionsOf(p.oauth, 'person')
  assertEquals(found.length, uris.length)
  assertEquals(found.every((c) => c.provider === undefined), true)
})

Deno.test('connections: unknown registered clients stay visible; missing clients do not', async () => {
  let p = provider([[
    grant('unnamed'),
    grant('custom', { redirectUri: 'https://other.test/callback' }),
    grant('deleted'),
    grant('known', { redirectUri: 'https://claude.com/callback' }),
  ]], { unnamed: '', custom: 'Unlisted agent' })
  assertEquals(await connectionsOf(p.oauth, 'person'), [
    { id: 'claude', provider: 'claude', name: 'Claude', connectedAt: 10 },
    { id: 'unnamed', name: 'Other agent', connectedAt: 10 },
    { id: 'custom', name: 'Unlisted agent', connectedAt: 10 },
  ])
})

Deno.test('connections: unavailable metadata retains its grant without hiding other agents', async () => {
  let p = provider([[
    grant('https://unavailable.test/client.json'),
    grant('https://unavailable.test/client.json', { createdAt: 20 }),
    grant('known', { redirectUri: 'https://chatgpt.com/callback' }),
  ]])
  let looked = 0
  assertEquals(
    await connectionsOf({
      ...p.oauth,
      lookupClient: () => (looked++, Promise.resolve(undefined)),
    }, 'person'),
    [
      { id: 'chatgpt', provider: 'chatgpt', name: 'ChatGPT', connectedAt: 10 },
      {
        id: 'https://unavailable.test/client.json',
        name: 'Other agent',
        connectedAt: 10,
      },
    ],
  )
  assertEquals(looked, 1)
})

Deno.test('connections: storage failures remain errors', async () => {
  let p = provider([[grant('custom')]])
  await assertRejects(
    () =>
      connectionsOf({
        ...p.oauth,
        lookupClient: () => Promise.reject(new Error('KV unavailable')),
      }, 'person'),
    Error,
    'KV unavailable',
  )
})
