// Signing in with an account somewhere else, "Continue with Google": the
// OpenID Connect authorization-code flow (@yaks/oauth `client`, `identity`)
// over each provider given as data in PROVIDERS. Nothing here knows Google
// but its row.
//
// A sign-in begins at `POST /login/<name>`, which sends the browser to the
// provider holding the attempt in a sealed cookie, and returns at
// `/login/<name>/callback`, where the code is exchanged and the id_token read.
// What comes back is an address the provider verified and any profile name
// it supplied. identity.ts signs in whoever wears the address the way a code that opened would
// (signin.ts `arrive`), so a verified address that already has a person is
// that person, and a new one is somebody new with a space of their own.
//
// Each provider signs in as its own OAuth client, kept in the platform's vault
// under its name (@yaks/connections `registration`, `yak admin client`), apart
// from the client an integration of the same company connects with: revoking
// either leaves the other working. A deploy holding no client for a provider
// offers no button for it.
//
// Only `openid email profile` is asked for, which no provider makes a client
// verify before strangers may use it.
import {
  type Attempt,
  client,
  identity,
  OAuthError,
  type Tokens,
} from '@yaks/oauth'
import { type Registered, registered } from '@yaks/connections'
import { url } from '@yaks/platform/host'
import { cookieValue, opened, seal } from './lib/token.ts'
import { vaulted, vaultOf } from './vault.ts'
import { caught } from './defects.ts'
import type { Env } from './env.ts'

/** A provider a person signs in with, as data. */
export type Oidc = {
  /** What the button calls it: "Continue with <title>". */
  title: string
  /** The mark its button wears, as the provider's brand asks: an SVG. */
  logo: string
  authorize: string
  token: string
  /** Each spelling of its issuer an id_token may carry. */
  issuers: string[]
  scopes: string[]
  params?: Record<string, string>
  /** The OAuth client it signs in as, by the name the vault keeps it under. */
  client: string
}

export let PROVIDERS = {
  google: {
    title: 'Google',
    logo:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>',
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
    scopes: ['openid', 'email', 'profile'],
    // Somebody with two Google accounts picks one rather than being signed
    // in as whichever their browser last used.
    params: { prompt: 'select_account' },
    client: 'google-signin',
  },
} satisfies Record<string, Oidc>

/** A provider's name, which is also how a person who used it got in
 * (signin.ts `Via`). */
export type Named = keyof typeof PROVIDERS

/** Where a sign-in at `name` begins. */
export let beginPath = (name: Named) => `/login/${name}`

/** Where a sign-in at `name` returns, as registered with the provider. */
export let callbackPath = (name: Named) => `/login/${name}/callback`

/**
 * The provider a path begins or returns a sign-in at, or null.
 *
 * ```ts
 * import { routed } from './oidc.ts'
 * import { assertEquals } from '@std/assert'
 * assertEquals(routed('/login/google'), { name: 'google', at: 'begin' })
 * assertEquals(routed('/login/google/callback'), {
 *   name: 'google',
 *   at: 'callback',
 * })
 * assertEquals(routed('/login/code'), null)
 * assertEquals(routed('/login/toString'), null)
 * ```
 */
export let routed = (
  path: string,
): { name: Named; at: 'begin' | 'callback' } | null => {
  let [, name, back] = /^\/login\/([a-z]+)(\/callback)?$/.exec(path) ?? []
  if (!name || !Object.hasOwn(PROVIDERS, name)) return null
  return { name: name as Named, at: back ? 'callback' : 'begin' }
}

// The client a provider signs in as here, or none: no vault, none kept, or
// a vault that would not answer, which is reported and offers no button.
let clientOf = (env: Partial<Env>, name: Named) =>
  vaulted(env)
    ? registered(vaultOf(env), PROVIDERS[name].client).catch((e) => {
      caught(e, { request: 'oidc client', provider: name })
      return undefined
    })
    : Promise.resolve(undefined)

/** Each provider this deploy can sign somebody in with, for the sign-in
 * card's buttons. */
export type Offered = { name: Named; title: string; logo: string }

