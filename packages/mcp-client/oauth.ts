/** Where an MCP server signs in, found the way the MCP spec says: its
 * protected-resource metadata (RFC 9728) names the authorization server, whose
 * own metadata (RFC 8414) names the endpoints, and a public client registers
 * there (RFC 7591) when the host has none. What comes back is data, an
 * integration as @yaks/connections takes it; the sign-in, the tokens and their
 * refresh are @yaks/oauth's over that data. No UI, storage or session. */
import {
  discoverOAuthServerInfo,
  registerClient,
} from '@modelcontextprotocol/sdk/client/auth.js'

export type AuthorizationChallenge = {
  resourceMetadataUrl?: string
  scope?: string
}

/** An MCP server's sign-in, as data, and how to register a client with it. */
export type Found = {
  integration: {
    name: string
    authorize: string
    token: string
    scopes?: string[]
    resource: string
    issuer?: string
    hosts: string[]
  }
  /** a public client for `redirect`, registered now: its id */
  register: (redirect: string) => Promise<string>
}

export class AuthorizationError extends Error {}

// HTTPS, or HTTP on this machine: what a code, a token or a registration may
// travel over.
const safe = (url: string | URL) => {
  const u = new URL(url)
  if (
    u.username || u.password || (u.protocol !== 'https:' &&
      !(u.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)))
  ) throw new AuthorizationError('OAuth requires HTTPS or a loopback URL')
  return u.href
}

/** Find where the server at `url` signs in. The integration is named for the
 * server, sends its tokens to the server's host alone, and asks for the grant
 * to be for the server (RFC 8707). */
export const discover = async (
  url: string,
  challenge: AuthorizationChallenge = {},
  fetch: typeof globalThis.fetch = globalThis.fetch,
): Promise<Found> => {
  const fetchFn: typeof globalThis.fetch = (input, init) =>
    fetch(safe(input instanceof Request ? input.url : String(input)), {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
    })
  const info = await discoverOAuthServerInfo(safe(url), {
    resourceMetadataUrl: challenge.resourceMetadataUrl
      ? new URL(challenge.resourceMetadataUrl)
      : undefined,
    fetchFn,
  })
  const meta = info.authorizationServerMetadata
  if (!meta) throw new AuthorizationError('The server names no sign-in')
  const scope = challenge.scope ??
    info.resourceMetadata?.scopes_supported?.join(' ')
  return {
    integration: {
      name: url,
      authorize: safe(meta.authorization_endpoint),
      token: safe(meta.token_endpoint),
      ...scope ? { scopes: scope.split(' ') } : {},
      resource: url,
      ...meta.authorization_response_iss_parameter_supported
        ? { issuer: meta.issuer }
        : {},
      hosts: [new URL(url).hostname],
    },
    register: async (redirect) =>
      (await registerClient(info.authorizationServerUrl, {
        metadata: meta,
        clientMetadata: {
          client_name: 'yaks.app MCP client',
          redirect_uris: [safe(redirect)],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        },
        fetchFn,
      })).client_id,
  }
}
