// The platform session token (D-32318 §Auth): what the kernel worker trusts
// about who is asking, minted once at sign-in and verified on every request
// with no session store and no round trip. A token is `<claims>.<mac>`: the
// claims are base64url JSON `{person, space, exp}` — the person's eid, the
// space the sign-in happened at (null for the platform-wide door), and a unix
// second the token dies at — and the mac is HMAC-SHA256 over the claims text
// under the shared secret. An edited or forged token fails the mac, an old one
// fails `exp`; the check runs through WebCrypto's verify, so it is
// constant-time without a compare of our own. The role a person holds is
// membership, read from the directory, never a claim: a token cannot promote.
//
// The seal under it — `seal`/`opened`, a signed JSON value — is the general
// half, because the session token is not the only thing the kernel has to be
// sure it wrote: the grant an app's own Worker carries back through its
// service binding is another (workers/yak/dispatch.ts).
//
// WebCrypto only, so the same file runs in a Worker, in Deno, and in a browser.
// Nothing here reads a cookie or an env: the kernel's session.ts reads the
// cookie, the login page (T-32327) mints one with `sign` and sets it with
// `cookie`.
export type Claims = { person: string; space: string | null; exp: number }

// The cookie's name. Set on `Domain=yaks.app`, so every space's hostname
// carries it and one sign-in serves the platform.
export let COOKIE = 'yak_session'

let enc = new TextEncoder()
let dec = new TextDecoder()

let b64u = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')

let unb64u = (s: string) =>
  Uint8Array.from(
    atob(s.replaceAll('-', '+').replaceAll('_', '/')),
    (c) => c.charCodeAt(0),
  )

let key = (secret: string, use: KeyUsage) =>
  crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [use],
  )

// A value nobody but this secret can have written: `<body>.<mac>`, the body
// base64url JSON and the mac HMAC-SHA256 over the body text. The session
// token is one of these and the grant an app's worker carries is another
// (workers/yak/dispatch.ts) — what is sealed is the caller's to shape, and
// its expiry is the caller's to check.
export let seal = async (value: unknown, secret: string) => {
  let body = b64u(enc.encode(JSON.stringify(value)))
  let mac = await crypto.subtle.sign(
    'HMAC',
    await key(secret, 'sign'),
    enc.encode(body),
  )
  return `${body}.${b64u(new Uint8Array(mac))}`
}

// What was sealed, or null for anything but a well-formed value under this
// secret. The check runs through WebCrypto's verify, so it is constant-time
// without a compare of our own.
export let opened = async <T>(
  sealed: string,
  secret: string,
): Promise<T | null> => {
  let dot = sealed.lastIndexOf('.')
  if (dot < 0) return null
  let body = sealed.slice(0, dot)
  try {
    let ok = await crypto.subtle.verify(
      'HMAC',
      await key(secret, 'verify'),
      unb64u(sealed.slice(dot + 1)),
      enc.encode(body),
    )
    return ok ? JSON.parse(dec.decode(unb64u(body))) as T : null
  } catch {
    return null
  }
}

export let sign = (claims: Claims, secret: string) => seal(claims, secret)

// The claims a token carries, or null for anything but a well-formed token
// under this secret that has not expired. `now` is milliseconds, the clock a
// test hands in.
export let verify = async (
  token: string,
  secret: string,
  now = Date.now(),
): Promise<Claims | null> => {
  let c = await opened<Claims>(token, secret)
  if (!c) return null
  if (typeof c.person != 'string' || typeof c.exp != 'number') return null
  if (c.exp * 1000 <= now) return null
  return { person: c.person, space: c.space ?? null, exp: c.exp }
}

// One cookie's value out of a Cookie header, or null.
export let cookieValue = (header: string | null, name = COOKIE) => {
  for (let part of (header ?? '').split(';')) {
    let [k, ...v] = part.trim().split('=')
    if (k == name) return v.join('=')
  }
  return null
}

// The Set-Cookie value that carries a token: platform-wide by domain, never
// readable by a page's script, sent on top-level navigations from elsewhere
// (Lax) so a link into an app arrives signed in.
//
// An EMPTY domain omits the Domain attribute entirely, which is host-only —
// the cookie sticks to the exact hostname that set it and travels to no other.
// A literal `Domain=` is malformed and a browser's handling of it is its own
// to decide, so the two real cases are named outright: a shared apex, or this
// one host. Custom-domain sign-in (identity.ts `handoff`) needs the host-only
// form, since a `yaks.app` cookie never rides to a customer's own hostname.
export let cookie = (token: string, domain: string, maxAge: number) =>
  `${COOKIE}=${token}; ${domain ? `Domain=${domain}; ` : ''}` +
  `Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Lax`
