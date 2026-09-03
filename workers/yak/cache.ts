// What Cloudflare's cache may keep of an app's files, and how it is emptied
// (T-33197). `[cache]` in wrangler.toml puts a two-tier cache in front of a
// Worker entrypoint; on a hit the entrypoint never runs. This file owns which
// entrypoint that is, what the cached thing is, and who empties it.
//
// ── Why the cache is NOT in front of the door the browser reaches ──────────
//
// The cache key is the path, the query, the entrypoint and the Worker version.
// It is NOT the hostname — Cloudflare says so plainly, because a Worker is
// zoneless and one Worker answering `api.example.com` and `api.example.net`
// wants one cache. For us that rule is a cross-tenant leak: every space is a
// hostname and they all share one path namespace, so `alice.yaks.app/app/x.css`
// and `bob.yaks.app/app/x.css` are the SAME cache key, and a customer's own
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
// ── Why this is also the answer for a PRIVATE app ─────────────────────────
//
// The cached thing is an app's BYTES, never anybody's response. The bytes of
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
import type { App } from './directory.ts'

// How long the cache holds a file, and how long it may answer from a stale
// copy while it refreshes behind the request. A year, because the real answer
// to "how long" is never time — it is `purged()`, called by every door that
// changes what a visitor would see. Time is only the backstop for a purge that
// was rate-limited or lost.
let YEAR = 31536000
let SWR = 86400

// What the inner entrypoint says about the bytes it is answering. Only `Files`
// sends this, and `Files` is reachable only through the service binding, so
// nothing a person or an app can address ever wears it.
export let keepable = (tags: string[]) => ({
  'cache-control': `public, s-maxage=${YEAR}, stale-while-revalidate=${SWR}`,
  'cache-tag': tags.join(','),
})

// The address the gateway asks the inner entrypoint at, and therefore the
// cache key. The hostname is a placeholder that never resolves — the request
// goes over the service binding, not the network — and everything that
// distinguishes one answer from another is in the PATH, because the path is
// what the key is made of:
//
//   /<app eid>/<the app's own path>
//
// The eid and not the slug, because an app answers at every address it has
// ever had (`App.slugs`), a rename leaves the old one resolving, and a custom
// domain is a third address for the same bytes. Keying on the eid means those
// are one cache entry rather than three, and it means a rename cannot make one
// app read another's entry.
export let at = (eid: string, path: string) =>
  `https://files.invalid/${eid}${path.startsWith('/') ? '' : '/'}${path}`

// The tag a purge names. ONE tag, the app's eid, and the reason there is only
// one is the reason this design is safe: what is cached is BYTES, so the only
// thing that can make a cache entry wrong is a write that changes the bytes.
//
// Everything else a door can change is about IDENTITY, and identity is decided
// in front of the cache, on every request. An app going private needs no purge
// — the access check that now says no runs before the bytes are asked for. A
// slug moving needs none — the key is the eid, so the entry is already the
// same entry at the new address. A member being removed needs none — their
// next request is refused at the gateway. A per-space or per-member tag would
// cost bytes on every response and buy nothing, because no door would ever
// purge it.
//
// Cache tags must be ASCII without spaces; an eid is a uuid, so nothing needs
// escaping.
export let tagsOf = (eid: string) => [`a:${eid}`]

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
export let sealed = (res: Response) => {
  if (res.status == 101) return res
  if (res.headers.has('cache-control')) return res
  let headers = new Headers(res.headers)
  headers.set('cache-control', 'private, no-store')
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}

// Emptying it. `cache.purge` comes from `cloudflare:workers` rather than an
// ExecutionContext because this Worker has none to thread: every part is a
// plain `fetch(req, env)` (env.ts), and the `ctx` an MCP tool receives is the
// kernel's own (tools.ts `Ctx`), not the runtime's. The module import is the
// door Cloudflare provides for exactly that case.
//
// The runtime under `wrangler dev` and the workerd probes has no `purge` at
// all, so it is looked up per call and skipped when absent: a test tier that
// cannot purge must still be able to run every write path.
//
// A purge NEVER throws into the write that called it — failing `app_files`
// because a cache was busy would be worse than the staleness. But a purge that
// quietly fails is exactly the "my edit did not appear" report this design
// exists to prevent, so it is logged loudly, and `s-maxage` is the backstop.
type Purger = {
  purge: (
    what: { tags?: string[]; pathPrefixes?: string[]; purgeEverything?: true },
  ) => Promise<{ success: boolean; errors?: unknown[] }>
}

export let purge = async (tags: string[]) => {
  let mod
  try {
    mod = await import('cloudflare:workers') as { cache?: Purger }
  } catch {
    return false
  }
  if (typeof mod.cache?.purge != 'function') return false
  try {
    let out = await mod.cache.purge({ tags })
    if (!out.success) {
      console.error('yak: cache purge refused', tags, out.errors)
    }
    return out.success
  } catch (e) {
    console.error('yak: cache purge threw', tags, e)
    return false
  }
}

// The purge a door calls when it has changed an app's BYTES: one call empties
// every address this app answers at, at every edge. A door that changed only
// who may read does not call this, and does not need to.
export let purged = (app: App) => purge(tagsOf(app.eid))
