import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import {
  getOAuthApi,
  type OAuthHelpers,
  OAuthProvider,
} from '@cloudflare/workers-oauth-provider'
import { challenge } from '@yaks/oauth'
import { kv } from './binding-probe.ts'
import { consent, unwrapped } from './identity.ts'
import { agentsOf, replace } from './connected.ts'
import type { Env } from './env.ts'

// Connecting an assistant again replaces its grant, but only once the new one
// is in the client's hands (T-121901): a second consent leaves the grant the
// person already had standing, and only the exchange of the new grant's code
// (`replace`) takes it away. The provider keeps a store of its own, with the
// assistant registered once; each test's person is its own.
let grants = kv()
let provider = { OAUTH_KV: grants } as unknown as Env
let config = {
  apiRoute: '/api',
  apiHandler: { fetch: () => new Response() },
  defaultHandler: { fetch: () => new Response() },
  authorizeEndpoint: '/oauth/authorize',
  tokenEndpoint: '/oauth/token',
}
let oauth = getOAuthApi<Env>(config, provider)
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

// A person who connected the assistant by the provider's own consent.
await consent(oauth, authorization, 'r', 'Probe agent')

test('a grant names its agent as consented, reading no registration', async () => {
  let looked: string[] = []
  let agents = await agentsOf({
    listUserGrants: (person, options) => oauth.listUserGrants(person, options),
    lookupClient: (id) => (looked.push(id), oauth.lookupClient(id)),
  }, 'r')
  assertEquals(agents.map((a) => a.name), ['Probe agent'])
  assertEquals(looked, [])
})

// A token the provider minted for another resource, before yaks.app refused
// to grant one (T-803), is nobody: a server that named yaks.app as where it
// signs in holds it, and it must not be the person at /mcp. One for yaks.app,
// or for no resource at all, is the person still.
test('a token for another resource is nobody', async () => {
  let verifier = 'v'.repeat(43)
  let token = async (resource?: string) => {
    let { redirectTo } = await consent(oauth, {
      ...authorization,
      codeChallenge: await challenge(verifier),
      ...resource ? { resource } : {},
    }, 's')
    let res = await new OAuthProvider<Env>(config).fetch(
      new Request('https://yaks.app/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: new URL(redirectTo).searchParams.get('code')!,
          client_id: clientId,
          redirect_uri: back,
          code_verifier: verifier,
        }).toString(),
      }),
      provider,
      { waitUntil: () => {}, passThroughOnException: () => {} } as never,
    )
    let { access_token } = await res.json()
    return (await unwrapped(provider, access_token)).person
  }
  assertEquals(
    [
      await token('https://remote.invalid/mcp'),
      await token('https://yaks.app/mcp'),
      await token(),
    ],
    [undefined, 's', 's'],
  )
})
