// The identity part (D-32318 §Auth): one sign-in for the whole platform, at
// the apex, and the OAuth 2.1 door agents come through. Two ways in, one
// answer — a person's eid — which every other part reads through `withAuth`.
//
// A person proves who they are by receiving mail: `POST /login` mints a
// six-digit code (signin.ts) and hands it to the mail seam (mail.ts);
// `POST /login/code` spends it, finds or mints the person, and sets the
// platform session cookie (src/token.ts). No password exists to lose.
//
// An agent proves who it is with a bearer token from
// `@cloudflare/workers-oauth-provider`, which owns `/oauth/token`,
// `/oauth/register`, and the two well-known metadata documents. Dynamic
// client registration is ON because that is what the Claude and ChatGPT
// connectors do today; MCP's 2026-07-28 revision deprecates it in favor of
// Client ID Metadata Documents, which the same library serves once we turn on
// `clientIdMetadataDocumentEnabled` (it needs the
// `global_fetch_strictly_public` compatibility flag). The provider's consent
// page is the sign-in page: signing in IS granting, and an already-signed-in
// browser gets one Allow button. The grant carries `{person}` as its props,
// so a token resolves to the same eid a cookie does.
//
// The first person ever to sign in owns the meta space: while `yak` has no
// members at all, this writes `member(yak, person, owner)` — the same
// memberless bootstrap apps.ts opens for the first write (directory.ts
// `memberless`). After that the ordinary membership rule holds.
import {
  AuthorizationError,
  type AuthRequest,
  getOAuthApi,
  OAuthProvider,
  type OAuthProviderOptions,
} from '@cloudflare/workers-oauth-provider'
import { cookie, cookieValue, sign, verify } from '../../src/token.ts'
import { directory, META } from './directory.ts'
import * as dirPart from './directory.ts'
import { bound, type Env } from './env.ts'
import { mail } from './mail.ts'
import { askAllow, askCode, askEmail, lost } from './pages.ts'
import { hostOf, PLATFORM } from './route.ts'
import { canon, mint, personOf, spend } from './signin.ts'
import { storeOf } from './store.ts'

// A month of not signing in again. The cookie is the browser's; an agent's
// token has the provider's own, shorter life.
let SESSION = 30 * 24 * 60 * 60

// What a grant carries and a token gives back: the person, nothing else.
// Membership is read from the directory at request time, never a claim.
type Props = { person: string }

export type Caller = { person: string; via: 'session' | 'oauth' }

// The provider's helpers over this env: parsing an authorize request,
// naming a client, writing a grant, unwrapping a token. `OPTS` is the same
// configuration `fetch` runs, so the two never disagree.
let api = (env: Env) => getOAuthApi<Env>(OPTS, env)

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
export let unauthorized = (req: Request) => {
  let url = new URL(req.url)
  return Response.json({ error: { code: 'unauthorized' } }, {
    status: 401,
    headers: {
      'www-authenticate': 'Bearer realm="OAuth", resource_metadata=' +
        `"${url.origin}/.well-known/oauth-protected-resource${url.pathname}"`,
    },
  })
}

let redirect = (to: string, set?: string) =>
  new Response(null, {
    status: 302,
    headers: { location: to, ...(set ? { 'set-cookie': set } : {}) },
  })

// The cookie's Domain: the platform's own apex, so one sign-in serves every
// space's hostname. On a dev host there is no domain to share — an IP takes
// no Domain attribute at all — so the cookie stays host-only.
let domainOf = (req: Request) => {
  let host = hostOf(req)
  return host == PLATFORM || host.endsWith(`.${PLATFORM}`) ? PLATFORM : ''
}

let meta = (env: Env) => storeOf(env.STORE, META.space, META.app)

// The secret signs sessions and keys the code digests. Unset, sign-in cannot
// work at all, and saying so out loud beats a token nobody can verify: the
// throw becomes an exception entity behind the soft page (index.ts).
let secret = (env: Env) => {
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET is not set')
  return env.SESSION_SECRET
}

// The person is known: the cookie, the first-owner bootstrap, and wherever
// they were going.
let landed = async (req: Request, env: Env, person: string, q: string) => {
  let store = meta(env)
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env))
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
  return q ? allow(req, env, q, person, set) : redirect('/', set)
}

// The authorize request as the provider reads it, re-parsed from the query
// the browser carried back: `q` is untrusted, and parsing is what validates
// it against the registered client, its redirect URI, and PKCE. A client we
// cannot even name is refused here; one we can is told in its own language.
let asked = async (req: Request, env: Env, q: string) => {
  let url = new URL(`/oauth/authorize?${q}`, req.url)
  try {
    return await api(env).parseAuthRequest(new Request(url.href))
  } catch (e) {
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

  if (path == '/login' && req.method == 'GET') return askEmail(null)

  // An address, and a code on its way to it. The address is never checked
  // against a person here: whether one exists is not a stranger's business.
  if (path == '/login' && req.method == 'POST') {
    let email = canon(field('email'))
    if (!email.includes('@')) {
      return askEmail(field('q') || null, undefined, 400)
    }
    let store = meta(env)
    let code = await mint(store, secret(env), email)
    await mail(env, store)({
      to: email,
      subject: `${code} is your yaks.app code`,
      body: `Your yaks.app sign-in code is ${code}.\n\n` +
        'It lasts ten minutes. If you did not ask for it, nothing has ' +
        'happened and you can ignore this.',
    })
    return askCode(email, field('q') || null)
  }

  if (path == '/login/code' && req.method == 'POST') {
    let email = canon(field('email'))
    let q = field('q')
    if (!await spend(meta(env), secret(env), email, field('code'))) {
      return askCode(
        email,
        q || null,
        'That code has expired or was mistyped. Ask for a fresh one?',
        400,
      )
    }
    return landed(req, env, await personOf(meta(env), email), q)
  }

  // The consent page: the sign-in card wearing the client's name, or one
  // button for a browser that is already signed in.
  if (path == '/oauth/authorize' && req.method == 'GET') {
    let q = url.search.slice(1)
    let ask = await asked(req, env, q)
    if (ask instanceof Response) return ask
    let who = await withAuth(env, req)
    if (!who) return askEmail(q, await clientName(env, ask))
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
    if (!who) return askEmail(q || null)
    return allow(req, env, q, who.person)
  }

  return lost()
}

// The provider's configuration, one value: `withAuth` reads it to unwrap a
// bearer, and `fetch` runs it. `/oauth/me` is the one protected resource the
// identity part serves itself — the door an agent calls to learn which
// person its token stands for, and the proof that `withAuth` and the
// provider agree. The MCP door at /mcp is protected the same way, through
// `withAuth` and `unauthorized`, in its own part.
let OPTS: OAuthProviderOptions<Env> = {
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
  scopesSupported: ['graph'],
  resourceMetadata: {
    scopes_supported: ['graph'],
    resource_name: 'yaks.app',
  },
}

let provider = new OAuthProvider<Env>(OPTS)

// The Worker runtime hands a fetch handler an ExecutionContext; a kernel part
// is given only its request and its env (env.ts). The provider wants one to
// pass along and to hang `props` on, so it gets a plain object — nothing here
// defers work past the response.
let context = () => ({
  props: {},
  waitUntil: () => {},
  passThroughOnException: () => {},
})

export let fetch = (req: Request, env: Env): Promise<Response> =>
  provider.fetch(req, env, context() as never)
