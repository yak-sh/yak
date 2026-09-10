// Who is writing, on a Worker. @yaks/api asks the host one question — which
// entity is making this request — and this is the two ways a Worker is asked
// it: a session cookie a browser sends on its own, and a bearer token a script
// sends deliberately.
//
// Reading the credential is all that belongs here. What a credential MEANS is
// the app's own secret — a signed JWT, a KV lookup, a member row — so `verify`
// is injected, and this package never sees a key.

import type { Authenticate } from '@yaks/api'
import { Unauthorized } from '@yaks/api'
import type { Entity } from '@yaks/graph'

// A cookie value is usually percent-encoded, but nothing makes it so: a value
// that is not valid encoding is the value itself, not a thrown request.
let decoded = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Every cookie on a request, by name. An absent or malformed header is an
 * empty set, never a throw. */
export let cookies = (request: Request): Record<string, string> => {
  let out: Record<string, string> = {}
  for (let part of (request.headers.get('cookie') ?? '').split(';')) {
    let at = part.indexOf('=')
    let name = at < 0 ? '' : part.slice(0, at).trim()
    if (!name) continue
    out[name] = decoded(part.slice(at + 1).trim())
  }
  return out
}

/** The `authorization: Bearer …` token on a request, or null. The scheme is
 * matched case-insensitively, as HTTP asks. */
export let bearer = (request: Request): string | null => {
  let header = request.headers.get('authorization') ?? ''
  let [scheme, ...rest] = header.split(' ')
  let token = rest.join(' ').trim()
  return scheme.toLowerCase() == 'bearer' && token ? token : null
}

/** How a Worker's door is built. */
export type Door = {
  /** turn a credential into the entity writing — `null` for a token this app
   * does not honour */
  verify: (
    token: string,
    request: Request,
  ) => Entity | null | Promise<Entity | null>
  /** the cookie a session token lives in (default: read only the bearer) */
  cookie?: string
  /** refuse a request that names nobody with a 401 (default: it lands
   * unattributed) */
  required?: boolean
}

/**
 * A door for a Worker: read the credential a request carries — the named
 * cookie first, then a bearer token — and hand it to `verify`. The result is
 * an {@link https://jsr.io/@yaks/api/doc/~/Authenticate | Authenticate} for
 * `api()`, so it runs on reads, writes and socket upgrades alike.
 *
 * ```ts
 * let authenticate = door({
 *   cookie: 'shop_session',
 *   verify: (token) => memberFor(token),
 *   required: true,
 * })
 * ```
 *
 * With `required`, a request carrying no credential — or one `verify` does not
 * honour — is answered 401. Without it, the batch simply lands with no actor
 * on it.
 */
export let door = (o: Door): Authenticate => async (request) => {
  let token = (o.cookie ? cookies(request)[o.cookie] : null) ?? bearer(request)
  let who = token ? await o.verify(token, request) : null
  if (!who && o.required) throw new Unauthorized()
  return who
}
