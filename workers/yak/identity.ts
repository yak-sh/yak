// The identity part (D-32318 §Auth): one sign-in for the whole platform, at
// the apex, and the OAuth 2.1 door agents come through. Two ways in, one
// answer — a person's eid — which every other part reads through `withAuth`.
//
// A person proves who they are by receiving mail: `POST /login` mints a
// six-digit code (signin.ts) — up to three an hour for any one address, and
// over that it mints nothing and mails nothing while answering the same card,
// so the ceiling says nothing about the address (T-33020) — and hands it to
// the mail seam (mail.ts);
// `POST /login/code` spends it, finds or mints the person, and sets the
// platform session cookie (src/token.ts). No password exists to lose. Those
// two steps are the WHOLE of signing up (T-34236): give the address, prove it,
// and land on your own space. The card asks nothing else — what a person is
// called (T-32654) and the address their apps live at (T-32967) are set on the
// space page's owner block, where they can see what they are naming, and at
// `/connect`, which still carries the address for as long as nothing is built
// there (T-34137).
// A person sent here from a page they could not use arrives as
// `/login?return=<url>`:
// both cards carry that address forward, and the spent code lands them back on
// it when it is one of ours (T-32593). Somebody already signed in is never
// shown the box at all — `GET /login` reads the session first and sends them
// on to that address, or to where a fresh sign-in would land them (T-34209).
//
// An agent proves who it is with a bearer token from
// `@cloudflare/workers-oauth-provider`, which owns `/oauth/token`,
// `/oauth/register`, and the two well-known metadata documents. Both ways a
// connector can name itself are open: Client ID Metadata Documents, which
// MCP's 2026-07-28 revision prefers — the client_id IS an https URL serving
// its own metadata, which the provider fetches and validates — and dynamic
// registration, kept for clients that only speak RFC 7591. CIMD needs the
// `global_fetch_strictly_public` compatibility flag beside the option
// (wrangler.toml), and the provider advertises
// `client_id_metadata_document_supported` only when it has both. The consent
// page is the sign-in page: signing in IS granting, and an already-signed-in
// browser gets one Allow button. The grant carries `{person}` as its props,
// so a token resolves to the same eid a cookie does.
//
// A third way in is minted from the second: a GRANT (grants.ts, T-34385), the
// short-lived bearer the connector hands a person for their own terminal.
// This door verifies it — it is a sealed value of ours, not the provider's, so
// `asking` opens it here — and it resolves to the same eid the other two do,
// with a life of hours and a row that can be deleted to end it.
//
// Whether we CLAIM CIMD at all is the `CIMD` env var (`cimd` below), on
// unless it says `off`. CIMD works — Claude's hosted document signs a person
// in through it (T-32465) — but ChatGPT prefers CIMD wherever it is offered
// and names itself with a document that is a 404, so its flow dies before it
// starts. The lever is the advertisement, not the code path: dropped, the
// well-known stops claiming support and a URL client_id is looked for in the
// store like any other, which is what leaves a client dynamic registration to
// fall back to (T-33027).
//
// The first person ever to sign in owns the meta space: while `yak` has no
// members at all, this writes `member(yak, person, owner)` (directory.ts
// `memberless`). After that the ordinary membership rule holds. It is the
// only way that row is ever written: nothing serves the meta store at an
// address (apps.ts), so no request can write the directory from outside.
import {
  AuthorizationError,
  type AuthRequest,
  CimdFetchError,
  getOAuthApi,
  OAuthProvider,
  type OAuthProviderOptions,
} from '@cloudflare/workers-oauth-provider'
import { cookie, cookieValue, sign, verify } from '../../src/token.ts'
import { HANDOFF, handoffTo, opener, safeNext, spender } from './handoff.ts'
export { HANDOFF } from './handoff.ts'
import { directory, META, type Space } from './directory.ts'
import { doomed, erase, naming, refused, ticketed, went } from './erase.ts'
import { GRANT, held, ledger } from './grants.ts'
import * as dirPart from './directory.ts'
import { bound, type Env } from './env.ts'
import { mail } from './mail.ts'
import { KERNEL, meta } from './meta.ts'
import {
  askAllow,
  askCode,
  askDelete,
  askEmail,
  connect,
  deleted,
  lost,
} from './pages.ts'
import { hostOf, onZone, PLATFORM, SLUG } from './route.ts'
import { canon, mint, nameOf, personOf, spend } from './signin.ts'

