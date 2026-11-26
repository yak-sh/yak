import {
  getOAuthApi,
  type OAuthProviderOptions,
} from '@cloudflare/workers-oauth-provider'
import { type Host, url as hostUrl } from '@yaks/platform/host'
import { OAUTH } from '@yaks/platform/routes'
import type { Env } from './env.ts'

// The person is the only claim this platform puts into a grant.
export type Props = { person: string }

let YEAR = 365 * 24 * 60 * 60

type Serving =
  & Required<Pick<OAuthProviderOptions<Env>, 'apiHandler'>>
  & Pick<OAuthProviderOptions<Env>, 'defaultHandler' | 'tokenExchangeCallback'>
let absent = { fetch: () => new Response(null, { status: 404 }) }

/** The provider requires HTTP handlers even when only its token helper is
 * used. Identity supplies its handlers when it runs the provider as a door. */
export let providerOptions = (
  env: Env,
  serving: Serving = { defaultHandler: absent, apiHandler: absent },
): OAuthProviderOptions<Env> => ({
  ...serving,
  apiRoute: '/oauth/me',
  authorizeEndpoint: OAUTH.authorize,
  tokenEndpoint: OAUTH.token,
  clientRegistrationEndpoint: OAUTH.register,
  clientIdMetadataDocumentEnabled: env.CIMD != 'off',
  // The owner, 2026-09-05: "the oauth should never expire". A connector is a
  // door a person opened, and it closes when they close it and not before —
  // so the refresh token has no expiry (the library's own way of saying never
  // is an explicit `undefined`, which leaves the grant's KV row with no
  // expiration at all) and the access token lives a year, which is as near to
  // never as an integer TTL gets: the library will not take a value under a
  // minute and has no word for forever.
  //
  // Neither ceiling weakens revoking, which is what a person actually does:
  // `revokeGrant` deletes every token row along with the grant, so a
  // disconnected connector is refused on its next call whatever its token
  // said. The CLI's grants are the opposite by design and stay hours
  // (grants.ts) — those are pasted into a terminal, not held by a connector.
  accessTokenTTL: YEAR,
  refreshTokenTTL: undefined,
  clientRegistrationTTL: undefined,
  scopesSupported: [OAUTH.scope],
  resourceMetadata: {
    scopes_supported: [OAUTH.scope],
    resource_name: 'yaks.app',
  },
})

// Whether the resources an authorize request, a token request or a token
// names are this platform: every one on its own origin (`/mcp`, `/oauth/me`,
// or the origin bare, which our protected-resource metadata names). None
// named is ours too, as every token from before clients named one is. Any
// other is a server that named yaks.app as where it signs in, and a token
// for it would be a credential for the person's whole account in that
// server's hands (T-803). The provider is told no resource of its own:
// pinned, it would refuse a grant bound to the origin where a client names
// `/mcp`, and every connector holding one would be signed out (M-37923).
export let forUs = (resource: string | string[] | undefined, env: Host) =>
  [resource ?? []].flat().every((r) =>
    URL.canParse(r) && new URL(r).origin == new URL(hostUrl(env, '/')).origin
  )

/** The person an OAuth access token was granted for, the grant, and when it
 * ends, as the provider reads them from KV (asking.ts `asking`, which asks
 * the directory whether the grant still stands: grant-rows.ts `stands`). A
 * token for another resource is nobody here. */
export let unwrapped = async (env: Env, token: string) => {
  let held = await getOAuthApi<Env>(providerOptions(env), env).unwrapToken<
    Props
  >(token)
  if (!held || !forUs(held.audience, env)) return {}
  return {
    person: held.grant.props?.person,
    grant: held.grantId,
    until: held.expiresAt,
  }
}
