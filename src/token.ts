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

export let sign = async (claims: Claims, secret: string) => {
  let body = b64u(enc.encode(JSON.stringify(claims)))
  let mac = await crypto.subtle.sign(
    'HMAC',
    await key(secret, 'sign'),
    enc.encode(body),
  )
  return `${body}.${b64u(new Uint8Array(mac))}`
}

// The claims a token carries, or null for anything but a well-formed token
// under this secret that has not expired. `now` is milliseconds, the clock a
// test hands in.
export let verify = async (
  token: string,
  secret: string,
  now = Date.now(),
): Promise<Claims | null> => {
  let dot = token.lastIndexOf('.')
  if (dot < 0) return null
  let body = token.slice(0, dot)
  try {
    let ok = await crypto.subtle.verify(
      'HMAC',
      await key(secret, 'verify'),
      unb64u(token.slice(dot + 1)),
      enc.encode(body),
    )
    if (!ok) return null
    let c = JSON.parse(dec.decode(unb64u(body)))
    if (typeof c.person != 'string' || typeof c.exp != 'number') return null
    if (c.exp * 1000 <= now) return null
    return { person: c.person, space: c.space ?? null, exp: c.exp }
  } catch {
    return null
  }
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
export let cookie = (token: string, domain: string, maxAge: number) =>
  `${COOKIE}=${token}; Domain=${domain}; Path=/; Max-Age=${maxAge}; ` +
  'Secure; HttpOnly; SameSite=Lax'