// A month of not signing in again. The cookie is the browser's; an agent's
// token has the provider's own, shorter life.
let SESSION = 30 * 24 * 60 * 60

// What a grant carries and a token gives back: the person, nothing else.
// Membership is read from the directory at request time, never a claim.
type Props = { person: string }

export type Caller = {
  person: string
  // How they got in. `grant` is the CLI's short-lived bearer (grants.ts),
  // which this door mints for a caller and verifies itself.
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

// The provider's helpers over this env: parsing an authorize request,
// naming a client, writing a grant, unwrapping a token. `opts` is the same
// configuration `fetch` runs, so the two never disagree.
let api = (env: Env) => getOAuthApi<Env>(opts(env), env)

// Who is asking, and whether anybody TRIED: `who` is the caller — by session
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
): Promise<{ who: Caller | null; tried: boolean }> => {
  let said = req.headers.get('authorization') ?? ''
  let cookied = cookieValue(req.headers.get('cookie'))
  // An `Authorization` header we cannot even parse is still a credential
  // offered: a caller speaking a scheme this door does not take is refused,
  // not mistaken for nobody.
  let tried = !!said || !!cookied
  let bearer = /^Bearer\s+(\S+)$/i.exec(said)
  if (bearer) {
    // A grant says so in its first characters (grants.ts): the provider has
    // never heard of it, so it is opened here, under the session secret and
    // against the ledger row that is what makes it revocable.
    if (bearer[1].startsWith(GRANT)) {
      let g = env.SESSION_SECRET
        ? await held(bearer[1], env.SESSION_SECRET, ledger(env.OAUTH_KV))
        : null
      return {
        who: g
          ? {
            person: g.person,
            via: 'grant',
            until: g.exp,
            grant: g.id,
            space: g.space,
          }
          : null,
        tried,
      }
    }
    let token = await api(env).unwrapToken<Props>(bearer[1])
    let person = token?.grant.props?.person
    return {
      who: person ? { person, via: 'oauth', until: token?.expiresAt } : null,
      tried,
    }
  }
  if (!cookied || !env.SESSION_SECRET) return { who: null, tried }
  let claims = await verify(cookied, env.SESSION_SECRET)
  return {
    who: claims
      ? { person: claims.person, via: 'session', until: claims.exp }
      : null,
    tried,
  }
}

// THE contract every other part reads (mcp.ts swaps its stub for this import):
// who is asking, by session cookie or by bearer token, or nobody. It answers
// an identity and never a permission — what a person may do in a space is
// their membership (session.ts, directory.ts). A door that must refuse a
// credential that did not verify reads `asking` above; a page that only ever
// draws a sign-in box has nothing to do with the difference.
export let withAuth = async (
  env: Env,
  req: Request,
): Promise<Caller | null> => (await asking(env, req)).who

// The RFC 9728 challenge a protected resource answers an anonymous caller
// with: where to find the metadata that names this platform's authorization
// server. It is how an MCP client discovers the door at all, so it lives
// here beside the door rather than in each resource.
//
// It is its own export because the challenge is said TWICE for one refusal:
// as this header, which is what an MCP client follows into the OAuth flow, and
// inside the refused tool call's `_meta['mcp/www_authenticate']`, which is what
// ChatGPT reads to draw its sign-in button (mcp.ts `refused`). One builder, so
// the two halves cannot come to disagree.
export let challenge = (url: URL) =>
  'Bearer realm="OAuth", resource_metadata=' +
  `"${url.origin}/.well-known/oauth-protected-resource${url.pathname}"`

// Where signing in happens, and the sentence a refusal says about it. A
// refusal is read by a person's agent, so it says a SENTENCE beside its code
// and names where signing in happens — the treatment every other door already
// had, and the one this one missed (C-32607 item 1, apps.ts SAYS).
export let SIGN_IN = `https://${PLATFORM}/login`
export let SAYS = `sign in at ${SIGN_IN} to reach your apps from here`

export let unauthorized = (req: Request) =>
  Response.json({
    error: { code: 'unauthorized', message: SAYS, signIn: SIGN_IN },
  }, {
    status: 401,
    headers: { 'www-authenticate': challenge(new URL(req.url)) },
  })

