// The sandbox an installed app can be put in (D-37901). The space is the
// trust boundary (C-37980): an app installed from somebody else's release
// runs like the space's own apps, and the sandbox is the exception, one
// install at a time. What turns it on is the space's owner; nothing does it
// on its own yet. A sandboxed app is served the way a phone serves a
// third-party app, in an opaque origin of its own.
//
// Four pieces, each small, and apps.ts is where they are worn:
//
//  - Which apps: one wearing `installed` with `installed.sandboxed` set
//    (`sandboxed`). The owner sets and clears it (tools.ts `app_set`).
//  - The wall: every answer the app gives carries `Content-Security-Policy:
//    sandbox …` without `allow-same-origin`, so the browser runs its page in
//    an origin nobody shares — no cookie, no storage, no reading its
//    siblings — and `Referrer-Policy: no-referrer`, so the address below
//    never leaves in a header.
//  - The page token: the cookie authenticates the page load and nothing
//    after it. The page is handed a token sealed for this app's store and
//    this person, in its `<base href>` as `/<app>/~<token>/`, so every
//    relative URL the page asks — its script, its API, its reporter — carries
//    it. The router takes the cookie off any such request (index.ts), since
//    the credential is in the URL and never one the browser attaches.
//  - Storage: an opaque origin has no localStorage, so the page is given one
//    (public/storage.js), its keys woven into the page beside the token, its
//    writes saved per person in the app's own store (graph.ts `/storage`).
//
// The token names no session, because there is no session store: it lives
// as long as the cookie that loaded the page, and sign-out cannot end it
// early. The role it carries is never a claim — it is read live, on every
// call, like the cookie's.
import { opened, seal } from '../../src/token.ts'
import type { App } from './directory.ts'
import { SESSION } from './session.ts'

/** Whether this app runs walled off from its space: a copy its space's owner
 * sandboxed. */
export let sandboxed = (app: App) => !!app.installed?.sandboxed

/** What a copy's pin is written with to put it in the sandbox or let it
 * out. `trusted` is the build before this one's spelling of the reverse,
 * kept in step so that build serves every copy as this one does, until a
 * later release drops it (D-37972, expand then contract). */
export let sandboxing = (on: boolean, at = new Date().toISOString()) => ({
  sandboxed: on ? at : null,
  trusted: on ? null : at,
})

// The wall itself. Scripts, forms and popups are what an app is; the one
// flag that would undo the rest, `allow-same-origin`, is never here.
export let SANDBOX = 'sandbox allow-scripts allow-forms allow-popups'

/** An answer from a sandboxed app, walled: the sandbox, and no referrer, so
 * the token in the page's own addresses is never sent anywhere else.
 * Appended, so an app worker's own policy stacks with it rather than
 * replacing it. A socket has no headers to add. */
export let walled = (res: Response) => {
  if (res.status == 101) return res
  let headers = new Headers(res.headers)
  headers.append('content-security-policy', SANDBOX)
  headers.set('referrer-policy', 'no-referrer')
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}

type Page = { person: string | null; store: string; exp: number }

let DAY = 24 * 60 * 60

/** When a page token dies: with the cookie that loaded the page, or, for a
 * visitor who is not signed in, a session's length from the end of today —
 * rounded, so the page's bytes (and their ETag) hold still through the day. */
export let lasting = (until: number | undefined, now = Date.now()) =>
  until ?? Math.ceil(now / 1000 / DAY) * DAY + SESSION

/** A page token: this person (or nobody) on this one store, until `exp`. */
export let paging = (
  secret: string,
  store: string,
  person: string | null,
  exp: number,
) => seal('page', { person, store, exp } satisfies Page, secret)

/** Who a page token says is asking, or null for anything but a live token
 * sealed for this store. Another app's token fails here, whoever holds it. */
export let paged = async (
  sealed: string,
  secret: string,
  store: string,
  now = Date.now(),
) => {
  let p = await opened<Page>('page', sealed, secret)
  if (!p || p.store != store || typeof p.exp != 'number') return null
  if (p.exp * 1000 <= now) return null
  return { person: typeof p.person == 'string' ? p.person : null, exp: p.exp }
}

/** The token segment leading an app-relative path, and the path after it.
 * `/~abc/api/query` is `{token: 'abc', rest: '/api/query'}`. */
export let tokenOf = (path: string) => {
  let hit = /^\/~([^/]+)(\/.*)?$/.exec(path)
  return hit ? { token: hit[1], rest: hit[2] ?? '/' } : null
}

/** The other way to hand one over: `Authorization: Bearer <token>`. */
export let bearerOf = (req: Request) =>
  /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1] ??
    null

/** The tags a sandboxed page is given for storage: the person's saved keys
 * as an inert JSON block, then the classic script that reads it, ahead of
 * every script of the page's own so `localStorage` is there before they run.
 * `<` is escaped, so no saved value can close the block. */
export let stored = (
  at: string,
  keys: Record<string, string>,
  saves: boolean,
) =>
  '<script type="application/json" id="yak-storage">' +
  JSON.stringify({ saves, keys }).replaceAll('<', '\\u003c') +
  `</script><script src="${at}api/storage.js"></script>`
