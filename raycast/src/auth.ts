import type { OAuth } from '@raycast/api'

export const RESOURCE = 'https://tasks.yak.sh/mcp'
const ISSUER = 'https://yaks.cloudflareaccess.com'
export const REDIRECT_URI = 'https://raycast.com/redirect/extension'
const CLIENT_KEY = 'yak-cloudflare-oauth-client-v1'

type Metadata = {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint: string
}
type Client = Pick<
  OAuth.PKCEClient,
  | 'getTokens'
  | 'setTokens'
  | 'removeTokens'
  | 'authorizationRequest'
  | 'authorize'
>
export type AuthOptions = {
  client: Client
  registration: {
    get(): Promise<string | undefined>
    set(id: string): Promise<void>
  }
  request?: typeof fetch
  issuer?: string
  resource?: string
}

// Only protocol error codes are displayed: provider bodies may contain credentials.
class OAuthFailure extends Error {
  constructor(
    public readonly code: string,
    status: number,
  ) {
    super(
      `Cloudflare OAuth failed (${status}, ${code}). Sign in again in Raycast.`,
    )
  }
}

/** Injectable OAuth boundary; production token storage remains Raycast's secure PKCE store. */
export function createAuthenticator(
  options: AuthOptions,
): () => Promise<string> {
  const request = options.request ?? fetch
  const issuer = options.issuer ?? ISSUER
  const resource = options.resource ?? RESOURCE
  let pending: Promise<string> | undefined
  async function json(
    url: string,
    init?: RequestInit,
  ): Promise<Record<string, unknown>> {
    let response: Response
    try {
      response = await request(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      })
    } catch {
      throw new Error(
        'Could not reach Cloudflare OAuth. Check your connection and try again.',
      )
    }
    const parsed: unknown = await response.json().catch(() => ({}))
    const body = parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {}
    if (!response.ok) {
      const code = [
          'invalid_grant',
          'invalid_client',
          'invalid_client_metadata',
          'access_denied',
        ].includes(String(body.error))
        ? String(body.error)
        : 'request_rejected'
      if (code === 'invalid_client_metadata') {
        throw new Error(
          `Cloudflare OAuth registration rejected. Allow ${REDIRECT_URI} in the Access application's Managed OAuth redirect URIs.`,
        )
      }
      throw new OAuthFailure(code, response.status)
    }
    return body
  }
  async function authenticate(): Promise<string> {
    const stored = await options.client.getTokens()
    if (stored?.accessToken && !stored.isExpired()) return stored.accessToken
    const metadata = (await json(
      `${issuer}/.well-known/oauth-authorization-server`,
    )) as Metadata
    if (
      metadata.issuer !== issuer ||
      ![
        metadata.authorization_endpoint,
        metadata.token_endpoint,
        metadata.registration_endpoint,
      ].every((value) => {
        try {
          return new URL(value).origin === issuer
        } catch {
          return false
        }
      })
    ) {
      throw new Error(
        'Cloudflare OAuth discovery returned an unexpected issuer or endpoint.',
      )
    }
    let clientId = await options.registration.get()
    if (!clientId) {
      const registration = await json(metadata.registration_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Yak Raycast',
          redirect_uris: [REDIRECT_URI],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        }),
      })
      if (typeof registration.client_id !== 'string') {
        throw new Error(
          'Cloudflare OAuth registration did not return a client ID.',
        )
      }
      clientId = registration.client_id
      await options.registration.set(clientId)
    }
    async function token(
      params: Record<string, string>,
    ): Promise<OAuth.TokenResponse> {
      const result = await json(metadata.token_endpoint, {
        method: 'POST',
        body: new URLSearchParams({
          ...params,
          client_id: clientId!,
          resource,
        }),
      })
      if (
        typeof result.access_token !== 'string' ||
        !result.access_token ||
        typeof result.expires_in !== 'number' ||
        result.expires_in <= 0
      ) {
        throw new Error('Cloudflare OAuth returned an invalid token response.')
      }
      return result as unknown as OAuth.TokenResponse
    }
    if (stored?.refreshToken) {
      try {
        const refreshed = await token({
          grant_type: 'refresh_token',
          refresh_token: stored.refreshToken,
        })
        refreshed.refresh_token ??= stored.refreshToken
        await options.client.setTokens(refreshed)
        return refreshed.access_token
      } catch (error) {
        if (
          !(error instanceof OAuthFailure) || error.code !== 'invalid_grant'
        ) {
          throw error
        }
        await options.client.removeTokens()
      }
    }
    const authorization = await options.client.authorizationRequest({
      endpoint: metadata.authorization_endpoint,
      clientId,
      scope: '',
      extraParameters: { resource, redirect_uri: REDIRECT_URI },
    })
    const { authorizationCode } = await options.client.authorize(authorization)
    const tokens = await token({
      grant_type: 'authorization_code',
      code: authorizationCode,
      code_verifier: authorization.codeVerifier,
      redirect_uri: REDIRECT_URI,
    })
    await options.client.setTokens(tokens)
    return tokens.access_token
  }
  return () => {
    pending ??= authenticate().finally(() => {
      pending = undefined
    })
    return pending
  }
}

let authenticator: Promise<() => Promise<string>> | undefined
/** Sign in through existing Cloudflare Access OAuth, refreshing securely stored tokens as needed. */
export async function getAccessToken(): Promise<string> {
  authenticator ??= import('@raycast/api').then(({ OAuth, LocalStorage }) =>
    createAuthenticator({
      client: new OAuth.PKCEClient({
        redirectMethod: OAuth.RedirectMethod.Web,
        providerName: 'Yak · Cloudflare Access',
        providerId: 'yak-cloudflare-access',
      }),
      registration: {
        get: () => LocalStorage.getItem<string>(CLIENT_KEY),
        set: (id) => LocalStorage.setItem(CLIENT_KEY, id),
      },
    })
  )
  return (await authenticator)()
}
