// Who is asking (D-32318 §Auth): the contract every part reads — a session
// cookie, an agent's OAuth token, or a GRANT (grants.ts), each to the same
// person's eid — and the refusal a door answers nobody with. The doors that
// mint them are identity.ts's; this is what reads them, and it loads the OAuth
// provider only for an agent's token, so a page served to a signed-in browser
// does not compile the sign-in door (T-148770).
import { type Host, url as hostUrl } from '@yaks/platform/host'
import { verify } from './lib/token.ts'
import { sessionCookie } from './browser-cookie.ts'
import { type Directory, directory, type Role } from './directory.ts'
import { copyOf } from './directory-copy.ts'
import * as dirPart from './directory.ts'
import { CLI_GRANT, GRANT, ledger, sealed } from './grants.ts'
import { stands } from './grant-rows.ts'
import { instrumentEid } from '@yaks/platform/instrument'
import { bound, type Env } from './env.ts'
import { says } from '@yaks/platform/routes'
import type { Caller, Who } from './session.ts'
import { sessionAt } from './session.ts'
import { sha256 } from '@yaks/graph/sha256'
import { carried } from './protocol.ts'

export type { Caller }

let dirOf = (env: Env) =>
  directory(bound(env.DIRECTORY, dirPart.fetch, env), {
    copy: copyOf(env),
    time: env.CLOCK,
  })

/** The token a request bears: its `Authorization: Bearer`, else on a
 * WebSocket upgrade its `bearer.` subprotocol. A door that takes a token on
 * one route only asks whether there is one here before it asks `asking`. */
export let bearerIn = (req: Request): string | null =>
  /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1] ??
    (carried(req) || null)

// A word that could be a credential we issued: a grant (grants.ts), an OAuth
// provider's token, which it writes `person:grant:secret`, or anything sealed
// (lib/token.ts), which is `body.mac` in base64url: a session, a page bearer.
let marked = (word: string) =>
  word.toLowerCase().startsWith(GRANT) || word.includes(':') ||
  /^[\w=-]+\.[\w=-]+$/.test(word)

/// ours('Bearer yaks_abc') -> true
/// ours('Basic ' + btoa('git:yaks_abc')) -> true
/// ours('Basic ' + btoa('hook:s3cret')) -> false
/// ours('Bearer whsec_abc') -> false
/// ours(null) -> false
/** Whether an `Authorization` value could carry a credential yaks.app reads:
 * a bearer `asking` or a page door would take, or a `Basic` password the git
 * door would. What cannot be told apart from one is ours, so a door that must
 * not pass our credentials on drops it and passes anything else as sent. */
export let ours = (said: string | null) => {
  if (said == null) return false
  let [scheme = '', ...rest] = said.trim().split(/[\s,]+/)
  if (scheme.toLowerCase() != 'basic') return [scheme, ...rest].some(marked)
  if (rest.length != 1) return true
  let pair
  try {
    pair = atob(rest[0])
  } catch {
    return true
  }
  let colon = pair.indexOf(':')
  return colon < 0 ||
    [pair.slice(0, colon), pair.slice(colon + 1)].some(marked)
}

