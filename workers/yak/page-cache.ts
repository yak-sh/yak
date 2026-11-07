// An app's public pages, kept in Cloudflare's cache at the Site entrypoint
// (T-124419). Every page view used to read the directory twice before a byte
// was sent; a kept page is answered with none of that.
//
// yak-front (front/) asks Site first for a page any visitor could be sent on
// our own hostnames, so a kept page waits on no kernel to start (kept-page.ts
// holds that path). The gateway (apps.ts `served`) asks too: a customer's
// own domain is only an app once it has read the directory, and a page Site
// passed a moment ago costs it one cached answer. A page is keyed by the hostname
// routed, the path and the mount (`pageAt`), so two spaces never share a key and
// one app mounted at two addresses keeps two pages. On a miss Site serves the address as an
// anonymous visitor would be served it (apps.ts `edged`), and keeps it only
// when it is the same answer for everyone: the own file or 404 of an app
// anyone may read (public or open), with no worker of its own, no sandbox, no
// router claiming the path and no cookie, the release files of a private one
// anyone may install (`keepable`), a space's 404 where no app answers, or its
// index as a stranger sees it, which no person is answered. A person signed
// in who holds no seat in the space is shown its index as such an outsider,
// kept under their own session (kept-page.ts `pageAt`): a seat written there
// purges it, and a member's is never kept. Anything else is a pass, kept as
// briefly as a page.
//
// The gateway remembers, as briefly, every address Site passed and every app
// it served itself of which nothing is ever kept (`unkept`: an unpublished
// private app's, a worker's), and does not ask about them again: such a page
// pays the hop to Site once in a while, not on every view, and a stranger
// walking an app's addresses one by one pays it once. A published private
// app's pages are remembered one address at a time, since its release files
// are still Site's to answer.
//
// A kept page is the page as sent: woven, its base, its home-screen tags, its
// release's addresses, the reporter and the free plan's badge. It is tagged
// with its app and its space, and purged when a directory write changes what
// it shows (facets/pages-graph.ts), before that write answers. Its short
// freshness is the bound on a purge that never happened; past it a visitor is
// answered from the cache while Site serves it again behind them, and a
// failing Site leaves the last good page serving.
//
// The visitor's own answer is the gateway's: it counts the view and the use
// from what the kept page says it was, gives the browser the app's own cache
// rule, and answers a revalidation with a 304.
import { mode } from '@yaks/member'
import { type App, offered } from './directory.ts'
import type { Env } from './env.ts'
import { sandboxed } from './installed.ts'
import {
  type Alone,
  asked as askedOf,
  BROWSER,
  fixed,
  KEEP,
  KEPT,
  NOW,
  opens,
  remember,
  scope,
  SEEN,
  type Seen,
  UNKEPT,
  UNKEPT_AT,
} from './kept-page.ts'
import { appTag, SITE_TAG, spaceTag } from './purge.ts'
import { hostOf, MOUNT } from './route.ts'
import type { Clock } from './timing.ts'
import { scheduleUse, wake } from './used.ts'
import { seen, viewed } from './views.ts'

export { KEPT, pageAt, personal, shareable, visitor } from './kept-page.ts'

/** What a page of an app owes as the gateway answers it: its count
 * (views.ts), and its store booted where a browser goes on to run it, since
 * the page's scripts ask the store next (used.ts `wake`). yak-front does the
 * same for a page it answers from the edge (front.ts `kept`). */
export let shown = (env: Env, req: Request, page: Response, at: Seen) => {
  viewed(env, req, page, at)
  if (at.store && opens(page)) wake(env, at.store)
}

/** An answer Site may keep: which app it was a page of (none, for a space's
 * own 404 or index), for the gateway's count, and the tags its purge names. A
 * missing space uses the site tag, purged when a space is created or renamed. A
 * page or a 404, unless the caller names other `statuses` the same for
 * everyone, and for everyone unless it is a stranger's or an outsider's
 * `alone`. An
 * app mid-release (its fence up, versions.ts `fenced`) had its pages purged
 * as the release began (tools.ts `released`), and its commit purges nothing
 * more (facets/pages-graph.ts), so a page of it kept now would outlive the
 * release: it passes, and only for now. */
