// Who is making the request, on a Worker. @yaks/api asks the code serving it
// one question — which entity is making this request — and there are two ways
// a Worker carries the answer: a session cookie a browser sends on its own, and
// a bearer token a script sends deliberately.
//
// Reading the credential is all that belongs here. What a credential MEANS
// depends on the application's own secret — a signed JWT, a KV lookup, a member
// row — so `verify` is supplied by the caller, and this package never sees a
// key.

import type { Authenticate } from '@yaks/api'
import { Unauthorized } from '@yaks/api'
import type { Actor } from '@yaks/graph'

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
 * matched case-insensitively, as HTTP requires. */
export let bearer = (request: Request): string | null => {
  let header = request.headers.get('authorization') ?? ''
  let [scheme, ...rest] = header.split(' ')
  let token = rest.join(' ').trim()
  return scheme.toLowerCase() == 'bearer' && token ? token : null
}

/** How a Worker's authentication is configured. */
export type Door = {
  /** turn a credential into the actor making the request — `by` whoever holds
   * it, and `via` whatever it arrived through; `null` for a token this
   * application does not accept */
  verify: (
    token: string,
    request: Request,
  ) => Actor | null | Promise<Actor | null>
  /** the cookie a session token lives in (default: read only the bearer) */
  cookie?: string
  /** answer a request with no verified identity with a 401 (default: it is
   * served, and its writes are stored unattributed) */
  required?: boolean
}

/**
 * Request authentication for a Worker: read the credential a request carries —
 * the named cookie first, then a bearer token — and pass it to `verify`. The
 * result is an
 * {@link https://jsr.io/@yaks/api/doc/~/Authenticate | Authenticate} for
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
 * With `required`, a request carrying no credential — or one `verify` rejects —
 * gets a 401 response. Without it, the request is served and its writes are stored
 * with no actor on them.
 */
export let door = (o: Door): Authenticate => async (request) => {
  let token = (o.cookie ? cookies(request)[o.cookie] : null) ?? bearer(request)
  let who = token ? await o.verify(token, request) : null
  if (!who && o.required) throw new Unauthorized()
  return who
}
