# @yaks/oauth

The OAuth authorization-code client for a provider described as data, and the
building blocks it shares with protocol-specific adapters: private record
storage, PKCE, and expiring attempts.

## Exports

Import paths:

- `client(provider, options)` from `@yaks/oauth`: the authorization-code client
  (RFC 6749 §4.1 with PKCE): `begin`, `complete`, `token` and `refresh`.
- `Provider`, `Tokens`, `Options`, `Client` and `OAuthError` from `@yaks/oauth`:
  its data and its refusal.
- `AuthorizationStore<Record>` from `@yaks/oauth`: the private-record interface,
  with reads and serialized updates.
- `attempt(now?)` from `@yaks/oauth`: a unique correlation value and ten-minute
  deadline.
- `pkce()` from `@yaks/oauth`: a random verifier and its S256 challenge for
  Proof Key for Code Exchange (PKCE). S256 means the challenge is the URL-safe
  Base64 encoding of the verifier's SHA-256 hash.

The store's implementation is [@yaks/secrets](../secrets)'
`records(graph,
vault, prefix, check?)`: each record is a secret, so the graph
holds its name and a handle and the vault holds its contents.

## The client

A provider is data: where a person authorizes, where codes and refresh tokens
are exchanged, the scopes to ask for, any extra authorize parameters, and the
client registered with it.

```ts
import { client, type Provider } from '@yaks/oauth'

let google: Provider = {
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  scopes: ['https://www.googleapis.com/auth/calendar.events'],
  params: { access_type: 'offline', prompt: 'consent' },
  client: { id: clientId, secret: clientSecret },
}

let calendar = client(google, {
  store, // an AuthorizationStore<Tokens>, such as @yaks/secrets records()
  key: connectionEid, // where this grant is kept in the store
  redirect: 'https://yaks.app/connections/callback',
})

// Request one: send the person to the link, and hold the attempt.
let { url, attempt } = await calendar.begin()

// Request two, at the redirect: exchange the code and keep the grant.
await calendar.complete(attempt, request.url)

// Any time after: a usable access token, refreshed when it is about to expire.
let token = await calendar.token()

// When the API refuses a token, a new one (once, however many callers ask).
let next = await calendar.refresh(token!)
```

- `begin(scopes?)` returns the authorize link and the attempt: its `state`, its
  deadline and its PKCE verifier. The client keeps nothing, because the request
  that begins and the request that completes may not share a process; the caller
  holds the attempt across the redirect (a sealed cookie, a short-lived record).
  Extra `params` never replace the flow's own parameters.
- `complete(attempt, url)` checks the return's `state`, the deadline, any
  `error`, and that exactly one `code` came back, before any request. It then
  exchanges the code with the verifier and replaces the stored grant whole.
- `token()` answers from the store while the token has more than a minute left,
  and refreshes it otherwise. It is `undefined` when there is no grant.
- `refresh(stale)` refreshes after the provider refused `stale`, unless another
  caller already replaced it. A refresh that returns no new refresh token keeps
  the old one (RFC 6749 §6).
- Refreshing happens inside the store's `update`, so two callers refreshing one
  grant at once never both spend the refresh token.
- A confidential client authenticates at the token endpoint with HTTP Basic, or
  in the form body with `auth: 'post'`. A client with no secret sends its id in
  the body.
- A provider with `answers: 'key'` runs OpenRouter's PKCE exchange instead: the
  link carries `callback_url` and the challenge, the exchange posts JSON and
  answers `{key}`, and the key is kept as an access token that never expires. It
  needs no registered client and carries no `state`; PKCE binds the code to the
  attempt (RFC 9700 §2.1).
- A refusal throws `OAuthError`, whose `code` is the provider's `error`
  (`invalid_grant` means the grant is gone and the person must connect again),
  `http_<status>` when the provider gave no code, or the client's own: `state`,
  `code`, `expired`.

## The store

`AuthorizationStore<R>.read(key)` returns a record or `undefined`.
`update(key, fn)` passes a mutable record to an asynchronous callback and
returns its result. An implementation serializes updates across every writer and
saves mutations even if the callback throws. Callers must validate a response
before mutating the record if failure should leave it unchanged.

## Storage and security

The store contains sensitive values. Nothing in this package opens a browser,
accepts an HTTP callback, or keeps anything of its own: the host routes the
redirect to `complete` and gives the client its store.

An MCP server is this flow over data found at the server:
`@yaks/mcp-client/oauth` discovers its endpoints and registers a client, and
this client signs in with `resource` (RFC 8707) and checks `issuer` (RFC 9207)
where the server names one.

## Compatibility

The module uses `fetch`, Web Crypto and `btoa` (modern Deno, Node, browsers, and
Workers).
