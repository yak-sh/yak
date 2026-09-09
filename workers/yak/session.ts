// Who is asking (D-32318 §Auth): the platform session cookie, verified with
// the shared secret (src/token.ts), joined to the person's membership in the
// space the request is for. The kernel is the one reader of the cookie —
// what serves an app gets the VOUCH instead, and never the cookie — and the
// only writer of it, so a client cannot send one: every request to a store is
// built from scratch by `storeOf` (door.ts), which strips the set before it
// stamps its own.
//
// THE RULE IS NOT KEPT HERE. `member`, `grant` and `access` are @yaks/member's
// components, and the two questions they answer — may this level read a thing
// in this mode (`reads`), may it write one (`edits`, or `writes` for a level
// alone) — are that package's own words, asked at each door with `who.role` and
// the app's `access` in hand. The kernel's `Role` IS member's `Level` and its
// `Access` IS member's `Mode`, so a door and the graph that enforces it
// (graph.ts `authenticating`, @yaks/member's precondition guard) read the same
// predicate off the same words, with nothing in between to drift.
//
// The cookie's LIFE is here too, at the bottom: how long one lasts, what one
// is minted as, and the renewal that makes a session slide. The doors that
// mint one (identity.ts) and the router the renewal hangs off (index.ts) are
// elsewhere; what a session IS belongs beside who is asking.
import { COOKIE, cookie, cookieValue, sign, verify } from '../../src/token.ts'
import type { Role } from './directory.ts'
import type { Env } from './env.ts'
import { apex, type Host } from './host.ts'
import { hostOf } from './route.ts'

export type Who = { person: string | null; role: Role | null }

/**
 * Who is asking at a door that takes a CREDENTIAL rather than a cookie alone
 * — the connector, the CLI (identity.ts `asking`, which is what mints one).
 * Beside `Who` because it is the same question one step earlier: `Who` is the
 * person and their seat in a space, this is the person and how they got in.
 */
export type Caller = {
  person: string
  // How they got in. `grant` is the CLI's short-lived bearer (grants.ts),
  // which the identity door mints for a caller and verifies itself.
  via: 'session' | 'oauth' | 'grant'
  // The unix second this credential dies at — a bearer's own expiry, a
  // cookie's `exp`. `about` says it out loud (tools.ts), which is how a CLI
  // asks how long it has left.
  until?: number
  // A grant, and only a grant: which one it is, so it can be revoked by name,
  // and the one space it may reach when it was narrowed to one.
  grant?: string
  space?: string | null
}

export let nobody: Who = { person: null, role: null }

export let whoIs = async (
  req: Request,
  secret: string | undefined,
  roleOf: (person: string) => Promise<Role | null>,
): Promise<Who> => {
  let token = cookieValue(req.headers.get('cookie'))
  if (!token || !secret) return nobody
  let claims = await verify(token, secret)
  if (!claims) return nobody
  return { person: claims.person, role: await roleOf(claims.person) }
}

// The headers an app is handed in the cookie's place.
export let vouched = (who: Who): Record<string, string> => ({
  ...(who.person ? { 'x-yak-person': who.person } : {}),
  ...(who.role ? { 'x-yak-role': who.role } : {}),
})

// The header a WRITE adds to that vouch: what to call this person, so the
// store titles the person row it mints beside their rows (graph.ts `#vouching`)
// and a byline resolves to `{eid, name}` (listing.ts `named`). The name is
// the one they chose, else the front of their address (directory.ts
// `nameAt`); their address stays in the directory, since an app's store
// learns a name and never an address book (T-32654).
//
// Read at the WRITE doors only — a read never mints a person, and every page
// load would otherwise pay for a name nobody wrote down — and by EVERY write
// door: the page's (apps.ts `acting`) had it while the agent's routed write
// did not, so a loan written through graph_apply left the lending store
// calling the borrower a bare uuid (C-32800 item 5).
export let titling = async (
  dir: { nameAt: (person: string) => Promise<string | null> },
  person: string | null,
): Promise<Record<string, string>> => {
  let title = person && await dir.nameAt(person)
  return title ? { 'x-yak-title': title } : {}
}

// ── The cookie's life ──────────────────────────────────────────────────────

// Ninety days of INACTIVITY; activity keeps a session alive without limit.
// The cookie is minted for this long and re-minted past half its life
// (`slid`), so a browser or a CLI that keeps asking never signs out and one
// that goes quiet for ninety days does. The cookie is the browser's; an
// agent's token has the provider's own, shorter life.
export let SESSION = 90 * 24 * 60 * 60

// What this platform needs to keep a session: the secret it signs with, and
// the apex the cookie is shared across.
type Keeper = Host & Pick<Env, 'SESSION_SECRET'>

// The cookie's Domain: the platform's own apex, so one sign-in serves every
// space's hostname. On a dev host there is no domain to share — an IP takes
// no Domain attribute at all — so the cookie stays host-only.
let domainOf = (req: Request, env: Host) => {
  let host = hostOf(req)
  return host == apex(env) || host.endsWith(`.${apex(env)}`) ? apex(env) : ''
}

// ONE session cookie, minted: the token this secret signs and the Set-Cookie
// that carries it — on the apex, or host-only on a customer's own domain.
// Signing in, the custom-domain handoff and the renewal below all mint the
// same thing, so a session's life is said in one place.
export let minted = (
  req: Request,
  env: Host,
  secret: string,
  person: string,
  space: string | null = null,
) =>
  sign(
    { person, space, exp: Math.floor(Date.now() / 1000) + SESSION },
    secret,
  ).then((token) => cookie(token, domainOf(req, env), SESSION))

// Does the answer already say what this session is? Signing in and the
// handoff each set the cookie themselves, and each knows something about it
// that a blanket renewal does not.
let sets = (res: Response) =>
  new RegExp(`(?:^|,\\s*)${COOKIE}=`).test(res.headers.get('set-cookie') ?? '')

// The session SLIDES (T-35380). `SESSION` was always meant as a span of NOT
// signing in — the cookie was minted once and never renewed, which made it a
// hard limit instead — so an answer to a request whose cookie is past half
// its life carries a fresh one: the same person, the same standing, another
// ninety days. Activity keeps a session for as long as it goes on; only
// ninety days of silence ends one.
//
// The old value stays good until its own expiry. There is no session store to
// revoke it in, and a browser that has taken the new cookie will not send the
// old one again.
//
// It happens on the way OUT of the router (index.ts), where every request
// passes whatever door answered it, because every door has to slide and no
// door should have to remember to. An answer that sets the cookie itself is
// left alone (`sets`), and so is a socket, which has no body to copy.
export let slid = async (
  req: Request,
  env: Keeper,
  res: Response,
): Promise<Response> => {
  if (res.status == 101 || !env.SESSION_SECRET || sets(res)) return res
  let token = cookieValue(req.headers.get('cookie'))
  if (!token) return res
  let claims = await verify(token, env.SESSION_SECRET)
  if (!claims || claims.exp - Date.now() / 1000 > SESSION / 2) return res
  let headers = new Headers(res.headers)
  headers.append(
    'set-cookie',
    await minted(req, env, env.SESSION_SECRET, claims.person, claims.space),
  )
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}
