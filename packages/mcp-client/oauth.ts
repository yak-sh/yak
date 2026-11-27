/** Where an MCP server signs in, found the way the MCP spec says: its
 * protected-resource metadata (RFC 9728) names the authorization server, whose
 * own metadata (RFC 8414) names the endpoints, and a public client is named
 * there by the host's own metadata document where the server takes one (a
 * Client ID Metadata Document, its URL the client's id), else registers there
 * (RFC 7591), when the host has none. What comes back is data, an
 * integration as @yaks/connections takes it; the sign-in, the tokens and their
 * refresh are @yaks/oauth's over that data. No UI, storage or session. */

// The SDK's discovery and registration, imported when a sign-in is looked for
// rather than when this module is (./mod.ts says why).
let auth = () =>
  import('@modelcontextprotocol/sdk/client/auth.js') as Promise<
    typeof import('@modelcontextprotocol/sdk/client/auth')
  >

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
    userinfo?: string
    scopes?: string[]
    resource: string
    issuer?: string
    hosts: string[]
  }
  /** a public client for `redirect`: the host's metadata document where the
   * server takes one, else one registered now; its id */
  register: (redirect: string) => Promise<string>
}

/** A public client's metadata (RFC 7591), and its id where it is a
 * document's URL. */
export type ClientDocument = {
  client_id?: string
  client_name: string
  redirect_uris: string[]
  grant_types: string[]
  response_types: string[]
  token_endpoint_auth_method: string
}

/** What the host's public client says of itself, returning to `redirect`:
 * what it registers with (RFC 7591), and its metadata document, served at
 * `id`, the URL that is its id where a server takes one.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let doc = client('https://h.test/oauth/client.json', 'https://h.test/cb')
 * assertEquals([doc.client_id, doc.redirect_uris], [
 *   'https://h.test/oauth/client.json', ['https://h.test/cb'],
 * ])
 * ```
 */
export const client = (
  id: string | undefined,
  redirect: string,
): ClientDocument => ({
  ...id ? { client_id: safe(id) } : {},
  client_name: 'yaks.app MCP client',
  redirect_uris: [safe(redirect)],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
})

export class AuthorizationError extends Error {}

// HTTPS, or HTTP on this machine: what a code, a token or a registration may
// travel over.
const safe = (url: string | URL): string => {
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
 * to be for the server (RFC 8707). `document` is the URL the host serves its
 * client's metadata document at ({@link client}), where it serves one. */
export const discover = async (
  url: string,
  challenge: AuthorizationChallenge = {},
  fetch: typeof globalThis.fetch = globalThis.fetch,
  document?: string,
): Promise<Found> => {
  const fetchFn: typeof globalThis.fetch = (input, init) =>
    fetch(safe(input instanceof Request ? input.url : String(input)), {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
    })
  const { discoverOAuthServerInfo, registerClient } = await auth()
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
      ...typeof meta.userinfo_endpoint == 'string'
        ? { userinfo: safe(meta.userinfo_endpoint) }
        : {},
      ...scope ? { scopes: scope.split(' ') } : {},
      resource: url,
      ...'authorization_response_iss_parameter_supported' in meta &&
          meta.authorization_response_iss_parameter_supported
        ? { issuer: meta.issuer }
        : {},
      hosts: [new URL(url).hostname],
    },
    register: async (redirect) =>
      document && meta.client_id_metadata_document_supported
        ? safe(document)
        : (await registerClient(info.authorizationServerUrl, {
          metadata: meta,
          clientMetadata: client(undefined, redirect),
          fetchFn,
        })).client_id,
  }
}