export let keep = (
  page: Response,
  space: { eid: string; slug: string; store: string } | null,
  app:
    | {
      eid: string
      slug: string
      store?: string | null
      fence?: string | null
    }
    | null,
  statuses = [200, 404],
  alone?: Alone,
) => {
  if (!statuses.includes(page.status) || page.headers.has('set-cookie')) {
    return passed()
  }
  if (app?.fence) return passed(true)
  let headers = new Headers(page.headers)
  headers.set(
    KEEP,
    [...app ? [appTag(app.eid)] : [], space ? spaceTag(space.eid) : SITE_TAG]
      .join(','),
  )
  headers.set(
    SEEN,
    JSON.stringify({
      ...space ? app ? seen(space, app) : { space: space.slug } : {},
      ...alone ? { [alone]: true } : {},
    }),
  )
  return new Response(page.body, { status: page.status, headers })
}

/** Whether Site may keep an app's answer at `path`, or with no path, at any
 * of its addresses: every own file of an app anyone may read (public or
 * open), and the `fixed` bytes of one anyone may install (directory.ts
 * `offered`), which its pages load first. A private app's pages and data are
 * its members', a sandboxed page carries its visitor's token, and an app's
 * worker may answer each visitor differently.
 *
 * ```ts
 * import { keepable } from './page-cache.ts'
 * import { assert } from '@std/assert'
 * let css = '/api/assets/fdcc9a38-0b6b-4f8c-bcbd-15bad97cee69/style.css'
 * let published = { name: 'notes', version: 2, at: '', about: '' }
 * let app = { access: 'private', worker: '', published } as const
 * assert(keepable(app, css) && keepable(app, '/api/client.js'))
 * assert(keepable(app) && !keepable(app, '/') && !keepable(app, '/api/me'))
 * assert(!keepable({ ...app, published: null }))
 * ```
 */
export let keepable = (
  app:
    & Pick<App, 'access' | 'worker'>
    & Partial<Pick<App, 'installed' | 'published'>>,
  path?: string,
) =>
  !sandboxed(app as App) && app.worker === '' &&
  (mode(app.access) != 'private' ||
    offered(app) && (path == null || fixed(path)))

// The mounts this request's answer owes yak-front word of (`told`), by the
// request's clock, which is the one thing every rung of it holds.
let owed = new WeakMap<object, string>()

/** That the gateway served an app nothing of which is ever kept, mounted at
 * `at`: it asks Site about none of the app's addresses for a while, and tells
 * yak-front to do the same. */
export let unkept = (req: Request, env: Env, at: string, c: Clock) => {
  if (env.SITE) {
    remember(env.SITE, scope(hostOf(req, env), req.headers.get(MOUNT), at))
  }
  owed.set(c, at)
}

/** This answer, saying what `unkept` found. A socket's answer carries nothing
 * more: nothing here can copy the runtime's own socket. */
export let told = (res: Response, c: Clock) => {
  let at = owed.get(c)
  if (!at || res.status == 101) return res
  let headers = new Headers(res.headers)
  headers.set(UNKEPT_AT, at)
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}

/** An address no kept page may answer: the gateway serves it itself. A pass
 * `now` holds for this answer only: neither Site nor the gateway keeps it. */
export let passed = (now = false) =>
  new Response(null, { status: 204, headers: now ? { [NOW]: '1' } : {} })

/** Site's half: served()'s anonymous answer as Site keeps it, or the pass
 * every other answer is. At a session's own key (`personal`) that is only
 * the page drawn for an outsider: whatever else it served the person is
 * everyone's, kept at its own key, or theirs alone, which is never kept. */
export let kept = async (answer: Response, personal = false) => {
  let tags = answer.headers.get(KEEP)
  let alone = JSON.parse(answer.headers.get(SEEN) ?? '{}') as Record<
    Alone,
    true | undefined
  >
  if (!tags || personal && !alone.outsider) {
    await answer.body?.cancel()
    return new Response(null, {
      status: 204,
      headers: { 'cache-control': answer.headers.has(NOW) ? UNKEPT : KEPT },
    })
  }
  let headers = new Headers(answer.headers)
  headers.delete(KEEP)
  headers.set(BROWSER, answer.headers.get('cache-control') ?? '')
  headers.set('cache-control', KEPT)
  headers.set('cache-tag', tags)
  return new Response(answer.body, { status: answer.status, headers })
}

/** The gateway's half: the kept page for this request, counted, or null
 * when Site passed and the gateway serves it itself, as it does a stranger's
 * page when the `session` of a person it verified asks, unless Site keeps
 * their own. */
export let asked = (
  req: Request,
  env: Env,
  c: Clock,
  session: string | null = null,
) =>
  env.SITE
    ? askedOf(
      req,
      env.SITE,
      hostOf(req, env),
      req.headers.get(MOUNT),
      c,
      (answer, at) => {
        shown(env, req, answer, at)
        if (answer.status < 400) scheduleUse(env, at.app)
      },
      session,
    )
    : Promise.resolve(null)