let redirect = (to: string, set?: string, status = 302) =>
  new Response(null, {
    status,
    headers: { location: to, ...(set ? { 'set-cookie': set } : {}) },
  })

// Where a signed-in person lands: the page they came from, when it is on our
// own zone — an off-zone address is ignored and never followed, the field
// being a stranger's to fill in (route.ts `onZone`). Sent nowhere in
// particular, they land on their own space's root — the home app there, or the
// space's index — because a person's space IS the signed-in home of this
// platform (T-34233). `/connect` is still the page that teaches attaching an
// assistant, and the space index's owner block links to it, so the nudge
// arrives where they live instead of standing in front of it.
//
// Several spaces, and the one they came in on wins — but that is the return
// address doing it, not a rule of its own: a space's index sends someone here
// with `return=https://<space>.yaks.app/` (apps.ts `signInAt`), and that
// address is on our zone, so it is followed. `mine` is what is left when
// nobody was aiming them anywhere, and `own()` names it: the space their own
// address spells, else the first they own.
let backTo = (mine: string, back: string) =>
  (back && onZone(back)) || `https://${mine}.${PLATFORM}/`

// The cookie's Domain: the platform's own apex, so one sign-in serves every
// space's hostname. On a dev host there is no domain to share — an IP takes
// no Domain attribute at all — so the cookie stays host-only.
let domainOf = (req: Request) => {
  let host = hostOf(req)
  return host == PLATFORM || host.endsWith(`.${PLATFORM}`) ? PLATFORM : ''
}

let dirOf = (env: Env) => directory(bound(env.DIRECTORY, dirPart.fetch, env))

// Whether any agent has ever been let in as this person: one grant is enough,
// and the provider already keeps the answer. It is what tells a fresh account
// from a working one (T-32972) — the space page's connect block stands OPEN
// until it is true and shut afterwards (apps.ts `index`, T-34236), so the
// question belongs beside the provider that answers it.
export let connected = async (env: Env, person: string) =>
  !!(await api(env).listUserGrants(person, { limit: 1 })).items.length

// Who is asking, out of the platform session COOKIE and nothing else. It is
// deliberately not `withAuth` above, which also answers an agent's bearer:
// the door below belongs to the signed-in web surface, and an agent that
// cannot reach it cannot be talked into it (billing.ts `buyer` takes the same
// line for a purchase, C-33033).
let browser = async (env: Env, req: Request) => {
  let token = cookieValue(req.headers.get('cookie'))
  if (!token || !env.SESSION_SECRET) return null
  return (await verify(token, env.SESSION_SECRET))?.person ?? null
}

// Closing a space (erase.ts, T-33166): `/space/<slug>/delete`, the one door
// on this platform behind which something cannot be brought back — so a
// person, signed in, is the only caller who ever reaches it.
//
// The GET only ever DRAWS. A mail client that fetches every link in a letter
// before anyone reads it must not be able to delete a space by doing its job,
// so the act is the POST and the page is what asks for it.
//
// A space that is not this person's answers exactly what a space that does
// not exist answers: a stranger learns nothing about anybody's address here.
//
// The POST needs no origin check of its own: the session cookie is
// `SameSite=Lax` (token.ts `cookie`), so a form posted from somebody else's
// page arrives without it and is sent to sign in like any stranger.
let closing = async (
  req: Request,
  env: Env,
  slug: string,
  form: { confirm: string; token: string },
) => {
  let url = new URL(req.url)
  let person = await browser(env, req)
  // Signed out — which is what an agent is here, having no cookie — they are
  // sent to sign in and handed back to this very page (T-32593). The return
  // address is on our own zone by construction.
  if (!person) {
    return redirect(
      `/login?return=${encodeURIComponent(url.pathname + url.search)}`,
    )
  }
  // Fresh reads, every one: this is the one act that cannot be taken back, so
  // an app made a moment ago must not be missed because a 30-second read cache
  // had not heard of it — its store and its bytes would outlive the space and
  // be inherited by whoever takes the address next (directory.ts FRESH,
  // billing.ts reads the same way).
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env), true)
  let space = await dir.space(slug)
  if (!space || (await dir.role(space, person)) != 'owner') return lost()
  let stop = refused(space)
  let d = await doomed(dir, space)
  let lines = naming(d)
  if (stop) return askDelete({ slug, lines, stop, status: 409 })
  // The letter's ticket, if this visit carries one: minted for THIS space and
  // THIS person, and dead after an hour (erase.ts). It stands in for typing
  // the name, because following a link out of a letter that named everything
  // about to go is the deliberate act the typing is there to be.
  let held = req.method == 'POST' ? form.token : url.searchParams.get('t') ?? ''
  let ok = held ? await ticketed(held, secret(env)) : null
  let mine = !!ok && ok.space == space.eid && ok.person == person
  if (req.method != 'POST') {
    return askDelete({
      slug,
      lines,
      token: mine ? held : null,
      why: held && !mine
        ? 'That link has expired or was for something else. You can still ' +
          'delete this space by typing its name.'
        : undefined,
    })
  }
  if (!mine && form.confirm.trim() != slug) {
    return askDelete({
      slug,
      lines,
      why: `Type ${slug} exactly, and it goes.`,
      status: 400,
    })
  }
  try {
    return deleted(went(d, await erase(env, dir, d, { person, role: 'owner' })))
  } catch (e) {
    // What could not be finished is said on the page rather than swallowed
    // behind the soft error page: a domain Cloudflare would not give back is
    // the one failure here that costs money, and asking again finishes what
    // did not go (erase.ts holds the order that makes that safe).
    return askDelete({
      slug,
      lines,
      why: `That did not finish: ${e instanceof Error ? e.message : String(e)}`,
      status: 502,
    })
  }
}

