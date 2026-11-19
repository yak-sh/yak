// Who an OpenID Connect provider says signed in: the claims of the id_token
// its token endpoint answered (OpenID Connect Core 1.0 §2, §3.1.3.7).
//
// The token came straight from the token endpoint over TLS, in exchange for a
// code this client's PKCE verifier and secret were spent on, so TLS stands in
// for checking its signature (§3.1.3.7, item 6). What is still checked here is
// that it is from the issuer asked, for this client, and not expired.

import { OAuthError, type Tokens } from './client.ts'

/** What a provider vouches for: who, and the address it says is theirs. */
export type Identity = {
  issuer: string
  subject: string
  email?: string
  /** Whether the provider says it checked the address belongs to them. */
  verified: boolean
  name?: string
}

/** What an id_token must say to be believed: an issuer among `issuers`, an
 * audience naming `audience` (the client id), and an expiry after `now`. */
export type Expect = {
  issuers: string[]
  audience: string
  now?: number
}

/** The claims a JWT carries, unchecked; an empty object for one that is not
 * three parts with a JSON object in the middle. */
export let claims = (jwt: string): Record<string, unknown> => {
  try {
    let part = jwt.split('.')[1] ?? ''
    let bytes = Uint8Array.from(
      atob(part.replaceAll('-', '+').replaceAll('_', '/')),
      (c) => c.charCodeAt(0),
    )
    let body = JSON.parse(new TextDecoder().decode(bytes))
    return body && typeof body == 'object' && !Array.isArray(body) ? body : {}
  } catch {
    return {}
  }
}

let refused = (why: string) => new OAuthError('id_token', `the id_token ${why}`)

/**
 * Who `tokens`' id_token says signed in, refused unless it is from an issuer
 * `expect` names, for its audience, and still standing.
 *
 * ```ts
 * import { identity } from './identity.ts'
 * import { assertEquals, assertThrows } from '@std/assert'
 * let jwt = (c: object) => `h.${btoa(JSON.stringify(c))}.s`
 * let said = {
 *   iss: 'https://id.test', aud: 'me', sub: '7', exp: 2e9,
 *   email: 'Ada@Example.com', email_verified: true, name: 'Ada',
 * }
 * let expect = { issuers: ['https://id.test'], audience: 'me', now: 0 }
 * assertEquals(identity({ id_token: jwt(said) }, expect), {
 *   issuer: 'https://id.test', subject: '7', email: 'ada@example.com',
 *   verified: true, name: 'Ada',
 * })
 * assertThrows(() => identity({ id_token: jwt({ ...said, aud: 'you' }) }, expect))
 * assertThrows(() => identity({}, expect))
 * ```
 */
export let identity = (tokens: Tokens, expect: Expect): Identity => {
  if (!tokens.id_token) throw refused('is missing')
  let c = claims(tokens.id_token)
  let iss = typeof c.iss == 'string' ? c.iss : ''
  if (!expect.issuers.includes(iss)) throw refused('names another issuer')
  let aud = Array.isArray(c.aud) ? c.aud : [c.aud]
  if (!aud.includes(expect.audience)) throw refused('is for another client')
  if (aud.length > 1 && c.azp != expect.audience) {
    throw refused('was authorized for another client')
  }
  let exp = Number(c.exp)
  if (!(exp * 1000 > (expect.now ?? Date.now()))) throw refused('expired')
  if (typeof c.sub != 'string' || !c.sub) throw refused('names nobody')
  let email = typeof c.email == 'string' && c.email.includes('@')
    ? c.email.trim().toLowerCase()
    : undefined
  return {
    issuer: iss,
    subject: c.sub,
    ...email ? { email } : {},
    verified: c.email_verified === true || c.email_verified === 'true',
    ...typeof c.name == 'string' && c.name ? { name: c.name } : {},
  }
}
