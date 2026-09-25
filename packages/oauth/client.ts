// The authorization-code client for a provider described as data (RFC 6749
// §4.1, with PKCE from RFC 7636): the link a person follows, the exchange of
// the code that comes back, and the refresh that keeps the grant alive.
//
// It keeps nothing of its own. The attempt in flight goes back to the caller,
// who holds it across the redirect however its host can (a sealed cookie, a
// short-lived record), because the request that begins and the request that
// completes may not share a process. The tokens go to the AuthorizationStore
// it is given — @yaks/secrets `records()` keeps them in a vault — and a
// refresh happens inside that store's update, so two callers refreshing one
// grant at once never both spend the refresh token. Web APIs only, so the same
// client runs under Deno and in a Worker.

import { type Attempt, attempt, type AuthorizationStore, pkce } from './mod.ts'

/** An OAuth provider as data: where a person authorizes, where codes and
 * refresh tokens are exchanged, and the client registered with it. */
export type Provider = {
  authorize: string
  token: string
  scopes?: string[]
  /** Extra authorize parameters the provider wants, such as Google's
   * `access_type: 'offline'` for a refresh token. They never replace the
   * flow's own (state, challenge, redirect). */
  params?: Record<string, string>
  /** The client registered with it; one that answers a key has none. */
  client?: { id: string; secret?: string }
  /** How a confidential client authenticates at the token endpoint: HTTP
   * Basic, which every server must accept (RFC 6749 §2.3.1), or in the form
   * body. A client with no secret sends its id in the body either way. */
  auth?: 'basic' | 'post'
  /** What the exchange answers: tokens, or an API key, as OpenRouter's PKCE
   * does. A key is kept as an access token that never expires, and its flow
   * carries no state: PKCE already binds the code to this attempt (RFC 9700
   * §2.1). */
  answers?: 'tokens' | 'key'
  /** The resource the grant is for (RFC 8707), as an MCP server asks: sent
   * with the link and with every exchange. */
  resource?: string
  /** The issuer every return must name (RFC 9207), for a server that says it
   * names one: a return from any other server is refused. */
  issuer?: string
}

/** One grant, as the store keeps it. `expires_at` is epoch milliseconds. */
export type Tokens = {
  access_token?: string
  token_type?: string
  refresh_token?: string
  expires_at?: number
  scope?: string
}

/** The provider's refusal, carrying its error code: `invalid_grant` is a grant
 * revoked or a refresh token already spent, and means connect again. */
export class OAuthError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'OAuthError'
    this.code = code
  }
}

export type Options = {
  store: AuthorizationStore<Tokens>
  /** The store key the grant lives under, such as a connection's eid. */
  key: string
  /** Where the provider sends the person back, as registered with it. */
  redirect: string
  fetch?: typeof fetch
  now?: () => number
}

export type Client = {
  /** The link to send a person to, and the attempt to hold until they
   * return. */
  begin: (
    scopes?: string[],
  ) => Promise<{ url: string; attempt: Attempt & { verifier: string } }>
  /** Exchange the code the return URL carries and keep the grant. */
  complete: (pending: Attempt, callback: string | URL) => Promise<void>
  /** A usable access token, refreshed first when it is about to expire;
   * undefined when there is no grant. */
  token: () => Promise<string | undefined>
  /** A new access token after the provider refused `stale`, unless another
   * caller has already replaced it. */
  refresh: (stale: string) => Promise<string | undefined>
}

// A token this close to expiry is refreshed before use, so a call made with
// it does not fail on the wire.
let SKEW = 60_000

// Form encoding, which is also how RFC 6749 §2.3.1 wants a client's id and
// secret encoded before they are joined for Basic.
let form = (fields: Record<string, string | undefined>) =>
  new URLSearchParams(
    Object.entries(fields).filter((f): f is [string, string] => f[1] != null),
  )
let enc = (s: string) => form({ s }).toString().slice(2)

let str = (v: unknown) => typeof v == 'string' && v ? v : undefined

// Every field, so a new grant replaces the old one whole rather than keeping
// a stale refresh token or scope beside it.
let NONE: Tokens = {
  access_token: undefined,
  token_type: undefined,
  refresh_token: undefined,
  expires_at: undefined,
  scope: undefined,
}