// The connector page as this person sees it: their own address, their plan
// and the instructions. `own` is the same call sign-in makes, so someone who
// signed in before spaces existed gets theirs here (T-32482).
//
// A stranger is sent to sign in instead of shown the steps (T-34408). The
// order is email, code, their own space, and the connect block waiting there
// (apps.ts `index`) — teaching a visitor to attach an assistant BEFORE they
// have an account asks them to do the second step first. No `return` rides
// the redirect: landing them back here would put them in front of their space
// rather than on it, and `backTo` already lands a fresh sign-in at home.
let theirs = async (env: Env, req: Request, said?: string, say?: string) => {
  let who = await withAuth(env, req)
  if (!who) return redirect('/login', undefined, 303)
  let dir = dirOf(env)
  let space = await dir.own(who.person)
  return connect({
    slug: space.slug,
    fixed: !!(await dir.apps(space)).length,
    said,
    say,
    no: !!say,
    // What they pay, and the two doors that change it (billing.ts, T-33125).
    // `known` is whether Stripe has ever met this space: somebody who
    // cancelled still reaches their own invoices.
    plan: {
      plus: space.tier == 'plus',
      ends: space.plan?.ending ?? '',
      known: !!space.plan?.customer,
    },
    paid: new URL(req.url).searchParams.get('paid') == '1',
  }, say ? 400 : 200)
}

// Taking an address: the space wears the slug its owner chose. It is theirs
// to change while nothing is built there — an app's URL is this slug, so a
// space with apps in it stays put until moving one is something we do
// properly, with the redirect a rename wants (T-32576). Answers the address
// or a sentence, never both; the card renders whichever it gets.
//
// `at` names WHICH space, for the owner block on a space's own page, where
// the answer is the space being looked at rather than whichever one `own()`
// calls theirs (apps.ts `saved`, T-34236). `/connect` names none and means
// their own.
export let choose = async (
  env: Env,
  person: string,
  want: string,
  at?: Space,
): Promise<{ address?: string; slug?: string; error?: string }> => {
  let dir = dirOf(env)
  let space = at ?? await dir.own(person)
  if (want == space.slug) return { address: `${want}.${PLATFORM}`, slug: want }
  if (!SLUG.test(want)) {
    return {
      error: 'An address is lowercase letters, numbers and dashes, ' +
        'starting with a letter or a number — like dana or dana-notes.',
    }
  }
  if ((await dir.apps(space)).length) {
    return {
      error: `You've built something at ${space.slug}.${PLATFORM}, so that ` +
        'address stays put for now.',
    }
  }
  if (await dir.space(want)) {
    return { error: `${want}.${PLATFORM} is taken. Try another?` }
  }
  try {
    // The title follows the address: a space nobody has named is known by
    // the name it answers to (directory.ts `own`).
    await dir.apply({
      entities: [{
        entity: { eid: space.eid },
        doc: { title: want },
        space: { slug: want },
      }],
    }, { 'x-yak-person': person, 'x-yak-role': 'owner' })
  } catch {
    // Two people can want one name at once; the unique slug decides, and the
    // loser is told the ordinary thing rather than shown a broken page.
    return { error: `${want}.${PLATFORM} is taken. Try another?` }
  }
  return { address: `${want}.${PLATFORM}`, slug: want }
}