export let offered = async (env: Partial<Env>): Promise<Offered[]> => {
  let names = Object.keys(PROVIDERS) as Named[]
  let held = await Promise.all(names.map((name) => clientOf(env, name)))
  return names.filter((_, i) => held[i]).map((name) => {
    let { title, logo } = PROVIDERS[name]
    return { name, title, logo }
  })
}

// The attempt in flight, sealed into a cookie only the callback reads, with
// what the sign-in card carried: an authorize request's query and the page to
// hand them back to.
let ATTEMPT = 'yak_oidc'
let AGE = 600

type Held = {
  name: Named
  attempt: Attempt & { verifier: string }
  q?: string
  back?: string
}

let flow = (
  env: Partial<Env>,
  name: Named,
  registered: Registered,
  kept: Tokens = {},
) =>
  client({ ...PROVIDERS[name], client: registered }, {
    // The grant is read once, here, and kept nowhere: signing in is all it
    // was for.
    store: {
      read: () => Promise.resolve(kept),
      update: (_, fn) => fn(kept),
    },
    key: name,
    redirect: url(env, callbackPath(name)),
    fetch: env.SIGNIN_FETCH,
  })

/** The answer that sends a browser to `name` to sign in, holding the attempt;
 * null when this deploy keeps no client for it. */
export let begin = async (
  env: Env,
  name: Named,
  carried: { q?: string; back?: string },
): Promise<Response | null> => {
  let registered = await clientOf(env, name)
  if (!registered || !env.SESSION_SECRET) return null
  let { url: to, attempt } = await flow(env, name, registered).begin()
  let held: Held = {
    name,
    attempt,
    ...carried.q ? { q: carried.q } : {},
    ...carried.back ? { back: carried.back } : {},
  }
  return new Response(null, {
    status: 303,
    headers: {
      location: to,
      'set-cookie': `${ATTEMPT}=${await seal(
        'oidc',
        held,
        env.SESSION_SECRET,
      )}; Path=${
        callbackPath(name)
      }; Max-Age=${AGE}; Secure; HttpOnly; SameSite=Lax`,
    },
  })
}

/** The cookie that forgets an attempt once it has come back. */
export let spent = (name: Named) =>
  `${ATTEMPT}=; Path=${callbackPath(name)}; Max-Age=0; Secure; HttpOnly`

/** What a return from `name` proved: the address it verified and what the
 * card carried, or why it proved nothing, said to the person. */
export type Returned =
  & { q?: string; back?: string }
  & ({ address: string; name?: string } | { why: string })

export let NOT_FINISHED = (title: string) =>
  `The sign-in with ${title} didn't finish. Try again, or get a code by email.`

export let UNVERIFIED = (title: string) =>
  `${title} hasn't confirmed an email address for that account. ` +
  'Sign in with a code by email instead.'

/** Read a return from `name`: the attempt this browser holds, the code
 * exchanged for its tokens, and the address the id_token vouches for. */
export let complete = async (
  env: Env,
  name: Named,
  req: Request,
): Promise<Returned> => {
  let { title } = PROVIDERS[name]
  let sealed = cookieValue(req.headers.get('cookie'), ATTEMPT)
  let held = sealed && env.SESSION_SECRET
    ? await opened<Held>('oidc', sealed, env.SESSION_SECRET)
    : null
  let carried = { q: held?.q, back: held?.back }
  let registered = await clientOf(env, name)
  if (!held || held.name != name || !registered) {
    return { ...carried, why: NOT_FINISHED(title) }
  }
  let kept: Tokens = {}
  try {
    await flow(env, name, registered, kept).complete(held.attempt, req.url)
    let who = identity(kept, {
      issuers: PROVIDERS[name].issuers,
      audience: registered.id,
    })
    if (!who.email || !who.verified) {
      return { ...carried, why: UNVERIFIED(title) }
    }
    return { ...carried, address: who.email, name: who.name }
  } catch (e) {
    // Somebody pressing Cancel at the provider is no failure of ours.
    if (!(e instanceof OAuthError && e.code == 'access_denied')) {
      caught(e, { request: `GET ${callbackPath(name)}` })
    }
    return { ...carried, why: NOT_FINISHED(title) }
  }
}
