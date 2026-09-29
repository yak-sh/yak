// What Cloudflare's cache may keep of an app's bytes (T-33197). `[cache]` in
// wrangler.toml puts a two-tier cache in front of a Worker entrypoint; on a
// hit the entrypoint never runs. This file owns the cache key and policy.
//
// ── Why the cache is NOT in front of the door the browser reaches ──────────
//
// The cache key is the path, the query, the entrypoint and the Worker version.
// It is NOT the hostname — Cloudflare says so plainly, because a Worker is
// zoneless and one Worker answering `api.example.com` and `api.example.net`
// wants one cache. For us that rule is a cross-tenant leak: every space is a
// hostname and they all share one path namespace, so `alice.yaks.app/app/x.css`
// and `bob.yaks.app/app/x.css` are the same cache key, and a customer's own
// domain serving its app at `/` collides with every other front page. Turning
// caching on at the door the browser reaches would serve one space's bytes to
// another's visitors on the second request.
//
// Cloudflare's own answer for that shape — white-labeled tenants on one Worker
// — is the gateway pattern: leave the entrypoint the eyeball reaches uncached
// so it runs every time, and put the cache behind it on an inner entrypoint
// the gateway calls, addressed by something that names the tenant. That is
// `Files` (index.ts), and what names the tenant is the app's EID, which this
// file puts in the inner request's path — so the app's identity is literally
// part of the cache key, and a test can read it.
//
// The cost is that a hit does not skip the Worker: the gateway still routes
// and still decides who is asking. What a hit skips is the round trip to R2
// and the work of assembling the page, which is where the time actually went
// (timing.ts, T-33176).
//
// ── Why this is also the answer for a private app ─────────────────────────
//
// The cached thing is an app's bytes, never anybody's response. The bytes of
// `style.css` are the same whoever may read them; what differs per person is
// only whether they may. So the access check stays in front, on the uncached
// gateway, run on every single request, and the cache below it holds something
// that is nobody's secret in particular.
//
// That is the property worth having: this cannot leak by construction. There
// is no cached object that is one person's private response, so a mistake here
// makes something slow, not wrong. A private app pays one authorization
// decision more than a public one instead of a round trip to a bucket an ocean
// away.

// A release source never changes. A new release gets a new cache key, so old
// entries can expire on their own without a purge.
let YEAR = 31536000

// What the inner entrypoint says about the bytes it is answering. Only `Files`
// sends this, and `Files` is reachable only through the service binding, so
// nothing a person or an app can address ever wears it.
import { type Host, url } from './host.ts'

// Source-named files and content-addressed blobs cannot change under their
// keys. Metadata and access are decided by the gateway, outside this cache.
export let immutable = { 'cache-control': `public, max-age=${YEAR}, immutable` }

// A browser may keep the exact asset it fetched, while a shared cache must
// never retain the app gateway's response for a person. The inner Files entry
// still caches the tenant-keyed bytes under `immutable` above.
export let browserImmutable = `private, max-age=${YEAR}, immutable`

// The address the gateway asks the inner entrypoint at, and therefore the
// cache key. The hostname is a placeholder that never resolves — the request
// goes over the service binding, not the network — and everything that
// distinguishes one answer from another is in the path, because the path is
// what the key is made of:
//
//   /<app eid>/<the app's own path>?source=<release source>, or
//   /blob/<app eid>/<sha>
//
// The eid and not the slug, because an app answers at every address it has
// ever had (`App.slugs`), a rename leaves the old one resolving, and a custom
// domain is a third address for the same bytes. Keying on the eid means those
// are one cache entry rather than three, and it means a rename cannot make one
// app read another's entry. The release source in the query keeps old and new
// bytes separate when the directory switches its serving pointer.
export let at = (eid: string, path: string, source = '') =>
  `https://files.invalid/${eid}${path.startsWith('/') ? '' : '/'}${path}${
    source ? `?source=${encodeURIComponent(source)}` : ''
  }`

// A blob has no mutable file path. Keep its byte cache separate from app
// files, and name both the app and the content so neither tenant nor upload
// can reuse another entry.
export let blobAt = (eid: string, sha: string) =>
  `https://files.invalid/blob/${eid}/${sha}`

// The default, made to stick. Omitting `Cache-Control` is NOT opting out of a
// cache: Cloudflare applies RFC 9111 heuristic freshness and holds a bare
// `200` for two hours. The gateway is uncached today, so nothing it forgets to
// mark can be stored — but "today" is a line in wrangler.toml, and the day
// someone enables caching there every unmarked door would silently become
// network-cached. This makes that day safe instead of catastrophic.
//
// A door that states its own policy keeps it; a door that says nothing gets
// `private, no-store`. A 101 carries the runtime's own socket, which no
// Response constructor here can copy, so a socket passes untouched — the same
// rule apps.ts `reporting` and timing.ts `timed` read.
//
// Framing policy (T-33409): an app is a framed resource, and only its own
// space (its own origin, `'self'` — a space's apps share `space.yaks.app`, so
// they frame each other) and the platform homepage (`https://yaks.app`, the
// T-33424 iframe) may embed it. Any other space's page is refused by the
// browser, which is the whole clickjacking defense: a same-site frame would
// otherwise carry the viewer's session cookie and load authenticated, and the
// browser — not a spoofable request header — is the one thing that knows the
// full ancestor chain. This rides on every sealed response: apps are the
// resource it protects, and on the apex's own pages it only governs who may
// frame them (never what they may frame), so the apex still frames apps.
// Appended, not set, so it stacks with a response's own CSP (the blob sandbox
// at apps.ts `gave`) instead of clobbering it, and no app can widen past this
// baseline by declaring its own frame-ancestors. Deferred, not here: opt-in
// cross-space authenticated embeds need cookie-stripping plus a consented,
// audience-bound token — a real project, out of scope.
export let sealed = (res: Response, env: Host = {}) => {
  if (res.status == 101) return res
  let headers = new Headers(res.headers)
  headers.append(
    'content-security-policy',
    `frame-ancestors 'self' ${url(env)}`,
  )
  if (!headers.has('cache-control')) {
    headers.set('cache-control', 'private, no-store')
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}