// The secret signs sessions and keys the code digests. Unset, sign-in cannot
// work at all, and saying so out loud beats a token nobody can verify: the
// throw becomes an exception entity behind the soft page (index.ts).
let secret = (env: Env) => {
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET is not set')
  return env.SESSION_SECRET
}

// The custom-domain end of the handoff (index.ts routes HANDOFF here on a
// foreign host, BEFORE `aimed` would carry it to the app): the person
// authenticated on the platform and arrived with a one-time token bound to THIS
// host. `opener` (handoff.ts) verifies and spends it; on success we mint this
// hostname's own host-only cookie — `domainOf` answers '' for a foreign host,
// so the cookie sticks to it and no other — and send them on with the token
// stripped from the address and no referrer to carry it off the page. A token
// that fails any check becomes a fresh sign-in on the platform, aimed back at
// where they were, which mints another honestly.
export let handoff = async (req: Request, env: Env): Promise<Response> => {
  let url = new URL(req.url)
  let to = safeNext(url.searchParams.get('next') ?? '/')
  let person = await opener(
    url.searchParams.get('t') ?? '',
    secret(env),
    hostOf(req),
    spender(env.OAUTH_KV),
  )
  if (!person) {
    return redirect(
      `https://${PLATFORM}/login?return=${
        encodeURIComponent(`https://${hostOf(req)}${to}`)
      }`,
    )
  }
  let token = await sign(
    { person, space: null, exp: Math.floor(Date.now() / 1000) + SESSION },
    secret(env),
  )
  return new Response(null, {
    status: 303,
    headers: {
      location: to,
      'set-cookie': cookie(token, domainOf(req), SESSION),
      'referrer-policy': 'no-referrer',
    },
  })
}

// The person is known: the cookie, the space that is theirs, the first-owner
// bootstrap, and wherever they were going.
let landed = async (
  req: Request,
  env: Env,
  person: string,
  q: string,
  back: string,
) => {
  let store = meta(env)
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env))
  // Signing in IS having a space (T-32482): theirs already, or minted here at
  // the front of their address — so no agent ever has to ask them for a name,
  // and the card asks nothing but the address and the code (T-34236). It is
  // also where they land when nothing else aims them (`backTo`).
  let mine = await dir.own(person)
  let space = await dir.space(META.space)
  if (space && await dir.memberless(space)) {
    await store.apply([{
      entity: { eid: '$seat' },
      member: { space: space.eid, person, role: 'owner' },
    }], KERNEL)
  }
  let token = await sign(
    { person, space: null, exp: Math.floor(Date.now() / 1000) + SESSION },
    secret(env),
  )
  let set = cookie(token, domainOf(req), SESSION)
  // See Other: the code was POSTed, and where it sends them is a page to GET,
  // never that form again. A return on a customer's own hostname becomes a
  // HANDOFF (the platform cookie just set never rides there); anything else is
  // our own zone or the fallback, decided by `backTo`.
  if (q) return allow(req, env, q, person, set)
  let hand = back ? await handoffTo(secret(env), dir, person, back) : null
  return redirect(hand ?? backTo(mine.slug, back), set, 303)
}

// The authorize request as the provider reads it, re-parsed from the query
// the browser carried back: `q` is untrusted, and parsing is what validates
// it against the client — registered, or fetched from the metadata document
// its id points at — its redirect URI, and PKCE. A client we cannot even
// name is refused here; one we can is told in its own language. A metadata
// document we cannot fetch is the client's own outage, not ours, so it is
// said plainly rather than thrown into the exception page.
let asked = async (req: Request, env: Env, q: string) => {
  let url = new URL(`/oauth/authorize?${q}`, req.url)
  try {
    return await api(env).parseAuthRequest(new Request(url.href))
  } catch (e) {
    if (e instanceof CimdFetchError) {
      return new Response(
        `Could not read the client metadata document at ${e.metadataUrl}`,
        { status: 400 },
      )
    }
    if (!(e instanceof AuthorizationError)) throw e
    if (!e.redirectUri) return new Response(e.description, { status: 400 })
    let back = new URL(e.redirectUri)
    back.searchParams.set('error', e.code)
    back.searchParams.set('error_description', e.description)
    if (e.state) back.searchParams.set('state', e.state)
    if (e.issuer) back.searchParams.set('iss', e.issuer)
    return redirect(back.href)
  }
}

// Consent granted: the grant is written and the browser is sent home to the
// client with its code.
let allow = async (
  req: Request,
  env: Env,
  q: string,
  person: string,
  set?: string,
) => {
  let ask = await asked(req, env, q)
  if (ask instanceof Response) return ask
  let { redirectTo } = await api(env).completeAuthorization({
    request: ask,
    userId: person,
    metadata: {},
    scope: ask.scope,
    props: { person } satisfies Props,
  })
  return redirect(redirectTo, set)
}

// The name a person sees on the consent card: what the client called itself
// when it registered, or its bare id.
let clientName = async (env: Env, ask: AuthRequest) =>
  (await api(env).lookupClient(ask.clientId))?.clientName ?? ask.clientId

// Everything the provider does not own: the sign-in cards and the consent
// page. It is the provider's `defaultHandler`, so it sees a request only
// after /oauth/token, /oauth/register, /oauth/me and the well-known
// documents have had their say.
let ours = async (req: Request, env: Env): Promise<Response> => {
  let url = new URL(req.url)
  let path = url.pathname
  // A POST that carries no form at all is a form with nothing in it: the
  // page below simply asks again, rather than throwing at a stray body.
  let form = req.method == 'POST'
    ? await req.formData().catch(() => new FormData())
    : new FormData()
  let field = (name: string) => String(form.get(name) ?? '')

  // The custom-domain end of cross-domain sign-in (`handoff`). index.ts sends
  // it here on a foreign host before `aimed` moves the address, so it is the
  // one door this handler answers for a hostname that is not ours.
  if (path == HANDOFF && req.method == 'GET') return handoff(req, env)

  // The connector page, and the one thing a person may change on it. It is
  // readable signed out — the home page links here, and the instructions are
  // nobody's secret — while the address card belongs to whoever is signed in,
  // so choosing one says nothing to a stranger about any address but their
  // own (T-32967, T-32972).
  if (path == '/connect' && req.method == 'GET') return theirs(env, req)

  if (path == '/connect' && req.method == 'POST') {
    let who = await withAuth(env, req)
    if (!who) return redirect('/login?return=%2Fconnect')
    let out = await choose(env, who.person, field('space').trim().toLowerCase())
    // A fetch gets the answer to put in the page; a plain form post — no
    // script, or one that did not load — gets the page back around it.
    return (req.headers.get('accept') ?? '').includes('application/json')
      ? Response.json(out, { status: out.error ? 400 : 200 })
      : theirs(env, req, out.slug ?? field('space'), out.error)
  }

  // Closing a space: a page and a form like the rest of this file, and the
  // only door that destroys anything (index.ts routes `/space/` here).
  let close = /^\/space\/([a-z0-9-]+)\/delete$/.exec(path)
  if (close && (req.method == 'GET' || req.method == 'POST')) {
    return closing(req, env, close[1], {
      confirm: field('confirm'),
      token: field('t'),
    })
  }

  if (path == '/login' && req.method == 'GET') {
    let back = url.searchParams.get('return')
    // Already signed in? Then the platform has nothing to ask, so the box is
    // never drawn (T-34209): honor the session and send them where they were
    // going, which is `landed`'s one landing rule — a return on a customer's
    // own hostname becomes a handoff, one on our zone is followed, a
    // stranger's is refused and aimed nowhere in particular they land where a
    // fresh sign-in lands them (`backTo`: their own space's root). It matches
    // the consent page, which hands an already-signed-in browser one Allow
    // rather than a fresh sign-in.
    let who = await withAuth(env, req)
    if (who) return landed(req, env, who.person, '', back ?? '')
    return askEmail(null, back)
  }

  // An address, and a code on its way to it. The platform reads NOTHING about
  // the address here — not whether anyone has named it, not whether it has
  // spaces or apps or an account at all (T-34236 took the last of that away
  // with the card's second question): a stranger learns exactly what a letter
  // to somebody else's address teaches them, which is nothing.
  //
  // An address that has had its letters for the hour mints nothing (signin.ts
  // SENDS) and this answers the card it always answers: same status, same
  // bytes. A refusal that showed would say that somebody had been asking about
  // this address, which is more than the door was ever willing to tell.
  if (path == '/login' && req.method == 'POST') {
    let email = canon(field('email'))
    let back = field('return') || null
    if (!email.includes('@')) {
      return askEmail(field('q') || null, back, undefined, 400)
    }
    let code = await mint(meta(env), secret(env), email)
    if (code) {
      await mail(env)({
        to: email,
        subject: `${code} is your yaks.app code`,
        body: `Your yaks.app sign-in code is ${code}.\n\n` +
          'It lasts ten minutes. If you did not ask for it, nothing has ' +
          'happened and you can ignore this.',
      })
    }
    return askCode(email, field('q') || null, back)
  }

  if (path == '/login/code' && req.method == 'POST') {
    let email = canon(field('email'))
    let q = field('q')
    let back = field('return')
    if (!await spend(meta(env), secret(env), email, field('code'))) {
      return askCode(
        email,
        q || null,
        back || null,
        'That code has expired or was mistyped. Ask for a fresh one?',
        400,
      )
    }
    // Nothing here asks what to call them (T-34236), so the front of their
    // address does — written, not merely derived, because a member row names a
    // person by their title and a titleless one reads back as a bare eid
    // (T-32733). It is theirs to change on their own space page.
    let person = await personOf(meta(env), email, nameOf(null, email))
    return landed(req, env, person, q, back)
  }

  // The consent page: the sign-in card wearing the client's name, or one
  // button for a browser that is already signed in.
  if (path == '/oauth/authorize' && req.method == 'GET') {
    let q = url.search.slice(1)
    let ask = await asked(req, env, q)
    if (ask instanceof Response) return ask
    let who = await withAuth(env, req)
    if (!who) return askEmail(q, null, await clientName(env, ask))
    let [row] = await meta(env).query(`.eid=${who.person}`) as {
      email?: { address: string }
    }[]
    return askAllow(
      row?.email?.address ?? 'yourself',
      q,
      await clientName(env, ask),
    )
  }

  if (path == '/oauth/allow' && req.method == 'POST') {
    let who = await withAuth(env, req)
    let q = field('q')
    if (!who) return askEmail(q || null, null)
    return allow(req, env, q, who.person)
  }

  return lost()
}

// Do we claim Client ID Metadata Documents? On unless the env says `off`.
// Read here, per request, rather than baked into a module constant, so the
// claim can be dropped and restored with one `wrangler secret put CIMD` —
// the header explains why a working feature has a lever at all.
let cimd = (env: Env) => env.CIMD != 'off'

// The provider's configuration over this env, one value: `withAuth` reads it
// to unwrap a bearer, and `fetch` runs it. `/oauth/me` is the one protected
// resource the identity part serves itself — the door an agent calls to learn
// which person its token stands for, and the proof that `withAuth` and the
// provider agree. The MCP door at /mcp is protected the same way, through
// `withAuth` and `unauthorized`, in its own part.
let opts = (env: Env): OAuthProviderOptions<Env> => ({
  defaultHandler: { fetch: ours },
  apiRoute: '/oauth/me',
  apiHandler: {
    fetch: async (req: Request, env: Env) => {
      let who = await withAuth(env, req)
      return who ? Response.json(who) : unauthorized(req)
    },
  },
  authorizeEndpoint: '/oauth/authorize',
  tokenEndpoint: '/oauth/token',
  clientRegistrationEndpoint: '/oauth/register',
  clientIdMetadataDocumentEnabled: cimd(env),
  scopesSupported: ['graph'],
  resourceMetadata: {
    scopes_supported: ['graph'],
    resource_name: 'yaks.app',
  },
})

// The Worker runtime hands a fetch handler an ExecutionContext; a kernel part
// is given only its request and its env (env.ts). The provider wants one to
// pass along and to hang `props` on, so it gets a plain object — nothing here
// defers work past the response.
let context = () => ({
  props: {},
  waitUntil: () => {},
  passThroughOnException: () => {},
})

// A provider per request, since its configuration is read from the env: the
// library builds its own implementation per call anyway (`getOAuthApi`), so
// this costs an object, not a connection.
export let fetch = (req: Request, env: Env): Promise<Response> =>
  new OAuthProvider<Env>(opts(env)).fetch(req, env, context() as never)