export let client = (provider: Provider, o: Options): Client => {
  let now = o.now ?? Date.now
  let key = provider.answers == 'key'
  let fresh = (t: Tokens) =>
    !!t.access_token && (t.expires_at == null || t.expires_at - SKEW > now())

  let exchange = async (
    fields: Record<string, string>,
    was: Tokens = {},
  ): Promise<Tokens> => {
    let id = provider.client?.id
    let secret = provider.client?.secret
    let pair = id != null && secret != null &&
        (provider.auth ?? 'basic') == 'basic'
      ? `${enc(id)}:${enc(secret)}`
      : undefined
    let basic = pair != null
    // A redirect is answered, never followed, so the code and the secret
    // reach the token endpoint alone: `manual` hands back the 3xx, which is
    // not ok and so refused below. (Workers has no `error` mode.)
    let res = await (o.fetch ?? fetch)(provider.token, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
      headers: {
        'content-type': key
          ? 'application/json'
          : 'application/x-www-form-urlencoded',
        accept: 'application/json',
        ...(pair ? { authorization: `Basic ${btoa(pair)}` } : {}),
      },
      body: key ? JSON.stringify(fields) : form({
        ...fields,
        resource: provider.resource,
        client_id: basic ? undefined : id,
        client_secret: basic ? undefined : secret,
      }),
    })
    let said: unknown = await res.json().catch(() => ({}))
    let body = (said && typeof said == 'object' ? said : {}) as Record<
      string,
      unknown
    >
    let access = str(key ? body.key : body.access_token)
    // Some providers answer a refusal with 200 and an `error` field.
    if (!res.ok || !access) {
      let code = str(body?.error) ?? `http_${res.status}`
      throw new OAuthError(code, `the token endpoint refused: ${code}`)
    }
    let life = Number(body.expires_in)
    return {
      access_token: access,
      token_type: str(body.token_type),
      // A refresh may or may not issue a new refresh token (RFC 6749 §6).
      refresh_token: str(body.refresh_token) ?? was.refresh_token,
      expires_at: Number.isFinite(life) && life > 0
        ? now() + life * 1000
        : undefined,
      scope: str(body.scope) ?? was.scope,
    }
  }

  let renew = (stale?: string) =>
    o.store.update(o.key, async (record) => {
      // Another caller may have refreshed while this one waited its turn.
      if (record.access_token != stale && fresh(record)) {
        return record.access_token
      }
      if (!record.refresh_token) {
        if (!record.access_token) return undefined
        throw new OAuthError('expired', 'the grant expired; connect again')
      }
      let got = await exchange(
        { grant_type: 'refresh_token', refresh_token: record.refresh_token },
        record,
      )
      Object.assign(record, NONE, got)
      return record.access_token
    })

  return {
    begin: async (scopes = provider.scopes ?? []) => {
      let { verifier, challenge } = await pkce()
      let pending = { ...attempt(now()), verifier }
      let url = new URL(provider.authorize)
      let fields = {
        ...provider.params,
        ...key ? { callback_url: o.redirect } : {
          response_type: 'code',
          client_id: provider.client?.id,
          redirect_uri: o.redirect,
          state: pending.state,
          resource: provider.resource,
          ...(scopes.length ? { scope: scopes.join(' ') } : {}),
        },
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }
      for (let [k, v] of form(fields)) url.searchParams.set(k, v)
      return { url: url.href, attempt: pending }
    },

    complete: async (pending, callback) => {
      let q = new URL(callback).searchParams
      if (!pending.verifier || pending.until <= now()) {
        throw new OAuthError(
          'expired',
          'the authorization expired; begin again',
        )
      }
      if (!key && q.get('state') != pending.state) {
        throw new OAuthError('state', 'the return does not match this attempt')
      }
      if (provider.issuer && q.get('iss') != provider.issuer) {
        throw new OAuthError('issuer', 'the return names another issuer')
      }
      let error = q.get('error')
      if (error) throw new OAuthError(error, `authorization refused: ${error}`)
      let codes = q.getAll('code')
      if (codes.length != 1 || !codes[0]) {
        throw new OAuthError('code', 'the return carried no single code')
      }
      let got = await exchange(
        key
          ? {
            code: codes[0],
            code_verifier: pending.verifier,
            code_challenge_method: 'S256',
          }
          : {
            grant_type: 'authorization_code',
            code: codes[0],
            redirect_uri: o.redirect,
            code_verifier: pending.verifier,
          },
      )
      await o.store.update(o.key, (record) => {
        Object.assign(record, NONE, got)
        return Promise.resolve()
      })
    },

    token: async () => {
      let t = await o.store.read(o.key)
      if (!t?.access_token) return undefined
      return fresh(t) ? t.access_token : renew(t.access_token)
    },

    refresh: (stale) => renew(stale),
  }
}
