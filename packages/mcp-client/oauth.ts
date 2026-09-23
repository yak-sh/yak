import {
  type Attempt,
  attempt,
  type AuthorizationStore as Store,
} from '@yaks/oauth'
/** Browser authorization with a pasted callback. No UI, filesystem, or session dependency. */
import {
  auth,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'

export type AuthorizationRecord = {
  discovery?: OAuthDiscoveryState
  client?: OAuthClientInformationMixed
  tokens?: OAuthTokens
  expiresAt?: number
}
/** Implementations serialize update for the whole read/refresh/write operation. */
export type AuthorizationStore = Store<AuthorizationRecord>
/** Refuse a kept record whose tokens are not a token set — the check a store
 * of these records runs on every read (@yaks/secrets `records`). */
export const checkRecord = (record: AuthorizationRecord): void => {
  if (
    record.tokens &&
    (typeof record.tokens.access_token !== 'string' ||
      typeof record.tokens.token_type !== 'string' ||
      (record.tokens.refresh_token != null &&
        typeof record.tokens.refresh_token !== 'string'))
  ) throw new Error('Invalid OAuth credential record')
}
export type AuthorizationOptions = {
  serverUrl: string
  redirectUrl?: string
  clientId?: string
  clientMetadataUrl?: string
  scope?: string
  store: AuthorizationStore
  fetch?: typeof fetch
  now?: () => number
}
export type AuthorizationChallenge = {
  resourceMetadataUrl?: string
  scope?: string
}
export type Authorization = {
  begin(
    challenge?: AuthorizationChallenge,
  ): Promise<{ url: string; redirectUrl: string }>
  complete(callback: string): Promise<void>
  token(): Promise<string | undefined>
  cancel(): void
}
export class AuthorizationError extends Error {}

/** Pending verifiers are memory-only. Restarting requires beginning a new authorization. */
export const authorization = (options: AuthorizationOptions): Authorization => {
  const redirect = new URL(
    options.redirectUrl ?? 'http://127.0.0.1:8765/oauth/callback',
  )
  const server = new URL(options.serverUrl)
  for (const u of [server, redirect]) {
    if (
      u.username || u.password || (u.protocol !== 'https:' &&
        !(u.protocol === 'http:' &&
          ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)))
    ) {
      throw new AuthorizationError(
        'OAuth requires HTTPS or a loopback HTTP URL',
      )
    }
  }
  if (redirect.search || redirect.hash) {
    throw new AuthorizationError(
      'Redirect URL must not contain a query or fragment',
    )
  }
  const now = options.now ?? Date.now
  const key = JSON.stringify([
    server.href,
    redirect.href,
    options.clientId ?? '',
    options.clientMetadataUrl ?? '',
    options.scope ?? '',
  ])
  let pending: Attempt | undefined
  let discovery: OAuthDiscoveryState | undefined
  let tail: Promise<unknown> = Promise.resolve()
  const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = tail.then(fn, fn)
    tail = next.catch(() => {})
    return next
  }
  const boundedFetch: typeof fetch = (input, init) => {
    const u = new URL(input instanceof Request ? input.url : String(input))
    if (
      u.protocol !== 'https:' && !(u.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname))
    ) {
      throw new AuthorizationError('OAuth endpoint requires HTTPS')
    }
    return (options.fetch ?? fetch)(input, {
      ...init,
      redirect: 'error',
      signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
    })
  }
  const provider = (
    record: AuthorizationRecord,
    redirectTo: (url: URL) => void,
  ): OAuthClientProvider => ({
    redirectUrl: redirect,
    clientMetadataUrl: options.clientMetadataUrl,
    clientMetadata: {
      application_type: redirect.protocol === 'http:' ? 'native' : 'web',
      client_name: 'yaks.app MCP client',
      redirect_uris: [redirect.href],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    state: () => {
      if (!pending) throw new AuthorizationError('Start authorization first')
      return pending.state
    },
    clientInformation: () =>
      options.clientId ? { client_id: options.clientId } : record.client,
    saveClientInformation: (value: OAuthClientInformationMixed) => {
      record.client = value
    },
    tokens: () => record.tokens,
    saveTokens: (value: OAuthTokens) => {
      record.tokens = value
      record.expiresAt = value.expires_in == null
        ? undefined
        : now() + value.expires_in * 1000
    },
    redirectToAuthorization: redirectTo,
    // The SDK otherwise retries exchanges after invalid_client/invalid_grant.
    // A consumed authorization code or rotated token must not be replayed.
    invalidateCredentials: () => {
      throw new AuthorizationError('Begin authorization again')
    },
    saveCodeVerifier: (value: string) => {
      if (!pending) {
        throw new AuthorizationError('Interactive authorization required')
      }
      pending.verifier = value
    },
    codeVerifier: () => {
      if (!pending?.verifier) {
        throw new AuthorizationError('Start authorization again')
      }
      return pending.verifier
    },
    discoveryState: () => discovery ?? record.discovery,
    saveDiscoveryState: (value: OAuthDiscoveryState) => {
      discovery = value
      record.discovery = value
    },
  })
  return {
    begin: (challenge) =>
      serialized(() =>
        options.store.update(key, async (record) => {
          pending = attempt(now())
          let url = ''
          const p = provider(record, (u) => {
            if (
              u.username || u.password || (u.protocol !== 'https:' &&
                !(u.protocol === 'http:' &&
                  ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)))
            ) {
              throw new AuthorizationError('Authorization URL requires HTTPS')
            }
            url = u.href
          })
          // Explicit sign-in starts a new consent flow, rather than refreshing an old grant.
          p.tokens = () => undefined
          if (challenge?.resourceMetadataUrl) p.discoveryState = () => undefined
          try {
            await auth(p, {
              serverUrl: server,
              scope: options.scope ?? challenge?.scope,
              resourceMetadataUrl: challenge?.resourceMetadataUrl
                ? new URL(challenge.resourceMetadataUrl)
                : undefined,
              fetchFn: boundedFetch,
            })
            if (!url || !pending?.verifier) {
              throw new Error('No authorization URL')
            }
            return { url, redirectUrl: redirect.href }
          } catch {
            pending = undefined
            throw new AuthorizationError(
              'Could not start OAuth. Check server discovery and client registration/redirect configuration.',
            )
          }
        })
      ),
    complete: (callback) =>
      serialized(() =>
        options.store.update(key, async (record) => {
          if (!pending || pending.until <= now()) {
            pending = undefined
            throw new AuthorizationError(
              'Authorization expired or not started; begin again',
            )
          }
          let u: URL
          try {
            u = new URL(callback.trim())
          } catch {
            throw new AuthorizationError('Paste the complete return URL')
          }
          if (
            u.origin + u.pathname !== redirect.origin + redirect.pathname ||
            u.hash || u.username || u.password ||
            u.searchParams.getAll('state').length !== 1 ||
            u.searchParams.get('state') !== pending.state
          ) {
            throw new AuthorizationError(
              'Return URL does not match the pending authorization',
            )
          }
          if (
            (discovery ?? record.discovery)?.authorizationServerMetadata
                    ?.authorization_response_iss_parameter_supported === true &&
              !u.searchParams.has('iss') ||
            u.searchParams.has('iss') &&
              (u.searchParams.getAll('iss').length !== 1 ||
                u.searchParams.get('iss') !==
                  (discovery ?? record.discovery)?.authorizationServerMetadata
                    ?.issuer)
          ) {
            throw new AuthorizationError('Return URL issuer does not match')
          }
          if (u.searchParams.has('error')) {
            pending = undefined
            throw new AuthorizationError(
              'Authorization was declined; begin again when ready',
            )
          }
          const code = u.searchParams.get('code')
          if (!code || u.searchParams.getAll('code').length !== 1) {
            throw new AuthorizationError(
              'Return URL has no single authorization code',
            )
          }
          const attempt = pending
          const p = provider(record, () => {
            throw new Error('Unexpected redirect')
          })
          const save = p.saveTokens.bind(p)
          p.saveTokens = (tokens: OAuthTokens) => {
            if (
              pending !== attempt || attempt.until <= now()
            ) {
              throw new AuthorizationError('Authorization cancelled or expired')
            }
            return save(tokens)
          }
          try {
            await auth(
              p,
              {
                serverUrl: server,
                authorizationCode: code,
                fetchFn: boundedFetch,
              },
            )
          } catch {
            throw new AuthorizationError(
              'Token exchange failed. Begin again; the code will not be retried.',
            )
          } finally {
            pending = undefined
          }
        })
      ),
    token: () =>
      serialized(async () => {
        const saved = await options.store.read(key)
        if (!saved?.tokens) return undefined
        if (
          saved.expiresAt == null || saved.expiresAt > now() + 30000
        ) return saved.tokens.access_token
        return options.store.update(key, async (record) => {
          if (!record.tokens) return undefined
          if (record.expiresAt == null || record.expiresAt > now() + 30000) {
            return record.tokens.access_token
          }
          if (!record.tokens.refresh_token) return undefined
          try {
            await auth(
              provider(record, () => {
                throw new Error('Sign-in required')
              }),
              {
                serverUrl: server,
                scope: options.scope,
                fetchFn: boundedFetch,
              },
            )
            return record.tokens?.access_token
          } catch {
            // A rotating refresh may have executed. Don't repeatedly replay it.
            record.tokens = undefined
            record.expiresAt = undefined
            return undefined
          }
        })
      }),
    cancel: () => {
      pending = undefined
    },
  }
}
