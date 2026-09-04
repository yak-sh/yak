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
// platform session cookie (src/token.ts). No password exists to lose. The code
// card asks one thing about them, once and only while nobody has answered it:
// what their apps should call them (T-32654) — skipped, that is the front of
// their address, and either way an address never leaves the directory. A person
// sent here from a page they could not use arrives as `/login?return=<url>`:
// both cards carry that address forward, and the spent code lands them back on
// it when it is one of ours (T-32593).
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
import { directory, META, META_STORE } from './directory.ts'
import { doomed, erase, naming, refused, ticketed, went } from './erase.ts'
import * as dirPart from './directory.ts'
import { bound, type Env } from './env.ts'
import { mail } from './mail.ts'
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
import { canon, mint, nameAt, nameOf, personOf, spend } from './signin.ts'
import { storeOf } from './store.ts'

// A month of not signing in again. The cookie is the browser's; an agent's
// token has the provider's own, shorter life.
let SESSION = 30 * 24 * 60 * 60

// What a grant carries and a token gives back: the person, nothing else.
// Membership is read from the directory at request time, never a claim.
type Props = { person: string }

export type Caller = { person: string; via: 'session' | 'oauth' }

// The provider's helpers over this env: parsing an authorize request,
// naming a client, writing a grant, unwrapping a token. `opts` is the same
// configuration `fetch` runs, so the two never disagree.
let api = (env: Env) => getOAuthApi<Env>(opts(env), env)

// THE contract every other part reads (mcp.ts swaps its stub for this import):
// who is asking, by session cookie or by bearer token, or nobody. It answers
// an identity and never a permission — what a person may do in a space is
// their membership (session.ts, directory.ts).
export let withAuth = async (
  env: Env,
  req: Request,
): Promise<Caller | null> => {
  let bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')
  if (bearer) {
    let token = await api(env).unwrapToken<Props>(bearer[1])
    let person = token?.grant.props?.person
    return person ? { person, via: 'oauth' } : null
  }
  let token = cookieValue(req.headers.get('cookie'))
  if (!token || !env.SESSION_SECRET) return null
  let claims = await verify(token, env.SESSION_SECRET)
  return claims ? { person: claims.person, via: 'session' } : null
}

// The RFC 9728 challenge a protected resource answers an anonymous caller
// with: where to find the metadata that names this platform's authorization
// server. It is how an MCP client discovers the door at all, so it lives
// here beside the door rather than in each resource.
// A refusal is read by a person's agent, so it says a SENTENCE beside its
// code and names where signing in happens — the treatment every other door
// already had, and the one this one missed (C-32607 item 1, apps.ts SAYS).
export let unauthorized = (req: Request) => {
  let url = new URL(req.url)
  return Response.json({
    error: {
      code: 'unauthorized',
      message: `sign in at https://${PLATFORM} to reach your apps from here`,
      signIn: `https://${PLATFORM}/login`,
    },
  }, {
    status: 401,
    headers: {
      'www-authenticate': 'Bearer realm="OAuth", resource_metadata=' +
        `"${url.origin}/.well-known/oauth-protected-resource${url.pathname}"`,
    },
  })
}

let redirect = (to: string, set?: string, status = 302) =>
  new Response(null, {
    status,
    headers: { location: to, ...(set ? { 'set-cookie': set } : {}) },
  })

// Whether any agent has ever been let in as this person: one grant is
// enough, and the provider already keeps the answer. It is what tells a
// fresh account from a working one (T-32972).
let connected = async (env: Env, person: string) =>
  !!(await api(env).listUserGrants(person, { limit: 1 })).items.length

// Where a signed-in person lands: the page they came from, when it is on our
// own zone — an off-zone address is ignored and never followed, the field
// being a stranger's to fill in (route.ts `onZone`). Sent nowhere in
// particular, someone with no assistant attached lands on the page that
// teaches attaching one, and everyone else on the apex as ever: an assistant
// is the whole product, and nobody who has one is told about it twice.
let backTo = async (env: Env, person: string, back: string) =>
  (back && onZone(back)) || (await connected(env, person) ? '/' : '/connect')

// The cookie's Domain: the platform's own apex, so one sign-in serves every
// space's hostname. On a dev host there is no domain to share — an IP takes
// no Domain attribute at all — so the cookie stays host-only.
let domainOf = (req: Request) => {
  let host = hostOf(req)
  return host == PLATFORM || host.endsWith(`.${PLATFORM}`) ? PLATFORM : ''
}

let meta = (env: Env) => storeOf(env.STORE, META_STORE)

let dirOf = (env: Env) => directory(bound(env.DIRECTORY, dirPart.fetch, env))

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

// The connector page as this person sees it: their own address beside the
// instructions, or the instructions alone for a stranger reading them from
// the home page. `own` is the same call sign-in makes, so someone who signed
// in before spaces existed gets theirs here (T-32482).
let theirs = async (env: Env, req: Request, said?: string, say?: string) => {
  let who = await withAuth(env, req)
  if (!who) return connect(null)
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

// Taking an address: the person's own space wears the slug they chose. It is
// theirs to change while nothing is built there — an app's URL is this slug,
// so a space with apps in it stays put until moving one is something we do
// properly, with the redirect a rename wants (T-32576). Answers the address
// or a sentence, never both; the card renders whichever it gets.
let choose = async (
  env: Env,
  person: string,
  want: string,
): Promise<{ address?: string; slug?: string; error?: string }> => {
  let dir = dirOf(env)
  let space = await dir.own(person)
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
  // Signing in IS having a space (T-32482): theirs already, or minted here
  // from their address, so no agent ever has to ask them for a name.
  await dir.own(person)
  let space = await dir.space(META.space)
  if (space && await dir.memberless(space)) {
    let r = await store('/apply', {
      method: 'POST',
      body: JSON.stringify({
        entities: [{ member: { space: space.eid, person, role: 'owner' } }],
      }),
    }, { 'x-yak-kernel': '1' })
    if (!r.ok) throw new Error(`first owner refused: ${await r.text()}`)
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
  return redirect(hand ?? await backTo(env, person, back), set, 303)
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
    // Already signed in with a return to go to? Then the platform has nothing
    // to ask: honor the session and send them on — a return on a customer's
    // own hostname becomes a handoff (`landed`), never the code form again.
    // This is what carries the platform session across to a custom domain
    // without a second sign-in, and it matches the consent page, which hands
    // an already-signed-in browser one Allow rather than a fresh sign-in.
    let who = back ? await withAuth(env, req) : null
    if (who) return landed(req, env, who.person, '', back!)
    return askEmail(null, back)
  }

  // An address, and a code on its way to it. The one thing the platform reads
  // about the address here is whether anyone has ever named it, because the
  // card that follows asks what to call them while nobody has (T-32654); a
  // stranger who wants that answer pays for it with a letter to the person
  // they are guessing at. Nothing else — whether an address has apps, spaces
  // or anything at all is still not a stranger's business.
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
    return askCode(
      email,
      field('q') || null,
      back,
      !await nameAt(meta(env), email),
    )
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
        !await nameAt(meta(env), email),
        'That code has expired or was mistyped. Ask for a fresh one?',
        400,
      )
    }
    // What they said to call them, or the front of their address when they
    // skipped the question (`nameOf`) — written once, so the next sign-in
    // does not ask again. A name shaped like an address is no name.
    let person = await personOf(
      meta(env),
      email,
      nameOf(field('name').trim().slice(0, 60), email),
    )
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
    let [row] = await (await meta(env)(`/query?id=${who.person}`)).json() as {
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
