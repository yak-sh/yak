import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import {
  getOAuthApi,
  type OAuthHelpers,
} from '@cloudflare/workers-oauth-provider'
import { kv } from './binding-probe.ts'
import { consent } from './identity.ts'
import { replace } from './connected.ts'
import type { Env } from './env.ts'

// Connecting an assistant again replaces its grant, but only once the new one
// is in the client's hands (T-121901): a second consent leaves the grant the
// person already had standing, and only the exchange of the new grant's code
// (`replace`) takes it away. The provider keeps a store of its own, with the
// assistant registered once; each test's person is its own.
let grants = kv()
let provider = { OAUTH_KV: grants } as unknown as Env
let oauth = getOAuthApi<Env>({
  apiRoute: '/api',
  apiHandler: { fetch: () => new Response() },
  defaultHandler: { fetch: () => new Response() },
  authorizeEndpoint: '/oauth/authorize',
  tokenEndpoint: '/oauth/token',
}, provider)
let back = 'https://probe.invalid/cb'
let { clientId } = await oauth.createClient({
  redirectUris: [back],
  tokenEndpointAuthMethod: 'none',
})
// A grant the person holds for this assistant, as the provider keeps one (its
// stored shape, which every grant ever written still has).
let holding = (person: string, id: string) =>
  grants.put(
    `grant:${person}:${id}`,
    JSON.stringify({
      id,
      clientId,
      userId: person,
      scope: ['graph'],
      metadata: {},
      createdAt: 0,
      redirectUri: back,
    }),
  )
let held = async (person: string) =>
  (await oauth.listUserGrants(person)).items.map((g) => g.id).sort()
let authorization = {
  responseType: 'code' as const,
  clientId,
  redirectUri: back,
  scope: ['graph'],
  state: '',
  codeChallenge: 'c'.repeat(43),
  codeChallengeMethod: 'S256' as const,
}
await holding('p', 'held-grant')
await holding('q', 'older')
await holding('q', 'newer')
assertEquals(await held('q'), ['newer', 'older'])
// The provider's authorization contract, with grants in its in-memory KV:
// consent can retain or revoke its person's earlier grants without crypto.
let grantor: Pick<OAuthHelpers, 'completeAuthorization'> = {
  completeAuthorization: async (options) => {
    if (options.revokeExistingGrants !== false) {
      let { items } = await oauth.listUserGrants(options.userId)
      await Promise.all(
        items.filter((g) => g.clientId == options.request.clientId)
          .map((g) => oauth.revokeGrant(g.id, options.userId)),
      )
    }
    await holding(options.userId, 'consented')
    return { redirectTo: options.request.redirectUri }
  },
}

test('connecting again keeps the old grant until the new one is taken', async () => {
  await consent(grantor, authorization, 'p')
  let both = (await grants.list({ prefix: 'grant:p:' })).keys.map((k) => k.name)
  assertEquals(both.length, 2)
  assert(both.includes('grant:p:held-grant'))
})

test('the grant taken takes away the one it replaces', async () => {
  assertEquals(await replace(oauth, 'q', 'newer'), ['older'])
  assertEquals(await held('q'), ['newer'])
})