// Who is asking, and whether anybody tried: `who` is the caller — by session
// cookie or by bearer token — and `tried` says a credential was presented at
// all. They are two different answers and a lazy door needs both: a token that
// expired, was revoked, or was minted for somebody else is not a caller, but
// it is not an anonymous request either, and MCP requires such a caller be
// answered 401 with the challenge rather than quietly served the surface a
// stranger gets (T-34344). Verification happens once, here, so nobody has to
// re-derive the difference from the headers.
export let asking = async (
  env: Env,
  req: Request,
  ahead?: (who: Caller) => void,
  dir: Directory = dirOf(env),
): Promise<{ who: Caller | null; tried: boolean }> => {
  // The caller, once the directory says their person stands: by
  // `standing`, a credential's own read that says it with the person's row,
  // else by asking. `ahead` starts on them meanwhile.
  let person = async (
    who: Caller | null,
    standing?: () => Promise<boolean>,
  ) => {
    if (!who) return null
    ahead?.(who)
    return await (standing ? standing() : dir.hasPerson(who.person))
      ? who
      : null
  }
  let said = req.headers.get('authorization') ?? ''
  let cookied = sessionCookie(req, env)
  // An `Authorization` header we cannot even parse is still a credential
  // offered: a caller speaking a scheme this door does not take is refused,
  // not mistaken for nobody. So is a subprotocol bearer that does not decode.
  let tried = !!said || !!cookied || carried(req) != null
  let token = bearerIn(req)
  if (token) {
    // A grant says so in its first characters (grants.ts): the provider has
    // never heard of it, so it is opened here, under the session secret and
    // against the ledger row that is what makes it revocable.
    if (token.startsWith(GRANT)) {
      let book = ledger(env.OAUTH_KV, dir)
      let g = env.SESSION_SECRET && book
        ? await sealed(token, env.SESSION_SECRET)
        : null
      return {
        who: g && book
          ? await person({
            person: g.person,
            via: 'grant',
            until: g.exp,
            grant: g.id,
            space: g.space,
            ...g.spaceEid ? { spaceEid: g.spaceEid } : {},
            instrument: instrumentEid(`${CLI_GRANT}:${g.person}:${g.id}`),
          }, () => book.stands(g.person, g.id))
          : null,
        tried,
      }
    }
    // Only an agent's token needs the provider's verifier. Whether its grant
    // still stands is the directory's word, read with the person's row:
    // KV, which the provider reads the token from, keeps a revoked one
    // answering wherever it was read.
    let { person: id, grant, until } =
      await (await import('./oauth-provider.ts'))
        .unwrapped(env, token)
    return {
      who: id && grant
        ? await person({
          person: id,
          via: 'oauth',
          until,
          instrument: instrumentEid(`oauth:${sha256(token)}`),
        }, () => stands(dir, grant, id))
        : null,
      tried,
    }
  }
  if (!cookied || !env.SESSION_SECRET) return { who: null, tried }
  let offered = await verify(cookied, env.SESSION_SECRET)
  if (offered) {
    ahead?.({
      person: offered.person,
      via: 'session',
      until: offered.exp,
      ...offered.space ? { spaceEid: offered.space } : {},
    })
  }
  let [claims, space] = await Promise.all([
    offered ? sessionAt(req, env, offered.space, dir) : null,
    offered?.space ? dir.at(offered.space) : null,
  ])
  if (claims?.space && !space) return { who: null, tried }
  return {
    who: claims
      ? {
        person: claims.person,
        via: 'session',
        until: claims.exp,
        ...(space ? { space: space.slug, spaceEid: space.eid } : {}),
        instrument: instrumentEid(claims.via ?? `session:${sha256(cookied)}`),
      }
      : null,
    tried,
  }
}

// The contract every other part reads (mcp.ts swaps its stub for this import):
// who is asking, by session cookie or by bearer token, or nobody. It answers
// an identity and never a permission — what a person may do in a space is
// their membership (session.ts, directory.ts). A door that must refuse a
// credential that did not verify reads `asking` above; a page that only ever
// draws a sign-in box has nothing to do with the difference.
export let withAuth = async (
  env: Env,
  req: Request,
): Promise<Caller | null> => {
  let who = (await asking(env, req)).who
  return who?.via == 'session' && who.space ? null : who
}

/** The admin HTTP doors take a website session or an OAuth token, never a
 * pasted grant. Verification remains `asking`'s, and a presented bearer never
 * falls back to the ambient cookie. Each door still checks its own live seat. */
export let adminWho = async (
  env: Env,
  req: Request,
  roleOf: (person: string) => Promise<Role | null>,
): Promise<Who> => {
  if (
    req.headers.has('authorization') &&
    !/^Bearer\s+(\S+)$/i.test(req.headers.get('authorization') ?? '')
  ) {
    return { person: null, role: null }
  }
  let who = await withAuth(env, req)
  if (!who || who.via == 'grant') return { person: null, role: null }
  return {
    person: who.person,
    role: await roleOf(who.person),
    until: who.until,
    ...(who.instrument ? { via: who.instrument } : {}),
  }
}

// The RFC 9728 challenge a protected resource answers an anonymous caller
// with: where to find the metadata that names this platform's authorization
// server. It is how an MCP client discovers the door at all, so it lives
// here beside the door rather than in each resource.
//
// It is its own export because the challenge is said twice for one refusal:
// as this header, which is what an MCP client follows into the OAuth flow, and
// inside the refused tool call's `_meta['mcp/www_authenticate']`, which is what
// ChatGPT reads to draw its sign-in button (mcp.ts `refused`). One builder, so
// the two halves cannot come to disagree.
export let challenge = (url: URL, env: Host = {}) =>
  'Bearer realm="OAuth", resource_metadata=' +
  `"${
    env.APEX ? hostUrl(env) : url.origin
  }/.well-known/oauth-protected-resource${url.pathname}"`

export let unauthorized = (req: Request, env: Host = {}) =>
  Response.json({
    error: {
      code: 'unauthorized',
      message: says(env),
      signIn: hostUrl(env, '/login'),
    },
  }, {
    status: 401,
    headers: { 'www-authenticate': challenge(new URL(req.url), env) },
  })
